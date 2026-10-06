import {
  DEMO_ACCOUNT_ID,
  DEMO_USER_ID,
  DEMO_WALLET_ID,
} from '@/domain/account'
import { formatContractTicket, lastDigitOfPrice, settleDigitContract } from '@/domain/contracts'
import {
  REFUND_AFTER_MS,
  TICK_DURATION_MAX,
  TICK_DURATION_MIN,
  digitPayoutRate,
  estimatedTickExpiryMs,
  isValidTickDuration,
  payoutFor,
  potentialPayout,
  selectNthTickAfter,
  validateContractSelection,
  type DigitContractSelection,
} from '@/domain/digit-contracts'
import { createId, nowIso } from '@/lib/ids'
import { extractLastDigit } from '@/providers/market-data/deriv-digits'
import {
  firstTickAtOrAfter,
  getBufferedTicks,
  getLastReceivedAt,
  getLatestBufferedTick,
  getLiveTickSource,
} from '@/providers/market-data/tick-buffer'
import {
  appendDemoLedger,
  applyDemoBalance,
  loadDemoState,
  mutateDemoState,
  pushDemoNotification,
} from '@/lib/demo-store'
import { okDemo } from '@/providers/results'
import type {
  AccountMode,
  ContractOption,
  ContractType,
  ContractQuote,
  PlaceTradeInput,
  ProviderResult,
  Trade,
  TradeResult,
  TradeStatus,
  Tick,
  TradeSettlement,
  Transaction,
} from '@/types'

/** A DEMO trade only opens against a genuine tick received within this window. */
const ENTRY_MAX_AGE_MS = 30_000
/** Ask the feed for the expiry window via ticks_history once the trade is this overdue. */
const BACKFILL_AFTER_MS = 10_000
const BACKFILL_RETRY_MS = 15_000

const backfillRequestedAt = new Map<string, number>()
/** Tick trades: the live buffer can miss ticks across a reconnect, so the window is backfilled once before settling. */
const tickWindowVerified = new Map<string, 'pending' | 'done'>()

function tickDigit(tick: Tick): number {
  if (tick.lastDigit != null) return tick.lastDigit
  if (tick.pipSize != null) {
    const digit = extractLastDigit(tick.price, tick.pipSize)
    if (digit != null) return digit
  }
  return lastDigitOfPrice(tick.price)
}

export interface TradingProvider {
  readonly id: string
  getQuote(input: {
    stake: number
    durationMs: number
    symbol: string
    contractType?: ContractType
    contractOption?: ContractOption
    selectedDigit?: number | null
    barrier?: number | null
    kind?: AccountMode
  }): Promise<ProviderResult<ContractQuote>>
  placeTrade(input: PlaceTradeInput): Promise<ProviderResult<Trade | null>>
  place(input: PlaceTradeInput): Promise<ProviderResult<Trade | null>>
  getOpenTrades(kind: AccountMode): Promise<ProviderResult<Trade[]>>
  getTradeHistory(kind: AccountMode): Promise<ProviderResult<Trade[]>>
  getTradeStatus(tradeId: string, kind: AccountMode): Promise<ProviderResult<Trade | null>>
  listOpen(kind: AccountMode): Promise<ProviderResult<Trade[]>>
  listHistory(kind: AccountMode): Promise<ProviderResult<Trade[]>>
  listResults(kind: AccountMode): Promise<ProviderResult<TradeResult[]>>
  settleDue(now?: number): Promise<ProviderResult<Trade[]>>
}

/** Contract selection used for pricing; missing fields fall back to the ticket defaults. */
export function quoteSelection(input: {
  contractType?: ContractType
  contractOption?: ContractOption
  selectedDigit?: number | null
  barrier?: number | null
}): DigitContractSelection {
  const contractType = input.contractType ?? 'EVEN_ODD'
  return {
    contractType,
    contractOption: input.contractOption ?? (contractType === 'EVEN_ODD' ? 'even' : contractType === 'MATCH_DIFFER' ? 'match' : 'over'),
    selectedDigit: input.selectedDigit ?? null,
    barrier: input.barrier ?? null,
  }
}

function demoQuote(stake: number, selection: DigitContractSelection): ContractQuote {
  const valid = Number.isFinite(stake) && stake > 0
  return {
    payoutRate: valid ? digitPayoutRate(selection) : null,
    potentialReturn: valid ? potentialPayout(stake, selection) : null,
    potentialLoss: valid ? stake : null,
    available: valid,
    message: valid
      ? 'DEMO simulated payout if the contract wins. Not a guaranteed profit or win rate.'
      : 'Enter a stake greater than zero.',
    isSimulated: true,
    accountMode: 'demo',
  }
}

function lockStake(trade: Trade, now: number): void {
  mutateDemoState((state) => {
    const createdAt = trade.createdAt
    const stakeTx: Transaction = {
      id: createId('txn'),
      userId: DEMO_USER_ID,
      accountId: DEMO_ACCOUNT_ID,
      accountMode: 'demo',
      walletId: DEMO_WALLET_ID,
      type: 'trade_stake',
      amount: -trade.stake,
      currency: 'USD',
      status: 'COMPLETED',
      reference: trade.id,
      note: 'DEMO simulated stake lock',
      isSimulated: true,
      createdAt,
      updatedAt: createdAt,
    }
    let next = applyDemoBalance(state, -trade.stake, trade.stake, now)
    next = { ...next, trades: [trade, ...next.trades], transactions: [stakeTx, ...next.transactions] }
    next = appendDemoLedger(
      next,
      { entryType: 'trade_stake', amount: -trade.stake, referenceId: trade.id, note: 'DEMO simulated stake' },
      now,
    )
    const label = formatContractTicket(trade.contractType, trade.contractOption, {
      digit: trade.selectedDigit,
      barrier: trade.barrier,
    })
    return pushDemoNotification(
      next,
      'trading',
      'DEMO trade opened',
      `SIMULATED ${label} on ${trade.market} stake ${trade.stake}. DEMO ACCOUNT only.`,
      now,
    )
  })
}

/**
 * Settle open DEMO trades against the first genuine tick at/after expiry.
 * No tick yet → keep waiting (and backfill from ticks_history); after REFUND_AFTER_MS with
 * no genuine exit tick the stake is refunded. Prices and digits are never invented.
 */
export function settleDemoTrades(now = Date.now()): Trade[] {
  const open = loadDemoState().trades.filter((trade) => trade.status === 'open' && trade.expiresAt)
  const settled: Trade[] = []
  const source = getLiveTickSource()
  for (const trade of open) {
    if (trade.durationTicks != null && trade.tickAnchorMs != null) {
      const closed = settleDemoTickTrade(trade, trade.durationTicks, trade.tickAnchorMs, now)
      if (closed) settled.push(closed)
      continue
    }
    const expiryMs = new Date(trade.expiresAt!).getTime()
    const exitTick = firstTickAtOrAfter(trade.symbol, expiryMs)
    if (exitTick) {
      const exitDigit = tickDigit(exitTick)
      const outcome = settleDigitContract({
        contractType: trade.contractType,
        contractOption: trade.contractOption,
        selectedDigit: trade.selectedDigit,
        barrier: trade.barrier,
        exitPrice: exitTick.price,
        exitDigit,
      })
      settled.push(closeDemoTrade(trade, outcome, exitTick.price, exitDigit, now))
      backfillRequestedAt.delete(trade.id)
      continue
    }

    const openedAt = new Date(trade.createdAt).getTime()
    const overdueMs = now - (Math.max(openedAt, 0) + trade.durationMs)
    if (overdueMs <= 0) continue
    source?.ensureSubscribed(trade.symbol)
    if (overdueMs >= REFUND_AFTER_MS) {
      settled.push(closeDemoTrade(trade, 'cancelled', null, null, now))
      backfillRequestedAt.delete(trade.id)
      continue
    }
    if (source && overdueMs >= BACKFILL_AFTER_MS) {
      const last = backfillRequestedAt.get(trade.id) ?? 0
      if (now - last >= BACKFILL_RETRY_MS) {
        backfillRequestedAt.set(trade.id, now)
        void source.backfill(trade.symbol, expiryMs, expiryMs + 60_000).catch(() => undefined)
      }
    }
  }
  return settled
}

/** Settles one DEMO tick contract on the Nth genuine tick after its anchor; refunds after REFUND_AFTER_MS. */
function settleDemoTickTrade(trade: Trade, durationTicks: number, anchorMs: number, now: number): Trade | null {
  const source = getLiveTickSource()
  const ticks = getBufferedTicks(trade.symbol).map((tick) => ({ ...tick, epochMs: tick.timestamp }))
  const found = selectNthTickAfter(ticks, anchorMs, durationTicks)
  if (found) {
    const verified = tickWindowVerified.get(trade.id)
    if (source && verified !== 'done') {
      if (verified !== 'pending') {
        tickWindowVerified.set(trade.id, 'pending')
        void source
          .backfill(trade.symbol, anchorMs, found.exit.epochMs + 1_000)
          .catch(() => undefined)
          .finally(() => tickWindowVerified.set(trade.id, 'done'))
      }
      return null
    }
    tickWindowVerified.delete(trade.id)
    backfillRequestedAt.delete(trade.id)
    const exitDigit = tickDigit(found.exit)
    const outcome = settleDigitContract({
      contractType: trade.contractType,
      contractOption: trade.contractOption,
      selectedDigit: trade.selectedDigit,
      barrier: trade.barrier,
      exitPrice: found.exit.price,
      exitDigit,
    })
    return closeDemoTrade(trade, outcome, found.exit.price, exitDigit, now)
  }

  source?.ensureSubscribed(trade.symbol)
  if (now - anchorMs >= REFUND_AFTER_MS) {
    tickWindowVerified.delete(trade.id)
    backfillRequestedAt.delete(trade.id)
    return closeDemoTrade(trade, 'cancelled', null, null, now)
  }
  const overdueMs = now - estimatedTickExpiryMs(anchorMs, durationTicks, trade.symbol)
  if (source && overdueMs >= BACKFILL_AFTER_MS) {
    const last = backfillRequestedAt.get(trade.id) ?? 0
    if (now - last >= BACKFILL_RETRY_MS) {
      backfillRequestedAt.set(trade.id, now)
      void source.backfill(trade.symbol, anchorMs, now).catch(() => undefined)
    }
  }
  return null
}

function closeDemoTrade(
  trade: Trade,
  outcome: Exclude<TradeStatus, 'open'>,
  exitPrice: number | null,
  exitDigit: number | null,
  now: number,
): Trade {
  const payoutRate = trade.payoutRate ?? digitPayoutRate(trade)
  const payout = payoutFor(trade.stake, payoutRate, outcome)
  const profitLoss = Number((payout - trade.stake).toFixed(2))
  const updatedAt = nowIso(now)
  const closed: Trade = {
    ...trade,
    status: outcome,
    result: outcome,
    exitPrice,
    exitDigit,
    payout,
    profitLoss,
    resolvedAt: updatedAt,
    updatedAt,
    isSimulated: true,
    accountMode: 'demo',
  }
  const settlement: TradeSettlement = {
    id: createId('stl'),
    userId: DEMO_USER_ID,
    accountId: DEMO_ACCOUNT_ID,
    accountMode: 'demo',
    tradeId: trade.id,
    outcome: outcome === 'won' ? 'win' : outcome === 'lost' ? 'loss' : 'tie',
    exitPrice,
    payout,
    profitLoss,
    isSimulated: true,
    createdAt: updatedAt,
    updatedAt,
  }
  mutateDemoState((state) => {
    let next = applyDemoBalance(state, payout, -trade.stake, now)
    const payoutType = outcome === 'lost' ? 'trade_stake' : outcome === 'won' ? 'trade_payout' : 'trade_refund'
    const tx: Transaction = {
      id: createId('txn'),
      userId: DEMO_USER_ID,
      accountId: DEMO_ACCOUNT_ID,
      accountMode: 'demo',
      walletId: DEMO_WALLET_ID,
      type: payoutType,
      amount: payout,
      currency: 'USD',
      status: 'COMPLETED',
      reference: trade.id,
      note:
        outcome === 'cancelled'
          ? 'DEMO stake refunded — no genuine exit tick was available'
          : `DEMO settlement (${outcome}) on live exit digit ${exitDigit ?? '—'}`,
      isSimulated: true,
      createdAt: updatedAt,
      updatedAt,
    }
    next = {
      ...next,
      trades: next.trades.map((item) => (item.id === trade.id ? closed : item)),
      settlements: [settlement, ...next.settlements],
      transactions: [tx, ...next.transactions],
    }
    next = appendDemoLedger(
      next,
      {
        entryType: payoutType,
        amount: payout,
        referenceId: trade.id,
        note: `DEMO ${outcome}`,
      },
      now,
    )
    return pushDemoNotification(
      next,
      'trading',
      `DEMO trade ${outcome}`,
      outcome === 'cancelled'
        ? `${trade.market}: no live exit tick could be loaded, DEMO stake refunded.`
        : `${trade.market} ${outcome.toUpperCase()} on live digit ${exitDigit ?? '—'}. P/L ${profitLoss}. DEMO funds — not real money.`,
      now,
    )
  })
  return closed
}

let settleTimer: ReturnType<typeof setInterval> | null = null

export function startDemoSettlementLoop(): void {
  if (settleTimer || typeof setInterval === 'undefined') return
  settleTimer = setInterval(() => {
    settleDemoTrades(Date.now())
  }, 1000)
}

export function stopDemoSettlementLoop(): void {
  if (settleTimer) {
    clearInterval(settleTimer)
    settleTimer = null
  }
}

export function ordinalSuffix(n: number): string {
  const mod100 = n % 100
  if (mod100 >= 11 && mod100 <= 13) return 'th'
  return n % 10 === 1 ? 'st' : n % 10 === 2 ? 'nd' : n % 10 === 3 ? 'rd' : 'th'
}

function validatePlaceInput(input: PlaceTradeInput): string | null {
  if (!(input.stake > 0) || !input.symbol) return 'Stake and market are required for a DEMO trade.'
  if (input.durationTicks != null && !isValidTickDuration(input.durationTicks)) {
    return `Select a duration of ${TICK_DURATION_MIN}–${TICK_DURATION_MAX} ticks.`
  }
  return validateContractSelection(input)
}

export const demoTradingProvider: TradingProvider = {
  id: 'demo-local',

  async getQuote(input) {
    const quote = demoQuote(input.stake, quoteSelection(input))
    return okDemo(quote, quote.message)
  },

  async place(input) {
    return this.placeTrade(input)
  },

  async placeTrade(input) {
    const mode = input.accountMode ?? input.kind
    if (mode !== 'demo') {
      return {
        status: 'not_connected',
        connected: false,
        message: 'DemoTradingProvider refuses real-mode orders.',
        data: null,
        code: 'CROSS_MODE_FORBIDDEN',
        accountMode: 'real',
        isSimulated: false,
      }
    }
    const validation = validatePlaceInput(input)
    if (validation) {
      return {
        status: 'not_connected',
        connected: false,
        message: validation,
        data: null,
        code: 'VALIDATION',
        accountMode: 'demo',
        isSimulated: true,
      }
    }
    const wallet = loadDemoState().wallet
    if ((wallet.availableBalance ?? 0) < input.stake) {
      return {
        status: 'not_connected',
        connected: false,
        message: 'Insufficient DEMO balance for this simulated stake.',
        data: null,
        code: 'INSUFFICIENT_FUNDS',
        accountMode: 'demo',
        isSimulated: true,
      }
    }
    getLiveTickSource()?.ensureSubscribed(input.symbol)
    const now = Date.now()
    const entryTick = getLatestBufferedTick(input.symbol)
    if (!entryTick || now - getLastReceivedAt(input.symbol) > ENTRY_MAX_AGE_MS) {
      return {
        status: 'not_connected',
        connected: false,
        message: `Waiting for a live price on ${input.symbol}. DEMO trades open only against genuine market ticks — try again once the chart shows CONNECTED.`,
        data: null,
        code: 'LIVE_MARKET_DATA_UNAVAILABLE',
        accountMode: 'demo',
        isSimulated: true,
      }
    }
    const createdAt = nowIso(now)
    const entryPrice = entryTick.price
    const durationTicks = input.durationTicks ?? null
    // DEMO tick contracts count from the entry tick itself; expiry and duration are estimates for display.
    const anchorMs = entryTick.timestamp
    const durationMs =
      durationTicks != null ? estimatedTickExpiryMs(anchorMs, durationTicks, input.symbol) - anchorMs : input.durationMs
    const trade: Trade = {
      id: createId('trd'),
      userId: DEMO_USER_ID,
      accountId: DEMO_ACCOUNT_ID,
      accountMode: 'demo',
      walletId: DEMO_WALLET_ID,
      walletKind: 'demo',
      symbol: input.symbol,
      market: input.symbol,
      contractType: input.contractType,
      contractOption: input.contractOption,
      selectedDigit: input.contractType === 'MATCH_DIFFER' ? (input.selectedDigit ?? null) : null,
      barrier: input.contractType === 'OVER_UNDER' ? (input.barrier ?? null) : null,
      stake: input.stake,
      durationMs,
      duration: durationMs,
      durationTicks,
      entryEpochMs: entryTick.timestamp,
      tickAnchorMs: durationTicks != null ? anchorMs : null,
      payoutRate: digitPayoutRate({
        contractType: input.contractType,
        contractOption: input.contractOption,
        selectedDigit: input.selectedDigit ?? null,
        barrier: input.barrier ?? null,
      }),
      status: 'open',
      result: 'open',
      entryPrice,
      exitPrice: null,
      exitDigit: null,
      payout: null,
      profitLoss: null,
      // Expiry is anchored on the entry tick's provider time so settlement never depends on the local clock.
      expiresAt: nowIso(entryTick.timestamp + durationMs),
      resolvedAt: null,
      isSimulated: true,
      botRunId: input.botRunId ?? null,
      createdAt,
      updatedAt: createdAt,
    }
    lockStake(trade, now)
    startDemoSettlementLoop()
    return okDemo(
      trade,
      durationTicks != null
        ? `Trade placed at ${entryPrice}. Settles on the ${durationTicks}${ordinalSuffix(durationTicks)} live tick after entry.`
        : `Trade placed at ${entryPrice}. Settles on the real exit tick.`,
    )
  },

  async getOpenTrades(kind) {
    return this.listOpen(kind)
  },

  async getTradeHistory(kind) {
    return this.listHistory(kind)
  },

  async getTradeStatus(tradeId, kind) {
    if (kind !== 'demo') {
      return {
        status: 'not_connected',
        connected: false,
        message: 'DemoTradingProvider refuses real-mode status.',
        data: null,
        code: 'CROSS_MODE_FORBIDDEN',
        accountMode: 'real',
        isSimulated: false,
      }
    }
    settleDemoTrades()
    const trade = loadDemoState().trades.find((item) => item.id === tradeId) ?? null
    return okDemo(trade, trade ? 'DEMO trade status (simulated).' : 'DEMO trade not found.')
  },

  async listOpen(kind) {
    if (kind !== 'demo') {
      return {
        status: 'not_connected',
        connected: false,
        message: 'DemoTradingProvider refuses real-mode lists.',
        data: [],
        code: 'CROSS_MODE_FORBIDDEN',
        accountMode: 'real',
        isSimulated: false,
      }
    }
    settleDemoTrades()
    return okDemo(
      loadDemoState().trades.filter((trade) => trade.status === 'open'),
      'DEMO open trades. Simulated only.',
    )
  },

  async listHistory(kind) {
    if (kind !== 'demo') {
      return {
        status: 'not_connected',
        connected: false,
        message: 'DemoTradingProvider refuses real-mode lists.',
        data: [],
        code: 'CROSS_MODE_FORBIDDEN',
        accountMode: 'real',
        isSimulated: false,
      }
    }
    settleDemoTrades()
    return okDemo(
      loadDemoState().trades.filter((trade) => trade.status !== 'open'),
      'DEMO trade history. Simulated only.',
    )
  },

  async listResults(kind) {
    if (kind !== 'demo') {
      return {
        status: 'not_connected',
        connected: false,
        message: 'DemoTradingProvider refuses real-mode lists.',
        data: [],
        code: 'CROSS_MODE_FORBIDDEN',
        accountMode: 'real',
        isSimulated: false,
      }
    }
    const results: TradeResult[] = loadDemoState().settlements.map((item) => ({
      tradeId: item.tradeId,
      outcome: item.outcome,
      exitPrice: item.exitPrice,
      payout: item.payout,
      closedAt: item.createdAt,
    }))
    return okDemo(results, 'DEMO settlements. Simulated only.')
  },

  async settleDue(now = Date.now()) {
    const settled = settleDemoTrades(now)
    return okDemo(settled, 'DEMO settlements processed.')
  },
}
