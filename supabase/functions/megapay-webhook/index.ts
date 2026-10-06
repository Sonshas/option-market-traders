import 'jsr:@supabase/functions-js/edge-runtime.d.ts'
import type { SupabaseClient } from 'npm:@supabase/supabase-js@2'
import {
  MEGAPAY_PROVIDER,
  classifyMegapayStatus,
  decideWebhookRoute,
  extractWebhookFields,
  isJsonObject,
  isOmtReference,
  type WebhookFields,
} from '../_shared/megapay.ts'
import {
  DEPOSIT_COLUMNS,
  adminClient,
  credentialsConfigured,
  loadDeposit,
  reconcileDeposit,
  serverConfig,
  transactionStatus,
  type DepositRow,
  type ServerConfig,
} from '../_shared/server.ts'

// Public endpoint (verify_jwt=false). MegaPay webhooks are unsigned, so payloads are only used for routing:
// our deposits are always re-verified with /transactionstatus before any credit.

const MAX_BODY_BYTES = 64 * 1024
const FORWARD_TIMEOUT_MS = 8_000
const MAX_FORWARD_ATTEMPTS = 5
const RETRY_WINDOW_MS = 24 * 60 * 60 * 1000
const RETRY_MIN_GAP_MS = 60 * 1000

function ok(body: Record<string, unknown> = { status: 'received' }) {
  return new Response(JSON.stringify(body), { status: 200, headers: { 'Content-Type': 'application/json' } })
}

async function findOurDeposit(admin: SupabaseClient, fields: WebhookFields): Promise<DepositRow | null> {
  if (fields.transactionId) {
    const { data } = await admin
      .from('deposits')
      .select(DEPOSIT_COLUMNS)
      .eq('provider', MEGAPAY_PROVIDER)
      .eq('provider_reference', fields.transactionId)
      .maybeSingle()
    if (data) return data as DepositRow
  }
  if (isOmtReference(fields.reference)) {
    const { data } = await admin
      .from('deposits')
      .select(DEPOSIT_COLUMNS)
      .eq('provider', MEGAPAY_PROVIDER)
      .eq('details->>reference', fields.reference!.trim().toUpperCase())
      .maybeSingle()
    if (data) return data as DepositRow
  }
  return null
}

async function processOurs(admin: SupabaseClient, cfg: ServerConfig, eventId: string, fields: WebhookFields, found: DepositRow | null) {
  let result = 'no_matching_deposit'
  try {
    let deposit = found
    if (deposit && !deposit.provider_reference && fields.transactionId && credentialsConfigured(cfg)) {
      // The STK request id was never stored (initiation timed out). Bind it only if MegaPay confirms it is ours.
      const status = await transactionStatus(cfg, fields.transactionId)
      const verified = classifyMegapayStatus(status.body)
      if (verified.reference?.toUpperCase() === String(deposit.details?.reference)) {
        await admin.from('deposits').update({ provider_reference: fields.transactionId }).eq('id', deposit.id).is('provider_reference', null)
        deposit = await loadDeposit(admin, deposit.id)
      } else {
        result = 'reference_not_verified'
        deposit = null
      }
    }
    if (deposit) {
      const settled = await reconcileDeposit(admin, cfg, deposit)
      result = `deposit_${settled.status.toLowerCase()}`
    }
  } catch (err) {
    result = `error: ${String(err).slice(0, 200)}`
  }
  await admin.from('megapay_webhook_events').update({ processed: true, process_result: result }).eq('id', eventId)
}

async function forwardEvent(admin: SupabaseClient, cfg: ServerConfig, event: { id: string; raw_body: string; content_type: string | null }) {
  let forwardStatus: number | null = null
  let forwardError: string | null = null
  try {
    const res = await fetch(cfg.vastWebhookUrl, {
      method: 'POST',
      headers: { 'Content-Type': event.content_type || 'application/json' },
      body: event.raw_body,
      signal: AbortSignal.timeout(FORWARD_TIMEOUT_MS),
    })
    forwardStatus = res.status
    if (!res.ok) forwardError = (await res.text()).slice(0, 300)
    else await res.body?.cancel()
  } catch (err) {
    forwardError = String(err).slice(0, 300)
  }
  await admin
    .from('megapay_webhook_events')
    .update({ forward_status: forwardStatus, forward_error: forwardError, processed: forwardStatus != null && forwardStatus < 300 })
    .eq('id', event.id)
}

async function retryUnforwarded(admin: SupabaseClient, cfg: ServerConfig, excludeId: string) {
  const now = Date.now()
  const { data } = await admin
    .from('megapay_webhook_events')
    .select('id, raw_body, content_type, attempts, last_attempt_at')
    .eq('routed_to', 'vast')
    .neq('id', excludeId)
    .lt('attempts', MAX_FORWARD_ATTEMPTS)
    .gte('received_at', new Date(now - RETRY_WINDOW_MS).toISOString())
    .lt('last_attempt_at', new Date(now - RETRY_MIN_GAP_MS).toISOString())
    .or('forward_status.is.null,forward_status.lt.200,forward_status.gte.300')
    .order('received_at', { ascending: true })
    .limit(5)
  for (const event of data ?? []) {
    // Optimistic claim so concurrent webhook calls never forward the same event twice at once.
    const { data: claimed } = await admin
      .from('megapay_webhook_events')
      .update({ attempts: event.attempts + 1, last_attempt_at: new Date().toISOString() })
      .eq('id', event.id)
      .eq('attempts', event.attempts)
      .select('id')
    if (claimed?.length) await forwardEvent(admin, cfg, event)
  }
}

Deno.serve(async (req) => {
  if (req.method === 'GET' || req.method === 'HEAD') return ok({ status: 'ok', service: 'megapay-webhook' })
  if (req.method !== 'POST') return new Response('Method not allowed', { status: 405 })

  const declared = Number(req.headers.get('content-length') ?? '0')
  if (declared > MAX_BODY_BYTES) return new Response('Payload too large', { status: 413 })
  const rawBody = await req.text()
  if (rawBody.length > MAX_BODY_BYTES) return new Response('Payload too large', { status: 413 })

  let payload: unknown = null
  try {
    payload = JSON.parse(rawBody)
  } catch {
    payload = null
  }

  const cfg = serverConfig()
  const admin = adminClient()
  const fields = extractWebhookFields(payload)
  const ours = isJsonObject(payload) ? await findOurDeposit(admin, fields) : null
  const route = decideWebhookRoute(payload, fields, ours != null)
  const contentType = req.headers.get('content-type')

  const { data: event, error } = await admin
    .from('megapay_webhook_events')
    .insert({
      payload: isJsonObject(payload) ? payload : null,
      raw_body: rawBody,
      content_type: contentType,
      reference: fields.reference,
      transaction_id: fields.transactionId,
      routed_to: route,
      attempts: route === 'vast' ? 1 : 0,
      last_attempt_at: route === 'vast' ? new Date().toISOString() : null,
      processed: route === 'unknown',
      process_result: route === 'unknown' ? (rawBody.trim() ? 'not_json_object' : 'empty_body') : null,
    })
    .select('id')
    .single()
  if (error || !event) {
    console.error('webhook event insert failed', error?.message)
    // Still forward non-OMT events so the other site is not affected by our logging failure.
    if (route === 'vast') {
      await fetch(cfg.vastWebhookUrl, {
        method: 'POST',
        headers: { 'Content-Type': contentType || 'application/json' },
        body: rawBody,
        signal: AbortSignal.timeout(FORWARD_TIMEOUT_MS),
      }).catch((err) => console.error('direct forward failed', String(err)))
    }
    return ok()
  }

  const work = (async () => {
    if (route === 'omt') await processOurs(admin, cfg, event.id, fields, ours)
    else if (route === 'vast') await forwardEvent(admin, cfg, { id: event.id, raw_body: rawBody, content_type: contentType })
    await retryUnforwarded(admin, cfg, event.id)
  })().catch((err) => console.error('webhook background work failed', String(err)))

  EdgeRuntime.waitUntil(work)
  return ok()
})
