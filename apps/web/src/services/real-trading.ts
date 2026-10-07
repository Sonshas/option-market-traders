import { getSupabase } from '@/lib/supabase'
import { edgeErrorMessage } from '@/services/system-issues'
import type { ContractOption, ContractType } from '@/types'

/** Server-side REAL trading config returned by the real-trade Edge Function (GET). */
export interface RealTradingConfig {
  enabled: boolean
  /** True once today's (Africa/Nairobi) net REAL winnings reach the daily limit. */
  dailyLimitReached: boolean
  dailyLimitUsd: number | null
  stakeMin: number
  stakeMax: number
  maxOpenTrades: number
  message: string | null
}

/** REAL trade row as returned by the real-trade / real-trade-settle Edge Functions. */
export interface RealTradeRow {
  id: string
  symbol: string
  contract_type: string
  contract_option: string
  selected_digit: number | null
  barrier: number | null
  stake: number | string
  duration_ms: number
  /** Tick contracts only. */
  duration_ticks?: number | null
  entry_epoch?: number | string | null
  tick_anchor_epoch?: number | string | null
  payout_rate: number | string | null
  status: string
  entry_price: number | string | null
  exit_price: number | string | null
  exit_digit: number | null
  payout: number | string | null
  profit_loss: number | string | null
  expires_at: string | null
  resolved_at: string | null
  created_at: string
  updated_at: string
}

export interface PlaceRealTradeRequest {
  symbol: string
  contractType: ContractType
  contractOption: ContractOption
  selectedDigit: number | null
  barrier: number | null
  stake: number
  durationMs: number
  /** When set, the trade is a tick contract and `durationMs` is not sent. */
  durationTicks?: number | null
  idempotencyKey: string
}

type Result<T> = { ok: true; data: T } | { ok: false; error: string }

const UNAVAILABLE = 'Real trading is temporarily unavailable.'
const SIGN_IN = 'Sign in to trade.'
const CONFIG_TTL_MS = 30_000

let cachedConfig: { at: number; userId: string; value: RealTradingConfig } | null = null

async function errorMessage(error: unknown): Promise<string> {
  const context = (error as { context?: Response } | null)?.context
  if (context?.status === 401) return SIGN_IN
  return edgeErrorMessage(error, UNAVAILABLE, { area: 'trading', operation: 'edge.real_trade' })
}

/** Signed-in Supabase client, or null — REAL calls are never sent without a user session. */
async function signedInClient() {
  const client = getSupabase()
  if (!client) return null
  const {
    data: { session },
  } = await client.auth.getSession()
  return session?.user ? { client, userId: session.user.id } : null
}

export const realTradingService = {
  async getConfig(force = false): Promise<Result<RealTradingConfig>> {
    const auth = await signedInClient()
    if (!auth) return { ok: false, error: SIGN_IN }
    if (!force && cachedConfig && cachedConfig.userId === auth.userId && Date.now() - cachedConfig.at < CONFIG_TTL_MS) {
      return { ok: true, data: cachedConfig.value }
    }
    const { client } = auth
    const { data, error } = await client.functions.invoke<Record<string, unknown>>('real-trade', { method: 'GET' })
    if (error || !data) return { ok: false, error: await errorMessage(error) }
    const value: RealTradingConfig = {
      enabled: data.enabled === true,
      dailyLimitReached: data.daily_limit_reached === true,
      dailyLimitUsd: data.daily_limit_usd == null ? null : Number(data.daily_limit_usd),
      stakeMin: Number(data.stake_min),
      stakeMax: Number(data.stake_max),
      maxOpenTrades: Number(data.max_open_trades),
      message: (data.message as string | null) ?? null,
    }
    cachedConfig = { at: Date.now(), userId: auth.userId, value }
    return { ok: true, data: value }
  },

  async place(input: PlaceRealTradeRequest): Promise<Result<RealTradeRow>> {
    const auth = await signedInClient()
    if (!auth) return { ok: false, error: SIGN_IN }
    const { data, error } = await auth.client.functions.invoke<{ trade?: RealTradeRow }>('real-trade', {
      method: 'POST',
      body: {
        account_mode: 'REAL',
        symbol: input.symbol,
        contract_type: input.contractType,
        contract_option: input.contractOption,
        selected_digit: input.selectedDigit,
        barrier: input.barrier,
        stake: input.stake,
        ...(input.durationTicks != null ? { duration_ticks: input.durationTicks } : { duration: input.durationMs }),
        idempotency_key: input.idempotencyKey,
      },
    })
    if (error || !data?.trade) {
      if (error) cachedConfig = null
      return { ok: false, error: await errorMessage(error) }
    }
    return { ok: true, data: data.trade }
  },

  /** Asks the server to settle this user's expired REAL trades (optionally just one). */
  async settle(tradeId?: string): Promise<Result<RealTradeRow[]>> {
    const auth = await signedInClient()
    if (!auth) return { ok: false, error: SIGN_IN }
    const { data, error } = await auth.client.functions.invoke<{ trades?: RealTradeRow[] }>('real-trade-settle', {
      method: 'POST',
      body: tradeId ? { trade_id: tradeId } : {},
    })
    if (error || !data) return { ok: false, error: await errorMessage(error) }
    return { ok: true, data: data.trades ?? [] }
  },
}
