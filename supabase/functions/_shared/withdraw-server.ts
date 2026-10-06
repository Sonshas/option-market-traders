import type { SupabaseClient, User } from 'npm:@supabase/supabase-js@2'
import { darajaConfig, darajaPost, type DarajaConfig } from './daraja-server.ts'
import {
  DEFAULT_B2C_RESULT_URL,
  DEFAULT_B2C_TIMEOUT_URL,
  NO_REAL_TRADE_MESSAGE,
  buildB2cRequest,
  parseWithdrawalConfig,
  type WithdrawalConfig,
} from './withdrawals.ts'

/** Owner rule: a user must have at least one settled REAL trade (won or lost) before any payout. */
export async function hasSettledRealTrade(admin: SupabaseClient, userId: string): Promise<boolean> {
  const { data, error } = await admin
    .from('trades')
    .select('id')
    .eq('user_id', userId)
    .eq('account_mode', 'real')
    .eq('is_simulated', false)
    .in('status', ['won', 'lost'])
    .limit(1)
  if (error) {
    console.error('trade eligibility check failed', error.message)
    return false
  }
  return (data ?? []).length > 0
}

/** Roles allowed to act on withdrawals (mark processing / complete / fail). Read from the JWT app_metadata. */
export const WITHDRAWAL_ADMIN_ROLES = new Set(['admin', 'superadmin', 'finance'])

export interface WithdrawServerConfig extends WithdrawalConfig {
  daraja: DarajaConfig
  b2cShortcode: string | null
  initiatorName: string | null
  securityCredential: string | null
  resultUrl: string
  timeoutUrl: string
}

export function withdrawConfig(): WithdrawServerConfig {
  const env = Deno.env.toObject()
  return {
    ...parseWithdrawalConfig(env),
    daraja: darajaConfig(),
    b2cShortcode: env.MPESA_B2C_SHORTCODE?.trim() || null,
    initiatorName: env.MPESA_INITIATOR_NAME?.trim() || null,
    securityCredential: env.MPESA_SECURITY_CREDENTIAL?.trim() || null,
    resultUrl: env.MPESA_B2C_RESULT_URL?.trim() || DEFAULT_B2C_RESULT_URL,
    timeoutUrl: env.MPESA_B2C_TIMEOUT_URL?.trim() || DEFAULT_B2C_TIMEOUT_URL,
  }
}

/** B2C needs the Daraja app credentials plus the B2C shortcode, initiator and encrypted security credential. */
export function b2cConfigured(cfg: WithdrawServerConfig): boolean {
  return Boolean(
    cfg.daraja.consumerKey && cfg.daraja.consumerSecret && cfg.b2cShortcode && cfg.initiatorName && cfg.securityCredential,
  )
}

export function b2cActive(cfg: WithdrawServerConfig): boolean {
  return cfg.mode === 'daraja_b2c' && b2cConfigured(cfg)
}

export function b2cPaymentRequest(cfg: WithdrawServerConfig, input: { reference: string; amountKes: number; msisdn: string }) {
  return darajaPost(
    cfg.daraja,
    '/mpesa/b2c/v3/paymentrequest',
    buildB2cRequest({
      originatorConversationId: input.reference,
      initiatorName: cfg.initiatorName!,
      securityCredential: cfg.securityCredential!,
      shortcode: cfg.b2cShortcode!,
      amountKes: input.amountKes,
      msisdn: input.msisdn,
      resultUrl: cfg.resultUrl,
      timeoutUrl: cfg.timeoutUrl,
    }),
    25_000,
  )
}

export function userRole(user: User | null): string {
  const meta = (user?.app_metadata ?? {}) as Record<string, unknown>
  return typeof meta.role === 'string' && meta.role.trim() ? meta.role.trim() : 'trader'
}

export function isWithdrawalAdmin(user: User | null): boolean {
  return WITHDRAWAL_ADMIN_ROLES.has(userRole(user))
}

export interface WithdrawalRow {
  id: string
  user_id: string
  amount: number | string
  currency: string
  status: string
  provider: string | null
  amount_kes: number | string | null
  fee_kes: number | string | null
  net_kes: number | string | null
  msisdn: string | null
  reference: string | null
  mpesa_receipt: string | null
  conversation_id: string | null
  originator_conversation_id: string | null
  result_code: string | null
  result_desc: string | null
  failure_reason: string | null
  processing_at: string | null
  completed_at: string | null
  failed_at: string | null
  admin_user_id: string | null
  admin_note: string | null
  details: Record<string, unknown> | null
  created_at: string
  updated_at: string
}

export const WITHDRAWAL_COLUMNS =
  'id, user_id, amount, currency, status, provider, amount_kes, fee_kes, net_kes, msisdn, reference, mpesa_receipt, conversation_id, originator_conversation_id, result_code, result_desc, failure_reason, processing_at, completed_at, failed_at, admin_user_id, admin_note, details, created_at, updated_at'

export async function loadWithdrawal(admin: SupabaseClient, id: string): Promise<WithdrawalRow | null> {
  const { data } = await admin.from('withdrawals').select(WITHDRAWAL_COLUMNS).eq('id', id).maybeSingle()
  return (data as WithdrawalRow | null) ?? null
}

export async function findWithdrawalByConversation(
  admin: SupabaseClient,
  originatorConversationId: string | null,
  conversationId: string | null,
): Promise<WithdrawalRow | null> {
  if (originatorConversationId) {
    const { data } = await admin
      .from('withdrawals')
      .select(WITHDRAWAL_COLUMNS)
      .eq('originator_conversation_id', originatorConversationId)
      .maybeSingle()
    if (data) return data as WithdrawalRow
  }
  if (conversationId) {
    const { data } = await admin.from('withdrawals').select(WITHDRAWAL_COLUMNS).eq('conversation_id', conversationId).maybeSingle()
    if (data) return data as WithdrawalRow
  }
  return null
}

/** Shape returned to the browser (own rows only; the admin list adds user email/name). */
export function publicWithdrawal(row: WithdrawalRow) {
  return {
    withdrawal_id: row.id,
    reference: row.reference,
    status: row.status,
    provider: row.provider,
    amount_usd: Number(row.amount),
    amount_kes: row.amount_kes == null ? null : Number(row.amount_kes),
    fee_kes: row.fee_kes == null ? 0 : Number(row.fee_kes),
    net_kes: row.net_kes == null ? null : Number(row.net_kes),
    msisdn: row.msisdn,
    receipt: row.mpesa_receipt,
    failure_reason: row.status === 'FAILED' || row.status === 'CANCELLED' ? row.failure_reason : null,
    created_at: row.created_at,
    processing_at: row.processing_at,
    completed_at: row.completed_at,
    failed_at: row.failed_at,
  }
}

/** Maps SECURITY DEFINER exceptions to user-facing messages. */
export function requestErrorMessage(dbMessage: string, cfg: WithdrawalConfig): { status: number; error: string } {
  const code = (dbMessage.trim().match(/^([a-z_]+)/i) ?? [])[1] ?? ''
  switch (code) {
    case 'insufficient_funds':
      return { status: 400, error: 'That is more than your available REAL balance.' }
    case 'withdrawal_already_open':
      return { status: 409, error: 'You already have a withdrawal in progress. Wait for it to finish before requesting another.' }
    case 'below_minimum':
      return { status: 400, error: `Minimum withdrawal is KES ${cfg.minKes.toLocaleString('en-US')}.` }
    case 'above_maximum':
      return { status: 400, error: `Maximum withdrawal is KES ${cfg.maxKes.toLocaleString('en-US')} per request.` }
    case 'amount_too_small':
      return { status: 400, error: 'Amount is too small after the fee.' }
    case 'invalid_phone':
      return { status: 400, error: 'Enter a valid Safaricom M-Pesa number, e.g. 0712345678.' }
    case 'invalid_amount':
      return { status: 400, error: 'Enter a valid USD amount with at most two decimals.' }
    case 'withdrawals_paused':
      return { status: 503, error: 'Withdrawals are paused for maintenance. Please try again later.' }
    case 'account_suspended':
      return { status: 403, error: 'Your account is suspended. Contact support.' }
    case 'no_real_trade':
      return { status: 403, error: NO_REAL_TRADE_MESSAGE }
    case 'wallet_not_found':
    case 'wallet_not_ready':
      return { status: 409, error: 'Your REAL wallet is not ready yet. Please contact support.' }
    default:
      return { status: 500, error: 'Withdrawals temporarily unavailable' }
  }
}
