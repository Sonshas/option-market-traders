// Pure Safaricom Daraja (M-Pesa Express / STK Push) logic shared by the web app and the Supabase Edge Functions.
// supabase/functions/_shared/daraja.ts must stay byte-identical to this file (enforced by daraja.test.ts).

export const DARAJA_PROVIDER = 'daraja'
export type DepositProvider = 'daraja' | 'megapay'
export const DEFAULT_DEPOSIT_PROVIDER: DepositProvider = 'daraja'
export const DEFAULT_DARAJA_CALLBACK_URL = 'https://optionmarkettraders.com/api/mpesa/callback'
export const DARAJA_PRODUCTION_BASE = 'https://api.safaricom.co.ke'
export const DARAJA_SANDBOX_BASE = 'https://sandbox.safaricom.co.ke'
export const DARAJA_EXPIRY_MS = 10 * 60 * 1000
/** A pending deposit is STK-queried by the status poll only after this long (the callback usually wins). */
export const STK_QUERY_AFTER_MS = 30 * 1000
/** Minimum spacing between STK queries for one deposit (Daraja rate-limits the query API). */
export const STK_QUERY_MIN_GAP_MS = 10 * 1000
/** The cron sweep only touches deposits older than this. */
export const SWEEP_MIN_AGE_MS = 2 * 60 * 1000
export const ACCOUNT_REFERENCE_MAX = 12
/** Shown as "Account no." in the customer's STK prompt. Never used for matching (CheckoutRequestID is). */
export const DEFAULT_ACCOUNT_REFERENCE = 'OPTIONMARKET'
export const DEFAULT_TRANSACTION_DESC = 'Deposit'
export const TRANSACTION_DESC_MAX = 13

const NAIROBI_OFFSET_MS = 3 * 60 * 60 * 1000 // Africa/Nairobi is UTC+3 all year (no DST).
const STILL_PROCESSING_RESULT_CODES = new Set(['4999'])
const STILL_PROCESSING_ERROR_CODES = new Set(['500.001.1001'])

export type DarajaOutcome = 'completed' | 'cancelled' | 'failed' | 'pending'

export function parseDepositProvider(raw: string | undefined | null): DepositProvider {
  const v = String(raw ?? '').trim().toLowerCase()
  return v === 'megapay' ? 'megapay' : DEFAULT_DEPOSIT_PROVIDER
}

export function darajaBaseUrl(env: string | undefined | null): string {
  return String(env ?? '').trim().toLowerCase() === 'sandbox' ? DARAJA_SANDBOX_BASE : DARAJA_PRODUCTION_BASE
}

/** YYYYMMDDHHmmss in Africa/Nairobi time, as required for the STK Push Password and Timestamp. */
export function darajaTimestamp(date: Date = new Date()): string {
  const d = new Date(date.getTime() + NAIROBI_OFFSET_MS)
  const p = (n: number) => String(n).padStart(2, '0')
  return `${d.getUTCFullYear()}${p(d.getUTCMonth() + 1)}${p(d.getUTCDate())}${p(d.getUTCHours())}${p(d.getUTCMinutes())}${p(d.getUTCSeconds())}`
}

/** base64(BusinessShortCode + Passkey + Timestamp). */
export function darajaPassword(shortcode: string, passkey: string, timestamp: string): string {
  return btoa(`${shortcode}${passkey}${timestamp}`)
}

/** MPESA_ACCOUNT_REFERENCE override (or the default), trimmed and cut to Daraja's 12-character limit. */
export function accountReference(raw?: string | null): string {
  const value = String(raw ?? '').trim()
  return (value || DEFAULT_ACCOUNT_REFERENCE).slice(0, ACCOUNT_REFERENCE_MAX)
}

export interface StkPushRequestInput {
  shortcode: string
  passkey: string
  amountKes: number
  msisdn: string
  callbackUrl: string
  accountReference?: string | null
  description?: string
  now?: Date
}

export function buildStkPushRequest(input: StkPushRequestInput): Record<string, string | number> {
  const timestamp = darajaTimestamp(input.now)
  return {
    BusinessShortCode: input.shortcode,
    Password: darajaPassword(input.shortcode, input.passkey, timestamp),
    Timestamp: timestamp,
    TransactionType: 'CustomerPayBillOnline',
    Amount: Math.round(input.amountKes),
    PartyA: input.msisdn,
    PartyB: input.shortcode,
    PhoneNumber: input.msisdn,
    CallBackURL: input.callbackUrl,
    AccountReference: accountReference(input.accountReference),
    TransactionDesc: (input.description?.trim() || DEFAULT_TRANSACTION_DESC).slice(0, TRANSACTION_DESC_MAX),
  }
}

export function buildStkQueryRequest(shortcode: string, passkey: string, checkoutRequestId: string, now?: Date): Record<string, string> {
  const timestamp = darajaTimestamp(now)
  return {
    BusinessShortCode: shortcode,
    Password: darajaPassword(shortcode, passkey, timestamp),
    Timestamp: timestamp,
    CheckoutRequestID: checkoutRequestId,
  }
}

function isObject(value: unknown): value is Record<string, unknown> {
  return value != null && typeof value === 'object' && !Array.isArray(value)
}

function str(value: unknown): string | null {
  if (value == null) return null
  const s = String(value).trim()
  return s === '' ? null : s
}

export interface ParsedStkCallback {
  ok: true
  merchantRequestId: string | null
  checkoutRequestId: string
  resultCode: number
  resultDesc: string
  outcome: Exclude<DarajaOutcome, 'pending'>
  amountKes: number | null
  receipt: string | null
  phone: string | null
  transactionDate: string | null
}

export type StkCallbackParseResult = ParsedStkCallback | { ok: false; error: string }

export function resultCodeOutcome(code: string | number): Exclude<DarajaOutcome, 'pending'> {
  const c = String(code).trim()
  if (c === '0') return 'completed'
  if (c === '1032') return 'cancelled'
  return 'failed'
}

/** Parses a Daraja STK callback ({ Body: { stkCallback } }). Callbacks are unsigned: use only as a hint. */
export function parseStkCallback(payload: unknown): StkCallbackParseResult {
  const body = isObject(payload) && isObject(payload.Body) ? payload.Body : null
  const cb = body && isObject(body.stkCallback) ? body.stkCallback : null
  if (!cb) return { ok: false, error: 'missing_stk_callback' }
  const checkoutRequestId = str(cb.CheckoutRequestID)
  if (!checkoutRequestId || checkoutRequestId.length > 100) return { ok: false, error: 'missing_checkout_request_id' }
  const rawCode = str(cb.ResultCode)
  const resultCode = rawCode != null && /^\d+$/.test(rawCode) ? Number(rawCode) : NaN
  if (!Number.isSafeInteger(resultCode)) return { ok: false, error: 'invalid_result_code' }

  const items = isObject(cb.CallbackMetadata) && Array.isArray(cb.CallbackMetadata.Item) ? cb.CallbackMetadata.Item : []
  const meta = new Map<string, unknown>()
  for (const item of items) if (isObject(item) && typeof item.Name === 'string') meta.set(item.Name, item.Value)
  const amount = Number(meta.get('Amount'))

  return {
    ok: true,
    merchantRequestId: str(cb.MerchantRequestID),
    checkoutRequestId,
    resultCode,
    resultDesc: str(cb.ResultDesc) ?? '',
    outcome: resultCodeOutcome(resultCode),
    amountKes: meta.has('Amount') && Number.isFinite(amount) ? amount : null,
    receipt: str(meta.get('MpesaReceiptNumber')),
    phone: str(meta.get('PhoneNumber')),
    transactionDate: str(meta.get('TransactionDate')),
  }
}

export interface StkQueryClassification {
  outcome: DarajaOutcome
  resultCode: string | null
  description: string
}

/**
 * Interprets an STK Push Query response. Only an explicit ResultCode 0 for the same CheckoutRequestID
 * counts as paid; "still processing", HTTP/auth errors and anything unrecognised stay pending.
 */
export function classifyStkQuery(body: unknown, expectedCheckoutRequestId?: string): StkQueryClassification {
  const b = isObject(body) ? body : {}
  const resultCode = str(b.ResultCode)
  const errorCode = str(b.errorCode)
  const description = str(b.ResultDesc) ?? str(b.errorMessage) ?? str(b.ResponseDescription) ?? 'Unknown'
  const checkout = str(b.CheckoutRequestID)
  if (expectedCheckoutRequestId && checkout && checkout !== expectedCheckoutRequestId) {
    return { outcome: 'pending', resultCode, description: 'CheckoutRequestID mismatch' }
  }
  if (errorCode && STILL_PROCESSING_ERROR_CODES.has(errorCode)) return { outcome: 'pending', resultCode, description }
  if (resultCode == null || !/^\d+$/.test(resultCode)) return { outcome: 'pending', resultCode, description }
  if (STILL_PROCESSING_RESULT_CODES.has(resultCode)) return { outcome: 'pending', resultCode, description }
  return { outcome: resultCodeOutcome(resultCode), resultCode, description }
}

export interface CallbackEvidence {
  amountKes: number | null
  receipt: string | null
}

export interface SettlementInput {
  status: string
  failureKind?: string | null
  expectedKes: number
  ageMs: number
  query: StkQueryClassification | null
  callback?: CallbackEvidence | null
}

export type SettlementDecision =
  | { action: 'none' }
  | { action: 'wait' }
  | { action: 'credit'; amountKes: number; receipt: string | null }
  | { action: 'fail'; status: 'FAILED' | 'CANCELLED'; kind: string; reason: string }

export function isOpenStatus(status: string): boolean {
  return status === 'PENDING' || status === 'PROCESSING'
}

/**
 * Decides what to do with a Daraja deposit. Money is credited only when the STK Push Query confirms
 * ResultCode 0; the callback contributes the receipt and, when present, its amount must match exactly.
 */
export function decideDarajaSettlement(input: SettlementInput): SettlementDecision {
  const open = isOpenStatus(input.status)
  const creditable = open || (input.status === 'FAILED' && input.failureKind === 'expired')
  if (!creditable) return { action: 'none' }
  const q = input.query

  if (q?.outcome === 'completed') {
    const paid = input.callback?.amountKes
    if (paid != null && paid !== input.expectedKes) {
      return open
        ? { action: 'fail', status: 'FAILED', kind: 'amount_mismatch', reason: 'Paid amount did not match the request' }
        : { action: 'none' }
    }
    return { action: 'credit', amountKes: input.expectedKes, receipt: input.callback?.receipt ?? null }
  }
  if (!open) return { action: 'none' }
  if (q?.outcome === 'cancelled') {
    return { action: 'fail', status: 'CANCELLED', kind: 'daraja_cancelled', reason: q.description || 'Request cancelled by user' }
  }
  if (q?.outcome === 'failed') {
    return { action: 'fail', status: 'FAILED', kind: 'daraja_failed', reason: q.description || 'M-Pesa payment failed' }
  }
  if (input.ageMs > DARAJA_EXPIRY_MS) {
    return { action: 'fail', status: 'FAILED', kind: 'expired', reason: 'No confirmation from M-Pesa in time' }
  }
  return { action: 'wait' }
}

/** Whether the status poll should spend an STK query on this deposit now. */
export function shouldQueryNow(ageMs: number, msSinceLastQuery: number | null, hasCallback: boolean): boolean {
  if (msSinceLastQuery != null && msSinceLastQuery < STK_QUERY_MIN_GAP_MS) return false
  return hasCallback || ageMs >= STK_QUERY_AFTER_MS
}
