import type { SupabaseClient } from 'npm:@supabase/supabase-js@2'
import {
  DARAJA_PROVIDER,
  DEFAULT_DARAJA_CALLBACK_URL,
  DEFAULT_TRANSACTION_DESC,
  SWEEP_MIN_AGE_MS,
  accountReference,
  buildStkPushRequest,
  buildStkQueryRequest,
  classifyStkQuery,
  darajaBaseUrl,
  decideDarajaSettlement,
  isOpenStatus,
  parseDepositProvider,
  shouldQueryNow,
  type CallbackEvidence,
  type DepositProvider,
  type StkQueryClassification,
} from './daraja.ts'
import { parseMegapayConfig, type MegapayConfig } from './megapay.ts'
import { DEPOSIT_COLUMNS, type DepositRow } from './server.ts'

export interface DarajaConfig extends MegapayConfig {
  provider: DepositProvider
  env: 'production' | 'sandbox'
  baseUrl: string
  shortcode: string | null
  passkey: string | null
  consumerKey: string | null
  consumerSecret: string | null
  callbackUrl: string
  accountReference: string
}

export function darajaConfig(): DarajaConfig {
  const env = Deno.env.toObject()
  const mode = env.MPESA_ENV?.trim().toLowerCase() === 'sandbox' ? 'sandbox' : 'production'
  return {
    ...parseMegapayConfig(env),
    provider: parseDepositProvider(env.DEPOSIT_PROVIDER),
    env: mode,
    baseUrl: darajaBaseUrl(mode),
    shortcode: env.MPESA_SHORTCODE?.trim() || null,
    passkey: env.MPESA_PASSKEY?.trim() || null,
    consumerKey: env.MPESA_CONSUMER_KEY?.trim() || null,
    consumerSecret: env.MPESA_CONSUMER_SECRET?.trim() || null,
    callbackUrl: env.MPESA_CALLBACK_URL?.trim() || DEFAULT_DARAJA_CALLBACK_URL,
    accountReference: accountReference(env.MPESA_ACCOUNT_REFERENCE),
  }
}

export function darajaConfigured(cfg: DarajaConfig): boolean {
  return Boolean(cfg.shortcode && cfg.passkey && cfg.consumerKey && cfg.consumerSecret)
}

export class DarajaAuthError extends Error {
  constructor(public httpStatus: number, message: string) {
    super(message)
  }
}

let tokenCache: { token: string; expiresAt: number; key: string } | null = null

export async function getAccessToken(cfg: DarajaConfig, force = false): Promise<string> {
  const key = `${cfg.baseUrl}|${cfg.consumerKey}`
  if (!force && tokenCache && tokenCache.key === key && Date.now() < tokenCache.expiresAt) return tokenCache.token
  const res = await fetch(`${cfg.baseUrl}/oauth/v1/generate?grant_type=client_credentials`, {
    method: 'GET',
    headers: { Authorization: `Basic ${btoa(`${cfg.consumerKey}:${cfg.consumerSecret}`)}`, Accept: 'application/json' },
    signal: AbortSignal.timeout(10_000),
  })
  const text = await res.text()
  let body: Record<string, unknown> = {}
  try {
    body = JSON.parse(text)
  } catch {
    body = {}
  }
  const token = body.access_token
  if (!res.ok || typeof token !== 'string' || !token) {
    tokenCache = null
    const message = String(body.errorMessage ?? body.error_description ?? body.error ?? (text.slice(0, 120) || 'no body'))
    throw new DarajaAuthError(res.status, message.slice(0, 200))
  }
  const ttlSeconds = Number(body.expires_in) || 3599
  tokenCache = { token, key, expiresAt: Date.now() + Math.max(60, ttlSeconds - 60) * 1000 }
  return token
}

export async function darajaPost(cfg: DarajaConfig, path: string, payload: Record<string, unknown>, timeoutMs: number) {
  const send = async (token: string) =>
    fetch(`${cfg.baseUrl}${path}`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json', Accept: 'application/json' },
      body: JSON.stringify(payload),
      signal: AbortSignal.timeout(timeoutMs),
    })
  let res = await send(await getAccessToken(cfg))
  if (res.status === 401) {
    await res.body?.cancel()
    res = await send(await getAccessToken(cfg, true))
  }
  const text = await res.text()
  let body: Record<string, unknown> = {}
  try {
    body = JSON.parse(text)
  } catch {
    body = { raw: text.slice(0, 300) }
  }
  return { httpStatus: res.status, body }
}

export function stkPush(cfg: DarajaConfig, amountKes: number, msisdn: string) {
  return darajaPost(
    cfg,
    '/mpesa/stkpush/v1/processrequest',
    buildStkPushRequest({
      shortcode: cfg.shortcode!,
      passkey: cfg.passkey!,
      amountKes,
      msisdn,
      callbackUrl: cfg.callbackUrl,
      accountReference: cfg.accountReference,
      description: DEFAULT_TRANSACTION_DESC,
    }),
    20_000,
  )
}

export function stkQuery(cfg: DarajaConfig, checkoutRequestId: string) {
  return darajaPost(cfg, '/mpesa/stkpushquery/v1/query', buildStkQueryRequest(cfg.shortcode!, cfg.passkey!, checkoutRequestId), 10_000)
}

export interface DarajaDepositRow extends DepositRow {
  merchant_request_id: string | null
  checkout_request_id: string | null
  mpesa_receipt: string | null
  result_code: string | null
  result_desc: string | null
  callback_amount_kes: number | string | null
  callback_at: string | null
  last_query_at: string | null
}

export const DARAJA_DEPOSIT_COLUMNS = `${DEPOSIT_COLUMNS}, merchant_request_id, checkout_request_id, mpesa_receipt, result_code, result_desc, callback_amount_kes, callback_at, last_query_at`

export async function loadDarajaDeposit(admin: SupabaseClient, id: string): Promise<DarajaDepositRow | null> {
  const { data } = await admin.from('deposits').select(DARAJA_DEPOSIT_COLUMNS).eq('id', id).maybeSingle()
  return (data as DarajaDepositRow | null) ?? null
}

export async function findByCheckoutRequestId(admin: SupabaseClient, checkoutRequestId: string): Promise<DarajaDepositRow | null> {
  const { data } = await admin
    .from('deposits')
    .select(DARAJA_DEPOSIT_COLUMNS)
    .eq('provider', DARAJA_PROVIDER)
    .eq('checkout_request_id', checkoutRequestId)
    .maybeSingle()
  return (data as DarajaDepositRow | null) ?? null
}

function storedCallback(d: DarajaDepositRow): CallbackEvidence | null {
  if (!d.callback_at) return null
  const amount = d.callback_amount_kes == null ? null : Number(d.callback_amount_kes)
  return { amountKes: amount != null && Number.isFinite(amount) ? amount : null, receipt: d.mpesa_receipt }
}

/**
 * Settles a Daraja deposit. Callbacks are unsigned, so money is credited only after an STK Push Query
 * confirms ResultCode 0; the stored callback contributes the receipt and its amount must match.
 */
export async function reconcileDarajaDeposit(
  admin: SupabaseClient,
  cfg: DarajaConfig,
  deposit: DarajaDepositRow,
  opts: { force?: boolean } = {},
): Promise<DarajaDepositRow> {
  if (deposit.provider !== DARAJA_PROVIDER) return deposit
  const creditable = isOpenStatus(deposit.status) || (deposit.status === 'FAILED' && deposit.details?.failure_kind === 'expired')
  if (!creditable) return deposit
  const now = Date.now()
  const ageMs = now - Date.parse(deposit.created_at)
  const callback = storedCallback(deposit)
  const sinceLastQuery = deposit.last_query_at ? now - Date.parse(deposit.last_query_at) : null

  let query: StkQueryClassification | null = null
  let queryBody: unknown = {}
  if (
    darajaConfigured(cfg) &&
    deposit.checkout_request_id &&
    (opts.force || shouldQueryNow(ageMs, sinceLastQuery, callback != null))
  ) {
    await admin.from('deposits').update({ last_query_at: new Date(now).toISOString() }).eq('id', deposit.id)
    try {
      const res = await stkQuery(cfg, deposit.checkout_request_id)
      queryBody = res.body
      query = classifyStkQuery(res.body, deposit.checkout_request_id)
      if (query.resultCode != null && query.outcome !== 'pending') {
        await admin
          .from('deposits')
          .update({ result_code: query.resultCode, result_desc: query.description.slice(0, 300) })
          .eq('id', deposit.id)
      }
    } catch (err) {
      console.error('stk query error', deposit.id, err instanceof DarajaAuthError ? `oauth ${err.httpStatus}` : String(err).slice(0, 200))
    }
  }

  const decision = decideDarajaSettlement({
    status: deposit.status,
    failureKind: (deposit.details?.failure_kind as string | undefined) ?? null,
    expectedKes: Number(deposit.details?.amount_kes),
    ageMs,
    query,
    callback,
  })

  if (decision.action === 'credit') {
    const { error } = await admin.rpc('credit_megapay_deposit', {
      p_deposit_id: deposit.id,
      p_receipt: decision.receipt ?? '',
      p_amount_kes: decision.amountKes,
      p_raw: { source: 'daraja_stk_query', query: queryBody, callback_amount_kes: callback?.amountKes ?? null },
    })
    if (error) console.error('credit daraja deposit failed', deposit.id, error.message)
    else console.log('daraja deposit credited', deposit.id)
  } else if (decision.action === 'fail') {
    const { error } = await admin.rpc('fail_megapay_deposit', {
      p_deposit_id: deposit.id,
      p_status: decision.status,
      p_kind: decision.kind,
      p_reason: decision.reason,
      p_raw: queryBody ?? {},
    })
    if (error) console.error('fail daraja deposit failed', deposit.id, error.message)
    else console.log('daraja deposit', decision.status.toLowerCase(), deposit.id, decision.kind)
  }

  return (await loadDarajaDeposit(admin, deposit.id)) ?? deposit
}

export async function sweepDarajaDeposits(admin: SupabaseClient, cfg: DarajaConfig, limit = 25) {
  const { data, error } = await admin
    .from('deposits')
    .select(DARAJA_DEPOSIT_COLUMNS)
    .eq('provider', DARAJA_PROVIDER)
    .in('status', ['PENDING', 'PROCESSING'])
    .lt('created_at', new Date(Date.now() - SWEEP_MIN_AGE_MS).toISOString())
    .order('created_at', { ascending: true })
    .limit(limit)
  if (error) throw new Error(error.message)
  const results: Array<{ id: string; status: string }> = []
  for (const row of (data ?? []) as DarajaDepositRow[]) {
    const settled = await reconcileDarajaDeposit(admin, cfg, row)
    results.push({ id: row.id, status: settled.status })
  }
  return results
}
