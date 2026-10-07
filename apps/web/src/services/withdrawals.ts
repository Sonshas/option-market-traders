import type { RealtimeChannel } from '@supabase/supabase-js'
import type { WithdrawalMode, WithdrawalStatus } from '@/domain/withdrawals'
import { edgeErrorMessage, reportBackendIssue } from '@/services/system-issues'
import { getSupabase } from '@/lib/supabase'
import { notifyRealWalletChanged } from '@/lib/real-wallet-events'
import type { Result } from '@/services/megapay'

/**
 * REAL M-Pesa withdrawals. The client can only (1) read the server-side config, (2) create a request and
 * (3) read status. Every validation, the wallet hold, the payout and the final status live in the
 * mpesa-withdraw / admin-withdrawals / mpesa-withdraw-dispatch / mpesa-b2c-result Edge Functions and the
 * SECURITY DEFINER database functions. Nothing here ever marks a withdrawal completed.
 */

export const WITHDRAW_UNAVAILABLE = 'Withdrawals temporarily unavailable'
const FUNCTION = 'mpesa-withdraw'
const ADMIN_FUNCTION = 'admin-withdrawals'
export const WITHDRAWAL_POLL_MS = 5000

export interface WithdrawConfig {
  enabled: boolean
  /** Owner rule: at least one settled REAL trade (won/lost) before the first payout. */
  hasRealTrade: boolean
  eligibilityMessage: string | null
  mode: WithdrawalMode
  kesPerUsd: number
  minKes: number
  maxKes: number
  minUsd: number
  feeKes: number
  processingCopy: string
  message: string | null
}

export interface WithdrawalState {
  withdrawalId: string
  reference: string | null
  status: WithdrawalStatus
  provider: string | null
  amountUsd: number
  amountKes: number
  feeKes: number
  netKes: number
  msisdn: string | null
  receipt: string | null
  failureReason: string | null
  createdAt: string
  processingAt: string | null
  completedAt: string | null
  failedAt: string | null
}

export interface AdminWithdrawalRow extends WithdrawalState {
  id: string
  userId: string
  userEmail: string | null
  userName: string | null
  conversationId: string | null
  resultCode: string | null
  resultDesc: string | null
  adminNote: string | null
}

export interface AdminWithdrawalList {
  mode: WithdrawalMode
  feeKes: number
  kesPerUsd: number
  withdrawals: AdminWithdrawalRow[]
}

async function functionError(error: unknown, fallback = WITHDRAW_UNAVAILABLE): Promise<string> {
  return edgeErrorMessage(error, fallback, { area: 'withdrawals', operation: 'edge.withdraw' })
}

function str(value: unknown): string | null {
  return typeof value === 'string' && value ? value : null
}

export function mapWithdrawalState(raw: Record<string, unknown>): WithdrawalState {
  return {
    withdrawalId: String(raw.withdrawal_id ?? raw.id),
    reference: str(raw.reference),
    status: String(raw.status) as WithdrawalStatus,
    provider: str(raw.provider),
    amountUsd: Number(raw.amount_usd ?? raw.amount),
    amountKes: Number(raw.amount_kes ?? 0),
    feeKes: Number(raw.fee_kes ?? 0),
    netKes: Number(raw.net_kes ?? 0),
    msisdn: str(raw.msisdn),
    receipt: str(raw.receipt ?? raw.mpesa_receipt),
    failureReason: str(raw.failure_reason),
    createdAt: String(raw.created_at ?? ''),
    processingAt: str(raw.processing_at),
    completedAt: str(raw.completed_at),
    failedAt: str(raw.failed_at),
  }
}

function mapAdminRow(raw: Record<string, unknown>): AdminWithdrawalRow {
  const state = mapWithdrawalState(raw)
  return {
    ...state,
    id: state.withdrawalId,
    userId: String(raw.user_id ?? ''),
    userEmail: str(raw.user_email),
    userName: str(raw.user_name),
    conversationId: str(raw.conversation_id),
    resultCode: str(raw.result_code),
    resultDesc: str(raw.result_desc),
    adminNote: str(raw.admin_note),
  }
}

const MY_COLUMNS =
  'id, amount, status, provider, reference, amount_kes, fee_kes, net_kes, msisdn, mpesa_receipt, failure_reason, created_at, processing_at, completed_at, failed_at'

export const withdrawalService = {
  async getConfig(): Promise<Result<WithdrawConfig>> {
    const client = getSupabase()
    if (!client) return { ok: false, error: WITHDRAW_UNAVAILABLE }
    const { data, error } = await client.functions.invoke<Record<string, unknown>>(FUNCTION, { method: 'GET' })
    if (error || !data) return { ok: false, error: await functionError(error) }
    return {
      ok: true,
      data: {
        enabled: data.enabled === true,
        hasRealTrade: data.has_real_trade === true,
        eligibilityMessage: str(data.eligibility_message),
        mode: data.mode === 'daraja_b2c' ? 'daraja_b2c' : 'manual',
        kesPerUsd: Number(data.kes_per_usd),
        minKes: Number(data.min_kes),
        maxKes: Number(data.max_kes),
        minUsd: Number(data.min_usd),
        feeKes: Number(data.fee_kes ?? 0),
        processingCopy: str(data.processing_copy) ?? '',
        message: str(data.message),
      },
    }
  },

  /** Creates the request. The server debits the wallet (hold) and returns status PENDING — never COMPLETED. */
  async request(amountUsd: number, phone: string): Promise<Result<WithdrawalState>> {
    const client = getSupabase()
    if (!client) return { ok: false, error: WITHDRAW_UNAVAILABLE }
    const { data, error } = await client.functions.invoke<Record<string, unknown>>(FUNCTION, {
      method: 'POST',
      body: { amount_usd: amountUsd, phone },
    })
    if (error || !data) return { ok: false, error: await functionError(error) }
    notifyRealWalletChanged()
    return { ok: true, data: mapWithdrawalState(data) }
  },

  /** Reads one of the signed-in user's withdrawals (RLS: own rows only). */
  async getMine(withdrawalId: string): Promise<Result<WithdrawalState>> {
    const client = getSupabase()
    if (!client) return { ok: false, error: WITHDRAW_UNAVAILABLE }
    const { data, error } = await client.from('withdrawals').select(MY_COLUMNS).eq('id', withdrawalId).maybeSingle()
    if (error) reportBackendIssue('withdrawals', 'withdrawals.read', error)
    if (error || !data) return { ok: false, error: error ? WITHDRAW_UNAVAILABLE : 'Withdrawal not found.' }
    return { ok: true, data: mapWithdrawalState(data as unknown as Record<string, unknown>) }
  },

  /**
   * Live status: Supabase realtime on the user's withdrawal rows plus a 5 s poll as a fallback.
   * Returns an unsubscribe function.
   */
  subscribe(userId: string, onChange: () => void, options: { pollMs?: number; channel?: string } = {}): () => void {
    const client = getSupabase()
    let channel: RealtimeChannel | null = null
    if (client) {
      channel = client
        .channel(options.channel ?? `withdrawals:${userId}`)
        .on(
          'postgres_changes',
          { event: '*', schema: 'public', table: 'withdrawals', filter: `user_id=eq.${userId}` },
          () => {
            onChange()
            notifyRealWalletChanged()
          },
        )
        .subscribe()
    }
    const pollMs = options.pollMs ?? WITHDRAWAL_POLL_MS
    const timer = pollMs > 0 ? window.setInterval(onChange, pollMs) : null
    return () => {
      if (timer != null) window.clearInterval(timer)
      if (channel && client) void client.removeChannel(channel)
    }
  },

  // ---- admin (caller must have app_metadata.role admin / superadmin / finance; the function enforces it) ----

  async adminList(status: 'ALL' | 'OPEN' | WithdrawalStatus = 'ALL'): Promise<Result<AdminWithdrawalList>> {
    const client = getSupabase()
    if (!client) return { ok: false, error: WITHDRAW_UNAVAILABLE }
    const { data, error } = await client.functions.invoke<Record<string, unknown>>(ADMIN_FUNCTION, {
      method: 'POST',
      body: { action: 'list', status },
    })
    if (error || !data) return { ok: false, error: await functionError(error, 'Could not load withdrawals.') }
    const rows = Array.isArray(data.withdrawals) ? (data.withdrawals as Record<string, unknown>[]) : []
    return {
      ok: true,
      data: {
        mode: data.mode === 'daraja_b2c' ? 'daraja_b2c' : 'manual',
        feeKes: Number(data.fee_kes ?? 0),
        kesPerUsd: Number(data.kes_per_usd ?? 0),
        withdrawals: rows.map(mapAdminRow),
      },
    }
  },

  async adminAct(
    action: 'processing' | 'complete' | 'fail',
    id: string,
    extra: { receipt?: string; reason?: string; note?: string } = {},
  ): Promise<Result<AdminWithdrawalRow | null>> {
    const client = getSupabase()
    if (!client) return { ok: false, error: WITHDRAW_UNAVAILABLE }
    const { data, error } = await client.functions.invoke<Record<string, unknown>>(ADMIN_FUNCTION, {
      method: 'POST',
      body: { action, id, ...extra },
    })
    if (error || !data) return { ok: false, error: await functionError(error, 'Action failed.') }
    const row = data.withdrawal && typeof data.withdrawal === 'object' ? mapAdminRow(data.withdrawal as Record<string, unknown>) : null
    return { ok: true, data: row }
  },
}
