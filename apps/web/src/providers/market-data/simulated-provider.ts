import { REAL_TRADE_SYMBOLS, extractLastDigit, nominalTickIntervalMs } from '@/domain/digit-contracts'
import { applyTickToCandles, timeframeToMs } from '@/providers/market-data/deriv-digits'
import type { LiveCandleUpdate, MarketDataProvider } from '@/providers/market-data/providers'
import { getBufferedTicks, recordTicks } from '@/providers/market-data/tick-buffer'
import type { Candle, ConnectionStatus, Market, MarketSnapshot, Tick, Timeframe } from '@/types'

export const SIMULATED_FEED_LABEL = 'SIMULATED MARKET · DEMO practice'
export const SIMULATED_TIMEFRAMES = ['1m', '5m', '15m', '30m', '1h', '4h', '1d'] as const

const HISTORY_TICKS = 1000
const HISTORY_CANDLES = 500

type SimSymbol = {
  symbol: string
  displayName: string
  pipSize: number
  startPrice: number
  /** Typical per-tick move as a fraction of price. */
  volatility: number
}

const SYMBOLS: SimSymbol[] = REAL_TRADE_SYMBOLS.map((symbol) => {
  const level = Number(symbol.match(/(\d+)V?$/)?.[1]) || 100
  const oneSecond = symbol.startsWith('1HZ')
  return {
    symbol,
    displayName: `Practice Index ${level}${oneSecond ? ' (1s)' : ''}`,
    pipSize: oneSecond ? 0.01 : level <= 25 ? 0.001 : level <= 75 ? 0.0001 : 0.01,
    startPrice: oneSecond ? 1000 + level * 40 : 2000 + level * 55,
    volatility: (level / 100) * 0.0009,
  }
})

const bySymbol = new Map(SYMBOLS.map((s) => [s.symbol, s]))
const lastPrice = new Map<string, number>()
const nextDueMs = new Map<string, number>()
const tickListeners = new Set<(tick: Tick) => void>()
let started = false

function intervalOf(symbol: string): number {
  return nominalTickIntervalMs(symbol) ?? 2_000
}

function decimalsOf(pipSize: number): number {
  return Math.max(0, Math.round(-Math.log10(pipSize)))
}

function gaussian(): number {
  const u = 1 - Math.random()
  const v = Math.random()
  return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v)
}

function walk(sim: SimSymbol, price: number): number {
  const next = price * (1 + sim.volatility * gaussian())
  return next > sim.startPrice * 0.2 ? next : price
}

function roundToPip(price: number, pipSize: number): number {
  return Number((Math.round(price / pipSize) * pipSize).toFixed(decimalsOf(pipSize)))
}

function makeTick(sim: SimSymbol, timestampMs: number): Tick {
  const price = roundToPip(walk(sim, lastPrice.get(sim.symbol) ?? sim.startPrice), sim.pipSize)
  lastPrice.set(sim.symbol, price)
  return {
    symbol: sim.symbol,
    price,
    timestamp: timestampMs,
    epoch: Math.floor(timestampMs / 1000),
    pipSize: sim.pipSize,
    lastDigit: extractLastDigit(price, sim.pipSize),
    // The chart, digit-stat and settlement pipelines drop ticks flagged as simulated; the feed is labelled instead.
    isSimulated: false,
    feedLabel: SIMULATED_FEED_LABEL,
    bid: null,
    ask: null,
  }
}

function emitDue(now: number): void {
  for (const sim of SYMBOLS) {
    const step = intervalOf(sim.symbol)
    let due = nextDueMs.get(sim.symbol) ?? Math.ceil(now / step) * step
    const fresh: Tick[] = []
    while (due <= now) {
      fresh.push(makeTick(sim, due))
      due += step
    }
    nextDueMs.set(sim.symbol, due)
    if (fresh.length === 0) continue
    recordTicks(sim.symbol, fresh)
    for (const tick of fresh) for (const listener of tickListeners) listener(tick)
  }
}

/** Starts the simulated feed once: seeds recent tick history per symbol, then ticks on each symbol's interval. */
export function ensureSimulatedFeed(now = Date.now()): void {
  if (started) return
  started = true
  for (const sim of SYMBOLS) {
    const step = intervalOf(sim.symbol)
    const lastSlot = Math.floor(now / step) * step
    const history: Tick[] = []
    for (let i = HISTORY_TICKS - 1; i >= 0; i -= 1) history.push(makeTick(sim, lastSlot - i * step))
    recordTicks(sim.symbol, history)
    nextDueMs.set(sim.symbol, lastSlot + step)
  }
  if (typeof setInterval !== 'undefined') setInterval(() => emitDue(Date.now()), 250)
}

function candleHistory(sim: SimSymbol, timeframe: Timeframe): Candle[] {
  const frameMs = timeframeToMs(timeframe)
  const ticks = getBufferedTicks(sim.symbol)
  const latest = ticks[ticks.length - 1]?.price ?? sim.startPrice
  const firstTickBucket = ticks.length > 0 ? Math.floor(ticks[0]!.timestamp / frameMs) * frameMs : Date.now()
  const stepsPerCandle = Math.max(1, frameMs / intervalOf(sim.symbol))
  const candleVol = sim.volatility * Math.sqrt(stepsPerCandle)

  const older: Candle[] = []
  let close = ticks[0]?.price ?? latest
  for (let i = 1; i <= HISTORY_CANDLES; i += 1) {
    const open = close / (1 + candleVol * gaussian())
    const high = Math.max(open, close) * (1 + Math.abs(candleVol * gaussian()) / 2)
    const low = Math.min(open, close) * (1 - Math.abs(candleVol * gaussian()) / 2)
    older.unshift({
      time: firstTickBucket - i * frameMs,
      open: roundToPip(open, sim.pipSize),
      high: roundToPip(high, sim.pipSize),
      low: roundToPip(low, sim.pipSize),
      close: roundToPip(close, sim.pipSize),
    })
    close = open
  }
  let fromTicks: Candle[] = []
  for (const tick of ticks) fromTicks = applyTickToCandles(fromTicks, tick.price, tick.timestamp, frameMs)
  return [...older, ...fromTicks].slice(-HISTORY_CANDLES)
}

function marketOf(sim: SimSymbol): Market {
  const price = lastPrice.get(sim.symbol) ?? null
  return {
    symbol: sim.symbol,
    displayName: sim.displayName,
    category: 'synthetic',
    contractKinds: ['EVEN_ODD', 'MATCH_DIFFER', 'OVER_UNDER'],
    durationsMs: [5_000, 10_000, 15_000, 30_000, 60_000],
    lastPrice: price,
    priceStatus: price != null ? 'live' : 'connecting',
    feedLabel: SIMULATED_FEED_LABEL,
    isSimulated: false,
    pipSize: sim.pipSize,
  }
}

export function simulatedDisplayName(symbol: string): string {
  return bySymbol.get(symbol)?.displayName ?? symbol
}

export const simulatedMarketDataProvider: MarketDataProvider = {
  id: 'simulated',
  feedId: 'simulated',
  isSimulated: true,

  getStatus(): ConnectionStatus {
    ensureSimulatedFeed()
    return 'live'
  },

  async listMarkets() {
    ensureSimulatedFeed()
    return SYMBOLS.map(marketOf)
  },

  async getMarket(symbol) {
    ensureSimulatedFeed()
    const sim = bySymbol.get(symbol)
    return sim ? marketOf(sim) : null
  },

  async getSnapshot(symbol, timeframe): Promise<MarketSnapshot> {
    ensureSimulatedFeed()
    const sim = bySymbol.get(symbol)
    const ticks = getBufferedTicks(symbol)
    const lastTick = ticks[ticks.length - 1] ?? null
    return {
      status: sim ? 'live' : 'disconnected',
      candles: sim ? candleHistory(sim, timeframe) : [],
      lastTick,
      note: SIMULATED_FEED_LABEL,
      isSimulated: false,
      feedLabel: SIMULATED_FEED_LABEL,
      bid: null,
      ask: null,
      lastUpdateAt: lastTick?.timestamp ?? null,
    }
  },

  subscribeTicks(symbol, onTick) {
    ensureSimulatedFeed()
    const listener = (tick: Tick) => {
      if (tick.symbol === symbol) onTick(tick)
    }
    tickListeners.add(listener)
    return () => {
      tickListeners.delete(listener)
    }
  },

  subscribeLive(symbol, timeframe, onUpdate: (update: LiveCandleUpdate) => void) {
    ensureSimulatedFeed()
    const frameMs = timeframeToMs(timeframe)
    let candles: Candle[] = []
    const listener = (tick: Tick) => {
      if (tick.symbol !== symbol) return
      candles = applyTickToCandles(candles.slice(-1), tick.price, tick.timestamp, frameMs)
      const candle = candles[candles.length - 1]
      if (candle) onUpdate({ candle, isFinal: false, tick, bid: null, ask: null })
    }
    tickListeners.add(listener)
    return () => {
      tickListeners.delete(listener)
    }
  },

  onConnectionStatus(handler) {
    ensureSimulatedFeed()
    handler('live')
    return () => undefined
  },

  getLatestQuote(symbol) {
    ensureSimulatedFeed()
    const ticks = getBufferedTicks(symbol)
    return ticks[ticks.length - 1] ?? null
  },

  async getTickHistory(symbol, count = HISTORY_TICKS) {
    ensureSimulatedFeed()
    return getBufferedTicks(symbol).slice(-count)
  },

  async refreshQuotes() {
    ensureSimulatedFeed()
  },
}
