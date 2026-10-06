// Pure REAL withdrawal (M-Pesa payout) logic shared by the web app and the Supabase Edge Functions.
// supabase/functions/_shared/withdrawals.ts must stay byte-identical to this file (enforced by withdrawals.test.ts).
//
// Money rules (non-negotiable):
//  - a withdrawal is COMPLETED only when M-Pesa confirmed the payout (Daraja B2C result callback) or an admin
//    recorded a manual payout with the M-Pesa receipt. Nothing here ever marks a payout as done on its own;
//  - the only deduction is the fixed WITHDRAWAL_FEE_KES (default 0), shown before the user submits and taken
//    from the payout. There are no post-submission charges of any kind.

export const WITHDRAWAL_REFERENCE_PREFIX = 'OMT-W-'
export const DEFAULT_WITHDRAWAL_MIN_KES = 1000
export const DEFAULT_WITHDRAWAL_MAX_KES = 400_000
/** Owner rule: no single payout above KES 400,000, whatever WITHDRAWAL_MAX_KES says (also enforced in the DB). */
export const WITHDRAWAL_HARD_MAX_KES = 400_000
/** Owner rule: at least one settled REAL trade (won or lost) before the first payout. */
export const NO_REAL_TRADE_MESSAGE = 'Complete at least one REAL trade before withdrawing.'
export const DEFAULT_WITHDRAWAL_FEE_KES = 0
export const DEFAULT_B2C_RESULT_URL = 'https://optionmarkettraders.com/api/mpesa/b2c/result'
export const DEFAULT_B2C_TIMEOUT_URL = 'https://optionmarkettraders.com/api/mpesa/b2c/timeout'
export const B2C_COMMAND_ID = 'BusinessPayment'
export const B2C_REMARKS = 'Withdrawal'
/** Daraja B2C: OriginatorConversationID must be alphanumeric (plus '-') and under 20 characters. */
export const B2C_ORIGINATOR_MAX = 19

const REFERENCE_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'
const REFERENCE_BODY_LENGTH = 8

export type WithdrawalMode = 'manual' | 'daraja_b2c'
export type WithdrawalProvider = 'manual' | 'daraja_b2c'
export type WithdrawalStatus = 'PENDING' | 'PROCESSING' | 'COMPLETED' | 'FAILED' | 'CANCELLED'
export const WITHDRAWAL_STATUSES: readonly WithdrawalStatus[] = ['PENDING', 'PROCESSING', 'COMPLETED', 'FAILED', 'CANCELLED']

export interface WithdrawalConfig {
  mode: WithdrawalMode
  kesPerUsd: number
  minKes: number
  maxKes: number
  feeKes: number
}

function positiveNumber(raw: string | undefined | null, fallback: number): number {
  const n = Number(raw)
  return raw != null && raw.trim() !== '' && Number.isFinite(n) && n > 0 ? n : fallback
}

function nonNegativeInteger(raw: string | undefined | null, fallback: number): number {
  const n = Number(raw)
  return raw != null && raw.trim() !== '' && Number.isInteger(n) && n >= 0 ? n : fallback
}

export function parseWithdrawalMode(raw: string | undefined | null): WithdrawalMode {
  return String(raw ?? '').trim().toLowerCase() === 'daraja_b2c' ? 'daraja_b2c' : 'manual'
}

/** Reads WITHDRAWAL_MODE, KES_PER_USD, WITHDRAWAL_MIN_KES, WITHDRAWAL_MAX_KES and WITHDRAWAL_FEE_KES. */
export function parseWithdrawalConfig(env: Record<string, string | undefined>): WithdrawalConfig {
  const kesPerUsd = Math.round(positiveNumber(env.KES_PER_USD, 130) * 10_000) / 10_000
  const minKes = Math.ceil(positiveNumber(env.WITHDRAWAL_MIN_KES, DEFAULT_WITHDRAWAL_MIN_KES))
  const maxKes = Math.min(WITHDRAWAL_HARD_MAX_KES, Math.floor(positiveNumber(env.WITHDRAWAL_MAX_KES, DEFAULT_WITHDRAWAL_MAX_KES)))
  const feeKes = nonNegativeInteger(env.WITHDRAWAL_FEE_KES, DEFAULT_WITHDRAWAL_FEE_KES)
  return { mode: parseWithdrawalMode(env.WITHDRAWAL_MODE), kesPerUsd, minKes, maxKes: Math.max(minKes, maxKes), feeKes }
}

/** USD → whole KES, rounded half-up in integer arithmetic so it matches Postgres round(usd * rate). */
export function usdToKes(amountUsd: number, kesPerUsd: number): number {
  const rateScaled = Math.round(kesPerUsd * 10_000)
  if (!Number.isFinite(amountUsd) || amountUsd <= 0 || rateScaled <= 0) return 0
  const cents = Math.round(amountUsd * 100)
  return Math.floor((2 * cents * rateScaled + 1_000_000) / (2 * 1_000_000))
}

export interface WithdrawalQuote {
  amountUsd: number
  amountKes: number
  feeKes: number
  netKes: number
}

/** What the user will receive: gross KES at the fixed rate minus the (upfront, fixed) fee. */
export function quoteWithdrawal(amountUsd: number, config: Pick<WithdrawalConfig, 'kesPerUsd' | 'feeKes'>): WithdrawalQuote {
  const amountKes = usdToKes(amountUsd, config.kesPerUsd)
  const feeKes = Math.max(0, Math.round(config.feeKes))
  return { amountUsd, amountKes, feeKes, netKes: Math.max(0, amountKes - feeKes) }
}

export type AmountValidation = { ok: true; amountUsd: number; quote: WithdrawalQuote } | { ok: false; error: string }

/**
 * Validates a USD withdrawal amount against the KES limits, the fee and the available REAL balance.
 * `availableUsd` null means "unknown" (the server re-checks the wallet with a row lock anyway).
 */
export function validateWithdrawalAmountUsd(value: unknown, config: WithdrawalConfig, availableUsd: number | null): AmountValidation {
  const n = typeof value === 'string' && value.trim() !== '' ? Number(value) : value
  if (typeof n !== 'number' || !Number.isFinite(n) || n <= 0) return { ok: false, error: 'Enter an amount in USD.' }
  if (Math.abs(n * 100 - Math.round(n * 100)) > 1e-6) return { ok: false, error: 'Use at most two decimal places.' }
  const amountUsd = Math.round(n * 100) / 100
  const quote = quoteWithdrawal(amountUsd, config)
  if (quote.amountKes < config.minKes) {
    return { ok: false, error: `Minimum withdrawal is KES ${config.minKes.toLocaleString('en-US')} (about ${formatUsd(minUsdFor(config))}).` }
  }
  if (quote.amountKes > config.maxKes) {
    return { ok: false, error: `Maximum withdrawal is KES ${config.maxKes.toLocaleString('en-US')} per request.` }
  }
  if (quote.netKes <= 0) return { ok: false, error: 'Amount is too small after the fee.' }
  if (availableUsd != null && amountUsd > availableUsd + 1e-9) {
    return { ok: false, error: `You can withdraw up to ${formatUsd(availableUsd)}.` }
  }
  return { ok: true, amountUsd, quote }
}

/** Smallest USD amount (2 dp) whose KES equivalent reaches the minimum. */
export function minUsdFor(config: Pick<WithdrawalConfig, 'kesPerUsd' | 'minKes'>): number {
  return Math.ceil((config.minKes / config.kesPerUsd) * 100) / 100
}

function formatUsd(value: number): string {
  return `$${value.toFixed(2)}`
}

export function generateWithdrawalReference(
  random: (length: number) => ArrayLike<number> = (length) => crypto.getRandomValues(new Uint8Array(length)),
): string {
  const bytes = random(REFERENCE_BODY_LENGTH)
  let body = ''
  for (let i = 0; i < REFERENCE_BODY_LENGTH; i++) body += REFERENCE_ALPHABET.charAt((bytes[i] ?? 0) % REFERENCE_ALPHABET.length)
  return `${WITHDRAWAL_REFERENCE_PREFIX}${body}`
}

export function isWithdrawalReference(value: unknown): value is string {
  return typeof value === 'string' && new RegExp(`^${WITHDRAWAL_REFERENCE_PREFIX}[${REFERENCE_ALPHABET}]{${REFERENCE_BODY_LENGTH}}$`).test(value)
}

/** 2547XXXXXXXX → 07XX XXX XXX style local number for display. */
export function localPhoneDisplay(msisdn: string | null | undefined): string {
  if (!msisdn || !/^254[17]\d{8}$/.test(msisdn)) return msisdn ?? ''
  return `0${msisdn.slice(3)}`
}

export function maskMsisdn(msisdn: string | null | undefined): string {
  if (!msisdn) return ''
  return msisdn.length > 6 ? `${msisdn.slice(0, 6)}***${msisdn.slice(-3)}` : '***'
}

export interface B2cRequestInput {
  originatorConversationId: string
  initiatorName: string
  securityCredential: string
  shortcode: string
  amountKes: number
  msisdn: string
  resultUrl: string
  timeoutUrl: string
  remarks?: string
  occasion?: string
}

/** Daraja B2C v3 payload (POST /mpesa/b2c/v3/paymentrequest). */
export function buildB2cRequest(input: B2cRequestInput): Record<string, string | number> {
  return {
    OriginatorConversationID: input.originatorConversationId.slice(0, B2C_ORIGINATOR_MAX),
    InitiatorName: input.initiatorName,
    SecurityCredential: input.securityCredential,
    CommandID: B2C_COMMAND_ID,
    Amount: Math.round(input.amountKes),
    PartyA: input.shortcode,
    PartyB: input.msisdn,
    Remarks: (input.remarks?.trim() || B2C_REMARKS).slice(0, 100),
    QueueTimeOutURL: input.timeoutUrl,
    ResultURL: input.resultUrl,
    Occasion: (input.occasion?.trim() || B2C_REMARKS).slice(0, 100),
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

export interface ParsedB2cResult {
  ok: true
  resultCode: number
  resultDesc: string
  outcome: 'completed' | 'failed'
  originatorConversationId: string | null
  conversationId: string | null
  transactionId: string | null
  receipt: string | null
  amountKes: number | null
  receiverName: string | null
  completedAt: string | null
}

export type B2cResultParseResult = ParsedB2cResult | { ok: false; error: string }

/** Parses a Daraja B2C result/timeout callback ({ Result: {...} }). Callbacks are unsigned: match by our ids only. */
export function parseB2cResult(payload: unknown): B2cResultParseResult {
  const result = isObject(payload) && isObject(payload.Result) ? payload.Result : null
  if (!result) return { ok: false, error: 'missing_result' }
  const originator = str(result.OriginatorConversationID)
  const conversation = str(result.ConversationID)
  if (!originator && !conversation) return { ok: false, error: 'missing_conversation_ids' }
  if ((originator?.length ?? 0) > 100 || (conversation?.length ?? 0) > 100) return { ok: false, error: 'invalid_conversation_ids' }
  const rawCode = str(result.ResultCode)
  const resultCode = rawCode != null && /^\d+$/.test(rawCode) ? Number(rawCode) : NaN
  if (!Number.isSafeInteger(resultCode)) return { ok: false, error: 'invalid_result_code' }

  const params = isObject(result.ResultParameters) && Array.isArray(result.ResultParameters.ResultParameter)
    ? result.ResultParameters.ResultParameter
    : []
  const meta = new Map<string, unknown>()
  for (const item of params) if (isObject(item) && typeof item.Key === 'string') meta.set(item.Key, item.Value)
  const amount = Number(meta.get('TransactionAmount'))
  const transactionId = str(result.TransactionID)

  return {
    ok: true,
    resultCode,
    resultDesc: str(result.ResultDesc) ?? '',
    outcome: resultCode === 0 ? 'completed' : 'failed',
    originatorConversationId: originator,
    conversationId: conversation,
    transactionId,
    receipt: str(meta.get('TransactionReceipt')) ?? (resultCode === 0 ? transactionId : null),
    amountKes: meta.has('TransactionAmount') && Number.isFinite(amount) ? amount : null,
    receiverName: str(meta.get('ReceiverPartyPublicName')),
    completedAt: str(meta.get('TransactionCompletedDateTime')),
  }
}

export interface StatusCopyInput {
  status: string
  netKes: number
  msisdn: string | null
  receipt?: string | null
  failureReason?: string | null
}

export function withdrawalStatusLabel(status: string): string {
  switch (status) {
    case 'PENDING':
      return 'Request received'
    case 'PROCESSING':
      return 'Being sent to M-Pesa'
    case 'COMPLETED':
      return 'Withdrawal completed'
    case 'FAILED':
      return 'Could not be sent'
    case 'CANCELLED':
      return 'Cancelled'
    default:
      return status
  }
}

/** User-facing sentence for a withdrawal. Never claims success before COMPLETED. */
export function withdrawalStatusCopy(input: StatusCopyInput): string {
  const kes = `KES ${Math.round(input.netKes).toLocaleString('en-US')}`
  const phone = localPhoneDisplay(input.msisdn) || 'your M-Pesa number'
  switch (input.status) {
    case 'PENDING':
      return `Request received. ${kes} will be sent to ${phone}.`
    case 'PROCESSING':
      return `Being sent to M-Pesa (${phone}).`
    case 'COMPLETED':
      return `Withdrawal completed — ${kes} sent to ${phone}${input.receipt ? ` (receipt ${input.receipt})` : ''}.`
    case 'FAILED':
      return `Could not be sent: ${input.failureReason?.trim() || 'M-Pesa rejected the payout'}. Your balance has been refunded.`
    case 'CANCELLED':
      return 'Cancelled. Your balance has been refunded.'
    default:
      return input.status
  }
}

export function isOpenWithdrawalStatus(status: string): boolean {
  return status === 'PENDING' || status === 'PROCESSING'
}

export function processingTimeCopy(mode: WithdrawalMode): string {
  return mode === 'daraja_b2c'
    ? 'Withdrawals are paid to your M-Pesa number. Processing time: usually within minutes.'
    : 'Withdrawals are paid to your M-Pesa number. Processing time: typically within 24 hours.'
}
