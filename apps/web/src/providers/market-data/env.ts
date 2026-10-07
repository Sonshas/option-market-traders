/** Prices come from the in-browser simulated market; there is no external market-data feed. */

export type MarketDataProviderId = 'simulated'

export function getMarketDataProviderId(): MarketDataProviderId {
  return 'simulated'
}

export function isMarketDataProviderConfigured(): boolean {
  return true
}
