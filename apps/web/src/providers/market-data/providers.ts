import { simulatedMarketDataProvider } from '@/providers/market-data/simulated-provider'
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
  /** Identity of the underlying feed; providers that share one share subscriptions. */
  readonly feedId?: string
  readonly isSimulated: boolean
  getStatus(): ConnectionStatus
  listMarkets(): Promise<Market[]>
  getMarket(symbol: string): Promise<Market | null>
  getSnapshot(symbol: string, timeframe: Timeframe): Promise<MarketSnapshot>
  subscribeTicks(symbol: string, onTick: (tick: Tick) => void): () => void
  subscribeLive?(
    symbol: string,
    timeframe: Timeframe,
    onUpdate: (update: LiveCandleUpdate) => void,
  ): () => void
  onConnectionStatus?(handler: (status: ConnectionStatus, detail?: string) => void): () => void
  getLatestQuote?(symbol: string): Tick | null
  getTickHistory?(symbol: string, count?: number): Promise<Tick[]>
  refreshQuotes?(symbols: string[]): Promise<void>
}

/** DEMO practice prices come from the in-browser simulated market. */
export const demoMarketDataProvider: MarketDataProvider = simulatedMarketDataProvider

/** @deprecated The site is DEMO-only; kept for existing imports. */
export const realMarketDataProvider: MarketDataProvider = simulatedMarketDataProvider

export function resolveRealMarketDataProvider(): MarketDataProvider {
  return simulatedMarketDataProvider
}
