import { createClient, type SupabaseClient } from 'npm:@supabase/supabase-js@2'
import {
  EXIT_WINDOW_MS,
  REAL_ENTRY_MAX_AGE_MS,
  REFUND_AFTER_MS,
  extractLastDigit,
  normalizePipSize,
  selectExitTick,
  selectNthTickAfter,
  settleDigitContract,
  type DigitContractOption,
  type DigitContractType,
} from './digit-contracts.ts'

const DERIV_WS_URL = 'wss://api.derivws.com/trading/v1/options/ws/public'
const CONNECT_TIMEOUT_MS = 5_000
const REQUEST_TIMEOUT_MS = 5_000
const ENTRY_DEADLINE_MS = 5_000

// Same helpers as server.ts, kept here so trading functions do not bundle the MegaPay module.
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

export async function realTradingEnabled(admin: SupabaseClient): Promise<boolean> {
  const { data } = await admin.from('feature_flags').select('value').eq('key', 'REAL_TRADING_ENABLED').maybeSingle()
  return data?.value === true
}

type Pending = { resolve: (msg: Record<string, unknown>) => void; reject: (err: Error) => void; timer: number }

/** Minimal Deriv public WebSocket session (market data only — never authorizes or trades). */
export class DerivSession {
  private seq = 0
  private pending = new Map<number, Pending>()

  private constructor(private ws: WebSocket) {
    ws.onmessage = (event) => {
      let msg: Record<string, unknown>
      try {
        msg = JSON.parse(String(event.data))
      } catch {
        return
      }
      const id = Number(msg.req_id)
      const waiter = this.pending.get(id)
      if (!waiter) return
      clearTimeout(waiter.timer)
      this.pending.delete(id)
      const error = msg.error as { message?: string } | undefined
      if (error) waiter.reject(new Error(error.message ?? 'Deriv error'))
      else waiter.resolve(msg)
    }
    ws.onclose = () => this.failAll(new Error('Deriv socket closed'))
  }

  static open(): Promise<DerivSession> {
    return new Promise((resolve, reject) => {
      const ws = new WebSocket(DERIV_WS_URL)
      const timer = setTimeout(() => {
        reject(new Error('Deriv connect timeout'))
        try {
          ws.close()
        } catch {
          // ignore
        }
      }, CONNECT_TIMEOUT_MS)
      ws.onopen = () => {
        clearTimeout(timer)
        resolve(new DerivSession(ws))
      }
      ws.onerror = () => {
        clearTimeout(timer)
        reject(new Error('Deriv connect failed'))
      }
    })
  }

  request(payload: Record<string, unknown>): Promise<Record<string, unknown>> {
    return new Promise((resolve, reject) => {
      if (this.ws.readyState !== WebSocket.OPEN) {
        reject(new Error('Deriv socket not open'))
        return
      }
      const id = ++this.seq
      const timer = setTimeout(() => {
        this.pending.delete(id)
        reject(new Error('Deriv request timeout'))
      }, REQUEST_TIMEOUT_MS)
      this.pending.set(id, { resolve, reject, timer })
      this.ws.send(JSON.stringify({ ...payload, req_id: id }))
    })
  }

  close(): void {
    this.failAll(new Error('Deriv session closed'))
    try {
      this.ws.close()
    } catch {
      // ignore
    }
  }

  private failAll(err: Error): void {
    for (const waiter of this.pending.values()) {
      clearTimeout(waiter.timer)
      waiter.reject(err)
    }
    this.pending.clear()
  }
}

export interface HistoryTicks {
  ticks: Array<{ epochMs: number; price: number }>
  /** Normalized pip value (e.g. 0.01), or null if Deriv did not report one. */
  pipSize: number | null
  rawPipSize: unknown
}

function parseHistory(msg: Record<string, unknown>): HistoryTicks {
  const history = (msg.history ?? {}) as { prices?: unknown[]; times?: unknown[] }
  const prices = Array.isArray(history.prices) ? history.prices : []
  const times = Array.isArray(history.times) ? history.times : []
  const ticks: HistoryTicks['ticks'] = []
  for (let i = 0; i < Math.min(prices.length, times.length); i++) {
    const price = Number(prices[i])
    const epoch = Number(times[i])
    if (Number.isFinite(price) && Number.isFinite(epoch)) ticks.push({ epochMs: epoch * 1000, price })
  }
  const raw = Number(msg.pip_size)
  return { ticks, pipSize: Number.isFinite(raw) && raw > 0 ? normalizePipSize(raw) : null, rawPipSize: msg.pip_size ?? null }
}

export interface EntryTick {
  price: number
  epoch: number
  pipSize: number
  ageMs: number
}

/** Latest genuine Deriv tick, only if it is at most REAL_ENTRY_MAX_AGE_MS old. */
export async function fetchFreshTick(session: DerivSession, symbol: string): Promise<EntryTick | null> {
  const deadline = Date.now() + ENTRY_DEADLINE_MS
  while (Date.now() < deadline) {
    const parsed = parseHistory(await session.request({ ticks_history: symbol, count: 1, end: 'latest', style: 'ticks' }))
    const last = parsed.ticks[parsed.ticks.length - 1]
    if (last && parsed.pipSize != null) {
      const ageMs = Date.now() - last.epochMs
      if (ageMs <= REAL_ENTRY_MAX_AGE_MS && ageMs > -2_000) {
        return { price: last.price, epoch: Math.round(last.epochMs / 1000), pipSize: parsed.pipSize, ageMs }
      }
    }
    await new Promise((r) => setTimeout(r, 400))
  }
  return null
}

export interface OpenTradeRow {
  id: string
  user_id: string
  symbol: string
  contract_type: DigitContractType
  contract_option: DigitContractOption
  selected_digit: number | null
  barrier: number | null
  stake: number | string
  expires_at: string
  duration_ticks?: number | null
  tick_anchor_epoch?: number | string | null
}

export const OPEN_TRADE_COLUMNS =
  'id, user_id, symbol, contract_type, contract_option, selected_digit, barrier, stake, expires_at, duration_ticks, tick_anchor_epoch'

/** Longest a tick contract may wait for its Nth tick before it is refunded (seconds after the anchor). */
const TICK_WINDOW_SEC = REFUND_AFTER_MS / 1000

export type SettleResult =
  | { tradeId: string; result: 'settled'; outcome: string }
  | { tradeId: string; result: 'refunded' }
  | { tradeId: string; result: 'waiting' }
  | { tradeId: string; result: 'error'; error: string }

/**
 * Settles one REAL trade. Seconds contracts: first Deriv tick at/after expiry (same rule as DEMO).
 * Tick contracts: the Nth distinct Deriv tick strictly after the anchor epoch.
 * No exit tick 10 minutes after expiry/anchor → stake refunded. Prices and digits are never invented.
 */
export async function settleOpenTrade(
  admin: SupabaseClient,
  session: DerivSession | null,
  trade: OpenTradeRow,
  now = Date.now(),
): Promise<SettleResult> {
  const ticksN = trade.duration_ticks == null ? null : Number(trade.duration_ticks)
  const anchorSec = trade.tick_anchor_epoch == null ? null : Number(trade.tick_anchor_epoch)
  if (ticksN != null && anchorSec != null && Number.isFinite(anchorSec)) {
    return settleTickTrade(admin, session, trade, ticksN, anchorSec, now)
  }

  const expiryMs = Date.parse(trade.expires_at)
  if (!Number.isFinite(expiryMs) || now < expiryMs) return { tradeId: trade.id, result: 'waiting' }
  const startSec = Math.floor(expiryMs / 1000) - 1
  const endSec = Math.ceil((expiryMs + EXIT_WINDOW_MS) / 1000)

  let fetchError: string | null = null
  let history: HistoryTicks | null = null
  if (session) {
    try {
      history = parseHistory(
        await session.request({ ticks_history: trade.symbol, start: startSec, end: endSec, count: 1000, style: 'ticks' }),
      )
    } catch (err) {
      fetchError = String(err)
    }
  } else {
    fetchError = 'Deriv unavailable'
  }

  const exit = history ? selectExitTick(history.ticks, expiryMs) : null
  if (exit && history?.pipSize != null) {
    const digit = extractLastDigit(exit.price, history.pipSize)
    if (digit == null) return { tradeId: trade.id, result: 'error', error: 'invalid exit digit' }
    const outcome = settleDigitContract({
      contractType: trade.contract_type,
      contractOption: trade.contract_option,
      selectedDigit: trade.selected_digit,
      barrier: trade.barrier,
      exitPrice: exit.price,
      exitDigit: digit,
    })
    const { error } = await admin.rpc('settle_real_trade', {
      p_trade_id: trade.id,
      p_exit_price: exit.price,
      p_exit_epoch: Math.round(exit.epochMs / 1000),
      p_pip_size: history.pipSize,
      p_exit_digit: digit,
      p_outcome: outcome,
      p_raw: {
        source: 'deriv_ticks_history',
        exit_epoch: Math.round(exit.epochMs / 1000),
        exit_price: exit.price,
        exit_digit: digit,
        pip_size: history.pipSize,
        raw_pip_size: history.rawPipSize,
        expiry_epoch_ms: expiryMs,
        window: [startSec, endSec],
        ticks_in_window: history.ticks.length,
      },
    })
    if (error) {
      console.error('settle_real_trade', trade.id, error.message)
      return { tradeId: trade.id, result: 'error', error: error.message }
    }
    return { tradeId: trade.id, result: 'settled', outcome }
  }

  if (now >= expiryMs + REFUND_AFTER_MS) {
    const { error } = await admin.rpc('refund_real_trade', {
      p_trade_id: trade.id,
      p_reason: 'No exit tick within 10 minutes of expiry',
      p_raw: { fetch_error: fetchError, ticks_in_window: history?.ticks.length ?? null, window: [startSec, endSec] },
    })
    if (error) {
      console.error('refund_real_trade', trade.id, error.message)
      return { tradeId: trade.id, result: 'error', error: error.message }
    }
    return { tradeId: trade.id, result: 'refunded' }
  }

  if (fetchError) console.error('exit tick fetch failed', trade.id, fetchError)
  return { tradeId: trade.id, result: 'waiting' }
}

async function settleTickTrade(
  admin: SupabaseClient,
  session: DerivSession | null,
  trade: OpenTradeRow,
  ticksN: number,
  anchorSec: number,
  now: number,
): Promise<SettleResult> {
  const nowSec = Math.floor(now / 1000)
  if (nowSec <= anchorSec) return { tradeId: trade.id, result: 'waiting' }
  const startSec = anchorSec
  const endSec = Math.min(nowSec, anchorSec + TICK_WINDOW_SEC)

  let fetchError: string | null = null
  let history: HistoryTicks | null = null
  if (session) {
    try {
      history = parseHistory(
        await session.request({ ticks_history: trade.symbol, start: startSec, end: endSec, count: 1000, style: 'ticks' }),
      )
    } catch (err) {
      fetchError = String(err)
    }
  } else {
    fetchError = 'Deriv unavailable'
  }

  const picked = history ? selectNthTickAfter(history.ticks, anchorSec * 1000, ticksN) : null
  if (picked && history?.pipSize != null) {
    const exit = picked.exit
    const exitEpoch = Math.round(exit.epochMs / 1000)
    const digit = extractLastDigit(exit.price, history.pipSize)
    if (digit == null) return { tradeId: trade.id, result: 'error', error: 'invalid exit digit' }
    const outcome = settleDigitContract({
      contractType: trade.contract_type,
      contractOption: trade.contract_option,
      selectedDigit: trade.selected_digit,
      barrier: trade.barrier,
      exitPrice: exit.price,
      exitDigit: digit,
    })
    const { error } = await admin.rpc('settle_real_trade', {
      p_trade_id: trade.id,
      p_exit_price: exit.price,
      p_exit_epoch: exitEpoch,
      p_pip_size: history.pipSize,
      p_exit_digit: digit,
      p_outcome: outcome,
      p_raw: {
        source: 'deriv_ticks_history',
        rule: 'nth_tick_after_anchor',
        anchor_epoch: anchorSec,
        duration_ticks: ticksN,
        tick_epochs: picked.epochsMs.map((ms) => Math.round(ms / 1000)),
        exit_epoch: exitEpoch,
        exit_price: exit.price,
        exit_digit: digit,
        pip_size: history.pipSize,
        raw_pip_size: history.rawPipSize,
        window: [startSec, endSec],
        ticks_in_window: history.ticks.length,
      },
    })
    if (error) {
      console.error('settle_real_trade', trade.id, error.message)
      return { tradeId: trade.id, result: 'error', error: error.message }
    }
    return { tradeId: trade.id, result: 'settled', outcome }
  }

  if (now >= anchorSec * 1000 + REFUND_AFTER_MS) {
    const { error } = await admin.rpc('refund_real_trade', {
      p_trade_id: trade.id,
      p_reason: `No ${ticksN}th tick within 10 minutes of entry`,
      p_raw: { fetch_error: fetchError, ticks_in_window: history?.ticks.length ?? null, window: [startSec, endSec] },
    })
    if (error) {
      console.error('refund_real_trade', trade.id, error.message)
      return { tradeId: trade.id, result: 'error', error: error.message }
    }
    return { tradeId: trade.id, result: 'refunded' }
  }

  if (fetchError) console.error('tick history fetch failed', trade.id, fetchError)
  return { tradeId: trade.id, result: 'waiting' }
}

/** Settles a batch with one shared Deriv connection. */
export async function settleTrades(admin: SupabaseClient, trades: OpenTradeRow[]): Promise<SettleResult[]> {
  if (trades.length === 0) return []
  let session: DerivSession | null = null
  try {
    session = await DerivSession.open()
  } catch (err) {
    console.error('Deriv connect failed', String(err))
  }
  const results: SettleResult[] = []
  try {
    for (const trade of trades) results.push(await settleOpenTrade(admin, session, trade))
  } finally {
    session?.close()
  }
  return results
}

export const TRADE_COLUMNS =
  'id, symbol, contract_type, contract_option, selected_digit, barrier, stake, duration_ms, duration_ticks, entry_epoch, tick_anchor_epoch, payout_rate, status, entry_price, exit_price, exit_digit, payout, profit_loss, expires_at, resolved_at, created_at, updated_at'

export interface TradeRow {
  id: string
  symbol: string
  contract_type: string
  contract_option: string
  selected_digit: number | null
  barrier: number | null
  stake: number | string
  duration_ms: number
  duration_ticks: number | null
  entry_epoch: number | null
  tick_anchor_epoch: number | null
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
