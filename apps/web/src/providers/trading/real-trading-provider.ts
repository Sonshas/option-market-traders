import { REAL_UNAVAILABLE_TRADING } from '@/domain/account'
import {
  REAL_TRADE_SYMBOLS,
  digitPayoutRate,
  potentialPayout,
  validateContractSelection,
  validateRealStake,
} from '@/domain/digit-contracts'
import { REAL_INTEGRATION } from '@/providers/config'
import { notConnected, okReal } from '@/providers/results'
import { getSupabase, isSupabaseConfigured } from '@/lib/supabase'
import { notifyRealWalletChanged } from '@/lib/real-wallet-events'
import { realTradingService, type RealTradeRow } from '@/services/real-trading'
import type {
  AccountMode,
  ContractOption,
  ContractQuote,
  ContractType,
  PlaceTradeInput,
  Trade,
  TradeResult,
  TradeStatus,
} from '@/types'
import { ordinalSuffix, quoteSelection, type TradingProvider } from '@/providers/trading/demo-trading-provider'

/** First settle request this long after expiry (gives Deriv time to publish the exit tick). */
const SETTLE_FIRST_DELAY_MS = 1_500
const SETTLE_RETRY_MS = 3_000
const SETTLE_SLOW_RETRY_MS = 15_000
const SETTLE_FAST_WINDOW_MS = 2 * 60_000
const SETTLE_GIVE_UP_MS = 11 * 60_000

function unavailableQuote(message: string, stake: number): ContractQuote {
  return {
    payoutRate: null,
    potentialReturn: null,
    potentialLoss: Number.isFinite(stake) && stake > 0 ? stake : null,
    available: false,
    message,
    isSimulated: false,
    accountMode: 'real',
  }
}

function num(value: unknown): number | null {
  if (value == null) return null
  const n = typeof value === 'number' ? value : Number(value)
  return Number.isFinite(n) ? n : null
}

function mapContractType(value: string): ContractType {
  if (value === 'EVEN_ODD' || value === 'MATCH_DIFFER' || value === 'OVER_UNDER') return value
  return 'EVEN_ODD'
}

function mapContractOption(value: string): ContractOption {
  const allowed: ContractOption[] = ['even', 'odd', 'match', 'differ', 'over', 'under']
  if ((allowed as string[]).includes(value)) return value as ContractOption
  return 'even'
}

function mapTradeStatus(value: string): TradeStatus {
  const allowed: TradeStatus[] = ['open', 'won', 'lost', 'tie', 'cancelled']
  if ((allowed as string[]).includes(value)) return value as TradeStatus
  return 'open'
}

type TradeRow = RealTradeRow & {
  user_id?: string
  account_id?: string
  wallet_id?: string
}

const TRADE_SELECT =
  'id, user_id, account_id, account_mode, wallet_id, symbol, contract_type, contract_option, selected_digit, barrier, stake, duration_ms, duration_ticks, entry_epoch, tick_anchor_epoch, payout_rate, status, entry_price, exit_price, exit_digit, payout, profit_loss, expires_at, resolved_at, is_simulated, created_at, updated_at'

function mapTrade(row: TradeRow): Trade {
  const status = mapTradeStatus(row.status)
  const durationMs = row.duration_ms
  return {
    id: row.id,
    userId: row.user_id ?? '',
    accountId: row.account_id ?? '',
    accountMode: 'real',
    walletId: row.wallet_id ?? '',
    walletKind: 'real',
    symbol: row.symbol,
    market: row.symbol,
    contractType: mapContractType(row.contract_type),
    contractOption: mapContractOption(row.contract_option),
    selectedDigit: row.selected_digit,
    barrier: row.barrier,
    stake: num(row.stake) ?? 0,
    durationMs,
    duration: durationMs,
    durationTicks: row.duration_ticks ?? null,
    entryEpochMs: num(row.entry_epoch) != null ? num(row.entry_epoch)! * 1000 : null,
    tickAnchorMs: num(row.tick_anchor_epoch) != null ? num(row.tick_anchor_epoch)! * 1000 : null,
    payoutRate: num(row.payout_rate),
    status,
    result: status,
    entryPrice: num(row.entry_price),
    exitPrice: num(row.exit_price),
    exitDigit: row.exit_digit ?? null,
    payout: num(row.payout),
    profitLoss: num(row.profit_loss),
    expiresAt: row.expires_at,
    resolvedAt: row.resolved_at,
    isSimulated: false,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  }
}

async function fetchRealTrades(filter: 'open' | 'history' | 'one', tradeId?: string) {
  if (!REAL_INTEGRATION.backendConfigured || !isSupabaseConfigured) {
    return { ok: false as const, message: 'Sign in to load REAL trades.', rows: [] as Trade[] }
  }
  const client = getSupabase()!
  const {
    data: { session },
  } = await client.auth.getSession()
  if (!session?.user) {
    return { ok: false as const, message: 'Sign in to load REAL trades.', rows: [] as Trade[] }
  }

  let query = client
    .from('trades')
    .select(TRADE_SELECT)
    .eq('user_id', session.user.id)
    .eq('account_mode', 'real')
    .eq('is_simulated', false)
    .order('created_at', { ascending: false })

  if (filter === 'open') query = query.eq('status', 'open')
  else if (filter === 'history') query = query.neq('status', 'open').limit(500)
  else if (filter === 'one' && tradeId) query = query.eq('id', tradeId)

  const { data, error } = await query
  if (error) {
    return { ok: false as const, message: `REAL trades could not be loaded: ${error.message}`, rows: [] as Trade[] }
  }
  const rows = ((data ?? []) as unknown as Array<TradeRow & { is_simulated: boolean }>)
    .filter((row) => !row.is_simulated)
    .map(mapTrade)
  return { ok: true as const, message: rows.length ? 'REAL trades.' : 'No REAL trades yet.', rows }
}

const watched = new Map<string, ReturnType<typeof setTimeout>>()

/** Polls real-trade-settle around expiry until the trade leaves `open`, then refreshes wallet + trades. */
export function watchRealTradeSettlement(trade: Pick<Trade, 'id' | 'status' | 'expiresAt'>): void {
  if (trade.status !== 'open' || !trade.expiresAt || watched.has(trade.id) || typeof window === 'undefined') return
  const expiryMs = new Date(trade.expiresAt).getTime()
  if (!Number.isFinite(expiryMs)) return

  const attempt = async () => {
    const overdue = Date.now() - expiryMs
    const result = await realTradingService.settle(trade.id)
    const row = result.ok ? result.data[0] : undefined
    if (row && row.status !== 'open') {
      watched.delete(trade.id)
      notifyRealWalletChanged()
      return
    }
    if (overdue > SETTLE_GIVE_UP_MS) {
      watched.delete(trade.id)
      return
    }
    watched.set(trade.id, setTimeout(attempt, overdue < SETTLE_FAST_WINDOW_MS ? SETTLE_RETRY_MS : SETTLE_SLOW_RETRY_MS))
  }

  watched.set(trade.id, setTimeout(attempt, Math.max(0, expiryMs - Date.now()) + SETTLE_FIRST_DELAY_MS))
}

export function isRealTradeSymbol(symbol: string): boolean {
  return (REAL_TRADE_SYMBOLS as readonly string[]).includes(symbol)
}

export function newIdempotencyKey(): string {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') return crypto.randomUUID()
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 12)}`
}

/**
 * Real trading provider. Every REAL trade is priced, opened and settled by the
 * real-trade / real-trade-settle Edge Functions against genuine Deriv ticks.
 * The browser never supplies prices or outcomes and never falls back to DEMO.
 */
export const realTradingProvider: TradingProvider = {
  id: 'real-backend',

  async getQuote(input) {
    const config = await realTradingService.getConfig()
    if (!config.ok) return notConnected(unavailableQuote(config.error, input.stake), config.error, 'REAL_TRADING_UNAVAILABLE')
    if (!config.data.enabled) {
      const message = config.data.message ?? 'Real trading is paused right now.'
      return notConnected(unavailableQuote(message, input.stake), message, 'REAL_TRADING_UNAVAILABLE')
    }
    const stakeError = validateRealStake(input.stake)
    const valid = !stakeError
    const selection = quoteSelection(input)
    const quote: ContractQuote = {
      payoutRate: digitPayoutRate(selection),
      potentialReturn: valid ? potentialPayout(input.stake, selection) : null,
      potentialLoss: valid ? input.stake : null,
      available: valid,
      message: stakeError ?? 'Real money. If the contract loses you lose your stake.',
      isSimulated: false,
      accountMode: 'real',
    }
    return okReal(quote, quote.message)
  },

  async place(input) {
    return this.placeTrade(input)
  },

  async placeTrade(input: PlaceTradeInput) {
    const mode = input.accountMode ?? input.kind
    if (mode !== 'real') {
      return notConnected(null, 'RealTradingProvider refuses DEMO orders.', 'CROSS_MODE_FORBIDDEN', 'demo')
    }
    if (!isRealTradeSymbol(input.symbol)) {
      return notConnected(null, 'This market is not available for REAL trading.', 'VALIDATION')
    }
    const invalid = validateContractSelection(input) ?? validateRealStake(input.stake)
    if (invalid) return notConnected(null, invalid, 'VALIDATION')

    const result = await realTradingService.place({
      symbol: input.symbol,
      contractType: input.contractType,
      contractOption: input.contractOption,
      selectedDigit: input.contractType === 'MATCH_DIFFER' ? (input.selectedDigit ?? null) : null,
      barrier: input.contractType === 'OVER_UNDER' ? (input.barrier ?? null) : null,
      stake: input.stake,
      durationMs: input.durationMs,
      durationTicks: input.durationTicks ?? null,
      idempotencyKey: input.idempotencyKey ?? newIdempotencyKey(),
    })
    if (!result.ok) return notConnected(null, result.error, 'REAL_TRADING_UNAVAILABLE')

    const trade = mapTrade(result.data)
    notifyRealWalletChanged()
    watchRealTradeSettlement(trade)
    return okReal(
      trade,
      trade.durationTicks != null
        ? `Trade placed at ${trade.entryPrice ?? '—'}. Settles on the ${trade.durationTicks}${ordinalSuffix(trade.durationTicks)} Deriv tick after it opened.`
        : `Trade placed at ${trade.entryPrice ?? '—'}. Settles on the first Deriv tick after expiry.`,
    )
  },

  async getOpenTrades(kind: AccountMode) {
    return this.listOpen(kind)
  },

  async getTradeHistory(kind: AccountMode) {
    return this.listHistory(kind)
  },

  async getTradeStatus(tradeId: string, _kind: AccountMode) {
    const result = await fetchRealTrades('one', tradeId)
    if (!result.ok) return notConnected(null, result.message, 'NOT_CONNECTED')
    const trade = result.rows[0] ?? null
    return okReal(trade, trade ? 'REAL trade status.' : 'REAL trade not found.')
  },

  async listOpen(_kind: AccountMode) {
    const result = await fetchRealTrades('open')
    if (!result.ok) return notConnected([], result.message, 'NOT_CONNECTED')
    for (const trade of result.rows) watchRealTradeSettlement(trade)
    return okReal(result.rows, result.message)
  },

  async listHistory(_kind: AccountMode) {
    const result = await fetchRealTrades('history')
    if (!result.ok) return notConnected([], result.message, 'NOT_CONNECTED')
    return okReal(result.rows, result.message)
  },

  async listResults(_kind: AccountMode) {
    if (!REAL_INTEGRATION.backendConfigured || !isSupabaseConfigured) {
      return notConnected([] as TradeResult[], 'Sign in to load REAL settlements.')
    }
    const client = getSupabase()!
    const {
      data: { session },
    } = await client.auth.getSession()
    if (!session?.user) return notConnected([] as TradeResult[], 'Sign in to load REAL settlements.')

    const { data, error } = await client
      .from('trade_settlements')
      .select('trade_id, outcome, exit_price, payout, created_at, is_simulated, account_mode')
      .eq('user_id', session.user.id)
      .eq('account_mode', 'real')
      .eq('is_simulated', false)
      .order('created_at', { ascending: false })
    if (error) return notConnected([] as TradeResult[], `REAL settlements could not be loaded: ${error.message}`)

    const rows: TradeResult[] = (data ?? []).map((row) => ({
      tradeId: row.trade_id,
      outcome: row.outcome === 'win' || row.outcome === 'loss' || row.outcome === 'tie' ? row.outcome : 'loss',
      exitPrice: num(row.exit_price),
      payout: num(row.payout),
      closedAt: row.created_at,
    }))
    return okReal(rows, rows.length ? 'REAL settlements.' : 'No REAL settlements yet.')
  },

  async settleDue() {
    const result = await realTradingService.settle()
    if (!result.ok) return notConnected([] as Trade[], result.error || REAL_UNAVAILABLE_TRADING)
    notifyRealWalletChanged()
    return okReal([] as Trade[], 'REAL settlement requested.')
  },
}
