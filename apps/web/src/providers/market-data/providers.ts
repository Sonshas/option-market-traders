import { LIVE_MARKET_UNAVAILABLE } from '@/domain/account'
import { MARKET_CATALOG, NOT_CONNECTED } from '@/lib/constants'
import {
  isMarketDataProviderConfigured,
  getMarketDataProviderId,
} from '@/providers/market-data/env'
import { binanceRealMarketDataProvider } from '@/providers/market-data/real-binance-provider'
import { derivRealMarketDataProvider } from '@/providers/market-data/real-deriv-provider'
import type {
  ConnectionStatus,
  Market,
  MarketSnapshot,
  Tick,
  Timeframe,
} from '@/types'

export type LiveCandleUpdate = {
  candle: { time: number; open: number; high: number; low: number; close: number }
  isFinal: boolean
  tick: Tick
  bid: number | null
  ask: number | null
}

export interface MarketDataProvider {
  readonly id: string
  /** Identity of the underlying genuine feed; providers that share one (DEMO/REAL) share subscriptions. */
  readonly feedId?: string
  readonly isSimulated: boolean
  getStatus(): ConnectionStatus
  listMarkets(): Promise<Market[]>
  getMarket(symbol: string): Promise<Market | null>
  getSnapshot(symbol: string, timeframe: Timeframe): Promise<MarketSnapshot>
  subscribeTicks(symbol: string, onTick: (tick: Tick) => void): () => void
  /** Optional live OHLC stream (REAL providers). */
  subscribeLive?(
    symbol: string,
    timeframe: Timeframe,
    onUpdate: (update: LiveCandleUpdate) => void,
  ): () => void
  onConnectionStatus?(handler: (status: ConnectionStatus, detail?: string) => void): () => void
  /** Latest genuine provider quote only — never fabricated. */
  getLatestQuote?(symbol: string): Tick | null
  /** Genuine recent ticks (e.g. Deriv `ticks_history`) for tick charts and digit stats. */
  getTickHistory?(symbol: string, count?: number): Promise<Tick[]>
  /** Refresh the latest genuine quote of each symbol for market-list prices (not the tick buffer). */
  refreshQuotes?(symbols: string[]): Promise<void>
}

/**
 * DEMO market data = the same genuine live feed as REAL (Deriv public ticks).
 * Only the account is virtual: DEMO trades debit/credit the local $10,000 practice balance
 * and settle against real ticks. When no feed is configured, DEMO shows disconnected —
 * prices are never invented.
 */
export const demoMarketDataProvider: MarketDataProvider = {
  id: 'demo-live-prices',
  get feedId() {
    return resolveRealMarketDataProvider().id
  },
  isSimulated: false,

  getStatus() {
    return resolveRealMarketDataProvider().getStatus()
  },

  async listMarkets() {
    const markets = await resolveRealMarketDataProvider().listMarkets()
    return markets.map((market) => ({ ...market, feedLabel: DEMO_LIVE_FEED_LABEL }))
  },

  async getMarket(symbol) {
    const markets = await this.listMarkets()
    return markets.find((market) => market.symbol === symbol) ?? null
  },

  async getSnapshot(symbol, timeframe) {
    return resolveRealMarketDataProvider().getSnapshot(symbol, timeframe)
  },

  subscribeTicks(symbol, onTick) {
    return resolveRealMarketDataProvider().subscribeTicks(symbol, onTick)
  },

  subscribeLive(symbol, timeframe, onUpdate) {
    return resolveRealMarketDataProvider().subscribeLive?.(symbol, timeframe, onUpdate) ?? (() => undefined)
  },

  onConnectionStatus(handler) {
    const real = resolveRealMarketDataProvider()
    if (real.onConnectionStatus) return real.onConnectionStatus(handler)
    handler(real.getStatus())
    return () => undefined
  },

  getLatestQuote(symbol) {
    return resolveRealMarketDataProvider().getLatestQuote?.(symbol) ?? null
  },

  async getTickHistory(symbol, count) {
    return (await resolveRealMarketDataProvider().getTickHistory?.(symbol, count)) ?? []
  },

  async refreshQuotes(symbols) {
    await resolveRealMarketDataProvider().refreshQuotes?.(symbols)
  },
}

export const DEMO_LIVE_FEED_LABEL = 'Live Deriv prices · DEMO virtual funds'

function fallbackRealCatalog(): Market[] {
  return MARKET_CATALOG.map((market) => ({
    ...market,
    lastPrice: null,
    priceStatus: 'disconnected' as const,
    feedLabel: LIVE_MARKET_UNAVAILABLE,
    isSimulated: false,
  }))
}

/**
 * Legacy disconnected REAL provider (catalog metadata only).
 * Used when VITE_MARKET_DATA_PROVIDER is not set.
 */
export const disconnectedRealMarketDataProvider: MarketDataProvider = {
  id: 'real-disconnected',
  isSimulated: false,

  getStatus() {
    return 'disconnected'
  },

  async listMarkets() {
    return fallbackRealCatalog()
  },

  async getMarket(symbol) {
    const markets = await this.listMarkets()
    return markets.find((market) => market.symbol === symbol) ?? null
  },

  async getSnapshot(_symbol, _timeframe) {
    return {
      status: 'disconnected',
      candles: [],
      lastTick: null,
      note: LIVE_MARKET_UNAVAILABLE,
      isSimulated: false,
      feedLabel: LIVE_MARKET_UNAVAILABLE,
      bid: null,
      ask: null,
      lastUpdateAt: null,
    }
  },

  subscribeTicks(_symbol, _onTick) {
    return () => undefined
  },
}

/** @deprecated Prefer resolveRealMarketDataProvider(). Kept for existing imports. */
export const realMarketDataProvider: MarketDataProvider = new Proxy(
  {} as MarketDataProvider,
  {
    get(_target, prop, receiver) {
      return Reflect.get(resolveRealMarketDataProvider(), prop, receiver)
    },
  },
)

export function resolveRealMarketDataProvider(): MarketDataProvider {
  const id = getMarketDataProviderId()
  if (!isMarketDataProviderConfigured()) {
    return disconnectedRealMarketDataProvider
  }
  if (id === 'deriv') return derivRealMarketDataProvider
  if (id === 'binance') return binanceRealMarketDataProvider
  return disconnectedRealMarketDataProvider
}

export function disconnectedMarketNote(): string {
  return `${LIVE_MARKET_UNAVAILABLE} ${NOT_CONNECTED}`
}
