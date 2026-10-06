/**
 * REAL market-data env (public / non-secret only).
 * Deriv public WebSocket uses a public app_id (default 1089 for testing).
 * Never put service-role or private trading credentials here.
 */

export type MarketDataProviderId = 'deriv' | 'binance' | 'none'

function readEnv(key: string): string {
  const value = (import.meta.env as Record<string, string | undefined>)[key]
  return typeof value === 'string' ? value.trim() : ''
}

export function getMarketDataProviderId(): MarketDataProviderId {
  const raw = readEnv('VITE_MARKET_DATA_PROVIDER').toLowerCase()
  if (raw === 'deriv') return 'deriv'
  if (raw === 'binance') return 'binance'
  return 'none'
}

export function isMarketDataProviderConfigured(): boolean {
  const id = getMarketDataProviderId()
  return id === 'deriv' || id === 'binance'
}

/** Public Deriv app id (register your own at api.deriv.com for production). */
export function getDerivAppId(): string {
  return readEnv('VITE_DERIV_APP_ID') || '1089'
}

/** Deriv public market-data WebSocket (new API; the legacy ws.derivws.com/websockets/v3 endpoint is retired). */
export function getDerivWsUrl(): string {
  const configured = readEnv('VITE_MARKET_DATA_WS_URL')
  if (configured && !configured.includes('ws.derivws.com/websockets/v3')) return configured
  return 'wss://api.derivws.com/trading/v1/options/ws/public'
}

/** REST proxy base (apps/api) — used by Binance historical klines only. */
export function getMarketDataApiUrl(): string {
  return readEnv('VITE_MARKET_DATA_API_URL') || 'http://localhost:3001'
}

/** Binance public combined/stream WS base (legacy optional provider). */
export function getMarketDataWsUrl(): string {
  return readEnv('VITE_MARKET_DATA_WS_URL') || 'wss://stream.binance.com:9443'
}

export const REAL_FEED_LABEL_DERIV = 'REAL MARKET DATA · Deriv public ticks'
export const REAL_FEED_LABEL_BINANCE = 'REAL MARKET DATA · Binance public'
export const REAL_FEED_LABEL =
  getMarketDataProviderId() === 'binance' ? REAL_FEED_LABEL_BINANCE : REAL_FEED_LABEL_DERIV

export const REAL_MARKET_UNAVAILABLE =
  'REAL MARKET DATA NOT CONNECTED. Live ticks could not be loaded from the configured provider. DEMO simulated prices are never shown in REAL mode.'

export const REAL_EXECUTION_NOT_CONNECTED =
  'REAL TRADING EXECUTION NOT CONNECTED. Contract selection is for analysis only — no REAL wallet debit, trade, or settlement is created.'
