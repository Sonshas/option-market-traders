import { createClient, type SupabaseClient } from 'npm:@supabase/supabase-js@2'
import {
  DEPOSIT_EXPIRY_MS,
  MEGAPAY_PROVIDER,
  classifyMegapayStatus,
  parseMegapayConfig,
  type MegapayConfig,
} from './megapay.ts'

const MEGAPAY_BASE = 'https://megapay.co.ke/backend/v1'
export const DEFAULT_VAST_WEBHOOK_URL = 'https://vastderiv-traders.com/api/megapay/webhook'
export const UNAVAILABLE_MESSAGE = 'Deposits temporarily unavailable'

export const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
}

export function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  })
}

export interface ServerConfig extends MegapayConfig {
  apiKey: string | null
  email: string | null
  vastWebhookUrl: string
}

export function serverConfig(): ServerConfig {
  const env = Deno.env.toObject()
  return {
    ...parseMegapayConfig(env),
    apiKey: env.MEGAPAY_API_KEY?.trim() || null,
    email: env.MEGAPAY_EMAIL?.trim() || null,
    vastWebhookUrl: env.VAST_WEBHOOK_URL?.trim() || DEFAULT_VAST_WEBHOOK_URL,
  }
}

export function credentialsConfigured(cfg: ServerConfig): boolean {
  return Boolean(cfg.apiKey && cfg.email)
}

export function adminClient(): SupabaseClient {
  return createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!, {
    auth: { persistSession: false, autoRefreshToken: false },
  })
}

export async function userFromRequest(admin: SupabaseClient, req: Request) {
  const token = (req.headers.get('Authorization') ?? '').replace(/^Bearer\s+/i, '')
  if (!token) return null
  const { data, error } = await admin.auth.getUser(token)
  if (error || !data.user) return null
  return data.user
}

export async function realPaymentsEnabled(admin: SupabaseClient): Promise<boolean> {
  const { data } = await admin.from('feature_flags').select('value').eq('key', 'REAL_PAYMENTS_ENABLED').maybeSingle()
  return data?.value === true
}

async function megapayPost(path: string, body: Record<string, unknown>, timeoutMs: number) {
  const res = await fetch(`${MEGAPAY_BASE}/${path}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(timeoutMs),
  })
  const text = await res.text()
  let parsed: Record<string, unknown> = {}
  try {
    parsed = JSON.parse(text)
  } catch {
    parsed = { raw: text.slice(0, 500) }
  }
  return { httpStatus: res.status, body: parsed }
}

export async function initiateStk(cfg: ServerConfig, amountKes: number, msisdn: string, reference: string) {
  return megapayPost(
    'initiatestk',
    { api_key: cfg.apiKey, email: cfg.email, amount: amountKes, msisdn, reference },
    20_000,
  )
}

export async function transactionStatus(cfg: ServerConfig, transactionRequestId: string) {
  return megapayPost(
    'transactionstatus',
    { api_key: cfg.apiKey, email: cfg.email, transaction_request_id: transactionRequestId },
    10_000,
  )
}

export interface DepositRow {
  id: string
  user_id: string
  amount: number | string
  currency: string
  status: string
  provider: string | null
  provider_reference: string | null
  details: Record<string, unknown>
  created_at: string
}

export const DEPOSIT_COLUMNS = 'id, user_id, amount, currency, status, provider, provider_reference, details, created_at'

export async function loadDeposit(admin: SupabaseClient, id: string): Promise<DepositRow | null> {
  const { data } = await admin.from('deposits').select(DEPOSIT_COLUMNS).eq('id', id).maybeSingle()
  return (data as DepositRow | null) ?? null
}

async function failDeposit(admin: SupabaseClient, id: string, status: 'FAILED' | 'CANCELLED', kind: string, reason: string, raw: unknown) {
  const { error } = await admin.rpc('fail_megapay_deposit', {
    p_deposit_id: id,
    p_status: status,
    p_kind: kind,
    p_reason: reason,
    p_raw: raw ?? {},
  })
  if (error) console.error('fail_megapay_deposit', id, error.message)
}

function isCreditable(d: DepositRow): boolean {
  return d.status === 'PENDING' || d.status === 'PROCESSING' || (d.status === 'FAILED' && d.details?.failure_kind === 'expired')
}

/**
 * Re-verifies a MegaPay deposit with /transactionstatus and settles it. Never trusts webhook payloads:
 * money is credited only when MegaPay itself reports Completed with the exact KES amount.
 */
export async function reconcileDeposit(admin: SupabaseClient, cfg: ServerConfig, deposit: DepositRow): Promise<DepositRow> {
  if (deposit.provider !== MEGAPAY_PROVIDER || !isCreditable(deposit)) return deposit
  const pending = deposit.status === 'PENDING' || deposit.status === 'PROCESSING'
  const expired = pending && Date.now() - Date.parse(deposit.created_at) > DEPOSIT_EXPIRY_MS

  if (!deposit.provider_reference || !credentialsConfigured(cfg)) {
    if (expired) await failDeposit(admin, deposit.id, 'FAILED', 'expired', 'No confirmation from M-Pesa in time', {})
    return (await loadDeposit(admin, deposit.id)) ?? deposit
  }

  let status
  try {
    status = await transactionStatus(cfg, deposit.provider_reference)
  } catch (err) {
    console.error('transactionstatus error', deposit.id, String(err))
    if (expired) await failDeposit(admin, deposit.id, 'FAILED', 'expired', 'No confirmation from M-Pesa in time', {})
    return (await loadDeposit(admin, deposit.id)) ?? deposit
  }

  const result = classifyMegapayStatus(status.body)
  const expectedKes = Number(deposit.details?.amount_kes)

  if (result.outcome === 'completed') {
    if (result.amountKes !== expectedKes) {
      console.error('amount mismatch', deposit.id, result.amountKes, expectedKes)
      if (pending) await failDeposit(admin, deposit.id, 'FAILED', 'amount_mismatch', 'Paid amount did not match the request', status.body)
    } else {
      const { error } = await admin.rpc('credit_megapay_deposit', {
        p_deposit_id: deposit.id,
        p_receipt: result.receipt ?? '',
        p_amount_kes: result.amountKes,
        p_raw: status.body,
      })
      if (error) console.error('credit_megapay_deposit', deposit.id, error.message)
    }
  } else if ((result.outcome === 'failed' || result.outcome === 'cancelled') && pending) {
    await failDeposit(
      admin,
      deposit.id,
      result.outcome === 'cancelled' ? 'CANCELLED' : 'FAILED',
      'megapay_' + result.outcome,
      result.description,
      status.body,
    )
  } else if (expired) {
    await failDeposit(admin, deposit.id, 'FAILED', 'expired', 'No confirmation from M-Pesa in time', status.body)
  }

  return (await loadDeposit(admin, deposit.id)) ?? deposit
}

export function publicDeposit(d: DepositRow) {
  return {
    deposit_id: d.id,
    reference: (d.details?.reference as string | undefined) ?? null,
    status: d.status,
    amount_usd: Number(d.amount),
    amount_kes: Number(d.details?.amount_kes),
    rate: Number(d.details?.rate),
    receipt: (d.details?.mpesa_receipt as string | undefined) ?? null,
    failure_reason: d.status === 'COMPLETED' ? null : ((d.details?.failure_reason as string | undefined) ?? null),
    created_at: d.created_at,
  }
}
