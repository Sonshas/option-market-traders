// Canonical: apps/web/src/domain/payments/megapay.ts
// Mirror: supabase/functions/_shared/payments/megapay.ts (must stay byte-identical)
// Pure MegaPay (M-Pesa) deposit logic shared by the web app and the Supabase Edge Functions.

export const MEGAPAY_REFERENCE_PREFIX = 'OMT-'
export const MEGAPAY_PROVIDER = 'megapay'
export const DEFAULT_KES_PER_USD = 130
export const DEFAULT_MIN_KES = 1600
export const DEFAULT_MAX_KES = 150_000
export const DEPOSIT_EXPIRY_MS = 10 * 60 * 1000

// M-Pesa AccountReference allows at most 12 characters: "OMT-" + 8.
const REFERENCE_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'
const REFERENCE_BODY_LENGTH = 8

const FAILURE_CODES = new Set(['1', '1001', '1019', '1025', '1032', '1037', '2001', '9999'])

export type WebhookRoute = 'omt' | 'vast' | 'unknown'
export type StatusOutcome = 'completed' | 'failed' | 'cancelled' | 'pending'

export interface MegapayConfig {
  kesPerUsd: number
  minKes: number
  maxKes: number
}

function positiveNumber(raw: string | undefined | null, fallback: number): number {
  const n = Number(raw)
  return raw != null && raw.trim() !== '' && Number.isFinite(n) && n > 0 ? n : fallback
}

export function parseMegapayConfig(env: Record<string, string | undefined>): MegapayConfig {
  const kesPerUsd = Math.round(positiveNumber(env.KES_PER_USD, DEFAULT_KES_PER_USD) * 10_000) / 10_000
  const minKes = Math.ceil(positiveNumber(env.MEGAPAY_MIN_KES, DEFAULT_MIN_KES))
  const maxKes = Math.floor(positiveNumber(env.MEGAPAY_MAX_KES, DEFAULT_MAX_KES))
  return { kesPerUsd, minKes, maxKes: Math.max(minKes, maxKes) }
}

/** Normalizes 07XXXXXXXX / 01XXXXXXXX / 7XXXXXXXX / +2547... / 2541... to 2547XXXXXXXX or 2541XXXXXXXX. */
export function normalizeKenyanPhone(input: string): string | null {
  const digits = String(input ?? '')
    .replace(/[\s\-().]/g, '')
    .replace(/^\+/, '')
  if (!/^\d+$/.test(digits)) return null
  let local: string
  if (/^0[17]\d{8}$/.test(digits)) local = digits.slice(1)
  else if (/^[17]\d{8}$/.test(digits)) local = digits
  else if (/^254[17]\d{8}$/.test(digits)) local = digits.slice(3)
  else return null
  return `254${local}`
}

export function maskPhone(msisdn: string): string {
  return msisdn.length > 6 ? `${msisdn.slice(0, 6)}***${msisdn.slice(-3)}` : '***'
}

/** KES → USD rounded half-up to cents, computed in integers so it matches Postgres round(kes / rate, 2). */
export function kesToUsd(amountKes: number, kesPerUsd: number): number {
  const rateScaled = Math.round(kesPerUsd * 10_000)
  if (!Number.isFinite(amountKes) || amountKes <= 0 || rateScaled <= 0) return 0
  const numerator = Math.round(amountKes) * 1_000_000
  const cents = Math.floor((2 * numerator + rateScaled) / (2 * rateScaled))
  return cents / 100
}

export function validateAmountKes(value: unknown, config: MegapayConfig): { ok: true; amountKes: number } | { ok: false; error: string } {
  const n = typeof value === 'string' && value.trim() !== '' ? Number(value) : value
  if (typeof n !== 'number' || !Number.isFinite(n) || !Number.isInteger(n)) {
    return { ok: false, error: 'Enter a whole amount in KES.' }
  }
  if (n < config.minKes) return { ok: false, error: `Minimum deposit is KES ${config.minKes}.` }
  if (n > config.maxKes) return { ok: false, error: `Maximum deposit is KES ${config.maxKes}.` }
  return { ok: true, amountKes: n }
}

export function generateDepositReference(
  random: (length: number) => ArrayLike<number> = (length) => crypto.getRandomValues(new Uint8Array(length)),
): string {
  const bytes = random(REFERENCE_BODY_LENGTH)
  let body = ''
  for (let i = 0; i < REFERENCE_BODY_LENGTH; i++) body += REFERENCE_ALPHABET.charAt((bytes[i] ?? 0) % REFERENCE_ALPHABET.length)
  return `${MEGAPAY_REFERENCE_PREFIX}${body}`
}

export function isDepositReference(value: string): boolean {
  return new RegExp(`^${MEGAPAY_REFERENCE_PREFIX}[${REFERENCE_ALPHABET}]{${REFERENCE_BODY_LENGTH}}$`).test(value)
}

export function isOmtReference(value: unknown): boolean {
  return typeof value === 'string' && value.trim().toUpperCase().startsWith(MEGAPAY_REFERENCE_PREFIX)
}

export interface WebhookFields {
  reference: string | null
  transactionId: string | null
  checkoutRequestId: string | null
  responseCode: string | null
  amountKes: number | null
  receipt: string | null
}

function str(value: unknown): string | null {
  if (value == null) return null
  const s = String(value).trim()
  return s === '' ? null : s
}

export function extractWebhookFields(payload: unknown): WebhookFields {
  const p: Record<string, unknown> = isJsonObject(payload) ? payload : {}
  const amount = Number(p.TransactionAmount)
  return {
    reference: str(p.TransactionReference),
    transactionId: str(p.TransactionID),
    checkoutRequestId: str(p.CheckoutRequestID),
    responseCode: str(p.ResponseCode),
    amountKes: p.TransactionAmount != null && Number.isFinite(amount) ? amount : null,
    receipt: str(p.TransactionReceipt),
  }
}

export function isJsonObject(payload: unknown): payload is Record<string, unknown> {
  return payload != null && typeof payload === 'object' && !Array.isArray(payload)
}

/**
 * Decides which site a MegaPay webhook belongs to. OMT references (or a transaction id that matches one of
 * our deposits) are processed here; any other JSON object is forwarded to the other site. Empty or
 * non-JSON bodies are logged only, never forwarded.
 */
export function decideWebhookRoute(payload: unknown, fields: WebhookFields, matchesOurDeposit: boolean): WebhookRoute {
  if (!isJsonObject(payload)) return 'unknown'
  if (matchesOurDeposit || isOmtReference(fields.reference)) return 'omt'
  return 'vast'
}

export interface StatusClassification {
  outcome: StatusOutcome
  amountKes: number | null
  receipt: string | null
  reference: string | null
  description: string
}

/** Interprets a MegaPay /transactionstatus response. Only an explicit Completed + code 0 counts as paid. */
export function classifyMegapayStatus(body: unknown): StatusClassification {
  const b = body && typeof body === 'object' ? (body as Record<string, unknown>) : {}
  const status = (str(b.TransactionStatus) ?? '').toLowerCase()
  const code = str(b.TransactionCode) ?? ''
  const amount = Number(b.TransactionAmount)
  const base = {
    amountKes: b.TransactionAmount != null && Number.isFinite(amount) ? amount : null,
    receipt: str(b.TransactionReceipt),
    reference: str(b.TransactionReference),
    description: str(b.ResultDesc) ?? str(b.TransactionStatus) ?? 'Unknown',
  }
  if (status === 'completed' && code === '0') return { outcome: 'completed', ...base }
  if (code === '1032' || /cancel/.test(status)) return { outcome: 'cancelled', ...base }
  if (/fail|expire|revers|declin|timeout|reject/.test(status)) return { outcome: 'failed', ...base }
  if (FAILURE_CODES.has(code) && status !== 'completed' && !/pend|process|queue/.test(status)) {
    return { outcome: 'failed', ...base }
  }
  return { outcome: 'pending', ...base }
}
