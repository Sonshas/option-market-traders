import { getAccountProviders } from '@/providers/registry'
import type { AccountMode, ConnectionStatus, Market, MarketSnapshot, Tick, Timeframe } from '@/types'
import type { MarketDataProvider } from '@/providers/market-data/providers'

export type { MarketDataProvider }

/**
 * Mode-scoped market-data access.
 * DEMO → simulated feed. REAL → Binance public when configured; else disconnected.
 * Never substitutes DEMO prices into REAL mode.
 */
export function getMarketDataProvider(mode: AccountMode): MarketDataProvider {
  return getAccountProviders(mode).marketData
}

/** @deprecated Prefer getMarketDataProvider(mode). Kept for call sites migrating off the global stub. */
export const marketDataProvider: MarketDataProvider = {
  id: 'mode-scoped-default-demo',
  isSimulated: true,
  getStatus(): ConnectionStatus {
    return getMarketDataProvider('demo').getStatus()
  },
  listMarkets(): Promise<Market[]> {
    return getMarketDataProvider('demo').listMarkets()
  },
  getMarket(symbol: string): Promise<Market | null> {
    return getMarketDataProvider('demo').getMarket(symbol)
  },
  getSnapshot(symbol: string, timeframe: Timeframe): Promise<MarketSnapshot> {
    return getMarketDataProvider('demo').getSnapshot(symbol, timeframe)
  },
  subscribeTicks(symbol: string, onTick: (tick: Tick) => void): () => void {
    return getMarketDataProvider('demo').subscribeTicks(symbol, onTick)
  },
}
