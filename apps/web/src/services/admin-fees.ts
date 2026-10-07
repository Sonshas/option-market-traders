import type {
  DepositFeeSettings,
  HostFeeSettings,
  PayoutDeskFeeSettings,
  TradingFeeSettings,
  WithdrawalFeeSettings,
} from '@/domain/payment-settings'
import { FALLBACK_PAYOUT_DESK } from '@/domain/payment-settings'
import { getSupabase } from '@/lib/supabase'

const FUNCTION = 'admin-fees'

export type Result<T> = { ok: true; data: T } | { ok: false; error: string }

export interface AdminFeesState {
  host: HostFeeSettings
  payoutDesk: {
    configured: boolean
    settings: PayoutDeskFeeSettings | null
    error: string | null
  }
}

export interface AdminFeesSaveInput {
  deposit: DepositFeeSettings
  withdrawal: WithdrawalFeeSettings
  trading: TradingFeeSettings
  payoutDesk: PayoutDeskFeeSettings
}

async function functionError(error: unknown): Promise<string> {
  const context = (error as { context?: Response } | null)?.context
  if (context && typeof context.json === 'function') {
    try {
      const body = (await context.clone().json()) as { error?: string; message?: string }
      if (body.error || body.message) return String(body.error ?? body.message)
    } catch {
      // fall through
    }
  }
  return 'Could not load fees.'
}

function money(value: unknown, fallback: number): number {
  const n = Number(value)
  return Number.isFinite(n) ? n : fallback
}

function mapHost(raw: unknown): HostFeeSettings {
  const host = raw && typeof raw === 'object' ? (raw as Record<string, unknown>) : {}
  const deposit = (host.deposit && typeof host.deposit === 'object' ? host.deposit : {}) as Record<string, unknown>
  const withdrawal = (host.withdrawal && typeof host.withdrawal === 'object' ? host.withdrawal : {}) as Record<
    string,
    unknown
  >
  const trading = (host.trading && typeof host.trading === 'object' ? host.trading : {}) as Record<string, unknown>
  return {
    deposit: {
      kesPerUsd: money(deposit.kesPerUsd, 130),
      minKes: money(deposit.minKes, 1600),
      maxKes: money(deposit.maxKes, 150_000),
      quickAmounts: typeof deposit.quickAmounts === 'string' ? deposit.quickAmounts : '1600,2500,5000,10000',
    },
    withdrawal: {
      kesPerUsd: money(withdrawal.kesPerUsd, 130),
      minKes: money(withdrawal.minKes, 1000),
      maxKes: money(withdrawal.maxKes, 400_000),
      feeKes: money(withdrawal.feeKes, 0),
    },
    trading: {
      stakeMinUsd: money(trading.stakeMinUsd, 1),
      stakeMaxUsd: money(trading.stakeMaxUsd, 500),
      maxOpenTrades: money(trading.maxOpenTrades, 5),
      dailyProfitLimitUsd: money(trading.dailyProfitLimitUsd, 1000),
    },
  }
}

function mapPayout(raw: unknown): PayoutDeskFeeSettings | null {
  if (!raw || typeof raw !== 'object') return null
  const row = raw as Record<string, unknown>
  return {
    minWithdrawUsd: money(row.minWithdrawUsd, FALLBACK_PAYOUT_DESK.minWithdrawUsd),
    withdrawalFeePercent: money(row.withdrawalFeePercent, FALLBACK_PAYOUT_DESK.withdrawalFeePercent),
    kesPerUsdWithdrawal: money(row.kesPerUsdWithdrawal, FALLBACK_PAYOUT_DESK.kesPerUsdWithdrawal),
    kesPerUsdDeposit: money(row.kesPerUsdDeposit, FALLBACK_PAYOUT_DESK.kesPerUsdDeposit),
    mpesaCapKes: money(row.mpesaCapKes, FALLBACK_PAYOUT_DESK.mpesaCapKes),
    taxFeeUsd: money(row.taxFeeUsd, FALLBACK_PAYOUT_DESK.taxFeeUsd),
    botFeeUsd: money(row.botFeeUsd, FALLBACK_PAYOUT_DESK.botFeeUsd),
    previewStkConfirm: row.previewStkConfirm === true,
  }
}

function mapState(data: Record<string, unknown>): AdminFeesState {
  const desk = data.payout_desk && typeof data.payout_desk === 'object' ? (data.payout_desk as Record<string, unknown>) : {}
  return {
    host: mapHost(data.host),
    payoutDesk: {
      configured: desk.configured === true,
      settings: mapPayout(desk.settings),
      error: typeof desk.error === 'string' ? desk.error : null,
    },
  }
}

export const adminFeesService = {
  async load(): Promise<Result<AdminFeesState>> {
    const client = getSupabase()
    if (!client) return { ok: false, error: 'This service is temporarily unavailable.' }
    const { data, error } = await client.functions.invoke<Record<string, unknown>>(FUNCTION, { method: 'GET' })
    if (error || !data) return { ok: false, error: await functionError(error) }
    return { ok: true, data: mapState(data) }
  },

  async save(input: AdminFeesSaveInput): Promise<Result<AdminFeesState & { message: string }>> {
    const client = getSupabase()
    if (!client) return { ok: false, error: 'This service is temporarily unavailable.' }
    const { data, error } = await client.functions.invoke<Record<string, unknown>>(FUNCTION, {
      method: 'POST',
      body: {
        deposit: input.deposit,
        withdrawal: input.withdrawal,
        trading: input.trading,
        payout_desk: input.payoutDesk,
      },
    })
    if (error || !data) return { ok: false, error: await functionError(error) }
    return {
      ok: true,
      data: {
        ...mapState(data),
        message: typeof data.message === 'string' ? data.message : 'Fees saved.',
      },
    }
  },
}
