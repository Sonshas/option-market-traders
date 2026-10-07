import type { ConnectionStatus, Market } from '@/types'
import { DERIV_PREFERRED_SYMBOLS } from '@/providers/market-data/deriv-digits'
import { SIMULATED_FEED_LABEL } from '@/providers/market-data/simulated-provider'

/** Deriv rejects candle granularities under 60 s (InputValidationFailed), so there are no 5s/15s/30s candles. */
export const DERIV_REAL_TIMEFRAMES = ['1m', '5m', '15m', '30m', '1h', '4h', '1d'] as const

export type DerivCatalogEntry = {
  symbol: string
  displayName: string
  category: Market['category']
  market: string
  submarket?: string
  pipSize: number
}

/** Used only when `active_symbols` is unreachable; pip sizes mirror the live Deriv response. */
const FALLBACK: DerivCatalogEntry[] = [
  { symbol: 'R_10', displayName: 'Volatility 10 Index', category: 'synthetic', market: 'synthetic_index', submarket: 'random_index', pipSize: 0.001 },
  { symbol: 'R_25', displayName: 'Volatility 25 Index', category: 'synthetic', market: 'synthetic_index', submarket: 'random_index', pipSize: 0.001 },
  { symbol: 'R_50', displayName: 'Volatility 50 Index', category: 'synthetic', market: 'synthetic_index', submarket: 'random_index', pipSize: 0.0001 },
  { symbol: 'R_75', displayName: 'Volatility 75 Index', category: 'synthetic', market: 'synthetic_index', submarket: 'random_index', pipSize: 0.0001 },
  { symbol: 'R_100', displayName: 'Volatility 100 Index', category: 'synthetic', market: 'synthetic_index', submarket: 'random_index', pipSize: 0.01 },
  { symbol: '1HZ10V', displayName: 'Volatility 10 (1s) Index', category: 'synthetic', market: 'synthetic_index', submarket: 'random_index', pipSize: 0.01 },
  { symbol: '1HZ25V', displayName: 'Volatility 25 (1s) Index', category: 'synthetic', market: 'synthetic_index', submarket: 'random_index', pipSize: 0.01 },
  { symbol: '1HZ50V', displayName: 'Volatility 50 (1s) Index', category: 'synthetic', market: 'synthetic_index', submarket: 'random_index', pipSize: 0.01 },
  { symbol: '1HZ75V', displayName: 'Volatility 75 (1s) Index', category: 'synthetic', market: 'synthetic_index', submarket: 'random_index', pipSize: 0.01 },
  { symbol: '1HZ100V', displayName: 'Volatility 100 (1s) Index', category: 'synthetic', market: 'synthetic_index', submarket: 'random_index', pipSize: 0.01 },
]

function categorize(market: string): Market['category'] {
  const m = market.toLowerCase()
  if (m.includes('forex')) return 'forex'
  if (m.includes('crypto')) return 'crypto'
  return 'synthetic'
}

/** Curated digit-friendly symbols preferred for REAL contract UI. */
export function isPreferredDerivSymbol(symbol: string): boolean {
  return (DERIV_PREFERRED_SYMBOLS as readonly string[]).includes(symbol)
}

export function isDerivSymbol(symbol: string, catalog: DerivCatalogEntry[] = FALLBACK): boolean {
  return catalog.some((entry) => entry.symbol === symbol)
}

export function getFallbackDerivCatalog(): DerivCatalogEntry[] {
  return [...FALLBACK]
}

export function mergeActiveSymbols(
  active: Array<{ symbol: string; displayName: string; market: string; submarket?: string; pipSize: number }>,
): DerivCatalogEntry[] {
  const preferred = new Set(DERIV_PREFERRED_SYMBOLS as readonly string[])
  const fromApi = active
    .filter((s) => preferred.has(s.symbol) || s.market === 'synthetic_index')
    .map((s) => ({
      symbol: s.symbol,
      displayName: s.displayName,
      category: categorize(s.market),
      market: s.market,
      ...(s.submarket ? { submarket: s.submarket } : {}),
      pipSize: s.pipSize,
    }))

  if (fromApi.length === 0) return getFallbackDerivCatalog()

  // Ensure preferred digit indices appear first even if API order differs.
  const bySymbol = new Map(fromApi.map((s) => [s.symbol, s]))
  const ordered: DerivCatalogEntry[] = []
  for (const symbol of DERIV_PREFERRED_SYMBOLS) {
    const hit = bySymbol.get(symbol)
    if (hit) {
      ordered.push(hit)
      bySymbol.delete(symbol)
    }
  }
  for (const entry of bySymbol.values()) ordered.push(entry)
  return ordered.length > 0 ? ordered : getFallbackDerivCatalog()
}

/** A market-list quote counts as LIVE only while its Deriv epoch is this recent. */
export const LIST_QUOTE_FRESH_MS = 60_000

/** Per-row status: LIVE needs an open feed and a fresh quote for that symbol; a stale quote is DELAYED. */
export function listPriceStatus(
  feedStatus: ConnectionStatus,
  last: number | undefined,
  epochSec: number | undefined,
  nowMs: number,
): ConnectionStatus {
  if (last == null) return feedStatus === 'live' ? 'connecting' : feedStatus
  if (epochSec == null) return feedStatus
  const fresh = nowMs - epochSec * 1000 <= LIST_QUOTE_FRESH_MS
  if (feedStatus !== 'live') return feedStatus
  return fresh ? 'live' : 'disconnected'
}

export function buildDerivMarketCatalog(
  entries: DerivCatalogEntry[],
  lastPrices: Map<string, number>,
  feedStatus: ConnectionStatus,
  quoteEpochs?: Map<string, number>,
  nowMs = Date.now(),
): Market[] {
  return entries.map((entry) => {
    const last = lastPrices.get(entry.symbol)
    const priceStatus = quoteEpochs
      ? listPriceStatus(feedStatus, last, quoteEpochs.get(entry.symbol), nowMs)
      : last != null && feedStatus === 'live'
        ? 'live'
        : feedStatus
    return {
      symbol: entry.symbol,
      displayName: entry.displayName,
      category: entry.category,
      contractKinds: ['EVEN_ODD', 'MATCH_DIFFER', 'OVER_UNDER'],
      durationsMs: [5_000, 10_000, 15_000, 30_000, 60_000],
      lastPrice: last ?? null,
      priceStatus,
      feedLabel: SIMULATED_FEED_LABEL,
      isSimulated: false,
      ...(entry.submarket ? { submarket: entry.submarket } : {}),
      pipSize: entry.pipSize,
    }
  })
}

export function defaultRealDerivSymbol(): string {
  return 'R_100'
}
