import type { Market } from '@/types'

export type MarketSectionId = 'favorites' | 'volatility' | 'synthetic' | 'forex' | 'crypto'

export type MarketSection = {
  id: MarketSectionId
  label: string
  items: Market[]
}

/** Deriv `active_symbols.submarket` for the Volatility 10–100 indices and their 1s variants. */
export const VOLATILITY_SUBMARKET = 'random_index'

const CATEGORY_SECTIONS: Array<{ id: Exclude<MarketSectionId, 'favorites' | 'volatility'>; label: string }> = [
  { id: 'synthetic', label: 'Other synthetic indices' },
  { id: 'forex', label: 'Forex' },
  { id: 'crypto', label: 'Crypto' },
]

/** Deriv's own grouping first; the symbol pattern is only a fallback when no submarket is provided. */
export function isVolatilityIndex(market: Pick<Market, 'symbol' | 'submarket'>): boolean {
  if (market.submarket) return market.submarket === VOLATILITY_SUBMARKET
  return /^(R_\d+|1HZ\d+V)$/.test(market.symbol)
}

/** Sort key: standard indices by number (10, 25, 50, 75, 100), then 1s variants by number. */
export function volatilityRank(symbol: string): [number, number] {
  const standard = /^R_(\d+)$/.exec(symbol)
  if (standard) return [0, Number(standard[1])]
  const oneSecond = /^1HZ(\d+)V$/.exec(symbol)
  if (oneSecond) return [1, Number(oneSecond[1])]
  return [2, Number.MAX_SAFE_INTEGER]
}

function byVolatilityRank(a: Market, b: Market): number {
  const [ga, na] = volatilityRank(a.symbol)
  const [gb, nb] = volatilityRank(b.symbol)
  return ga - gb || na - nb || a.displayName.localeCompare(b.displayName)
}

export function matchesMarketQuery(market: Market, query: string): boolean {
  const needle = query.trim().toLowerCase()
  if (!needle) return true
  return market.displayName.toLowerCase().includes(needle) || market.symbol.toLowerCase().includes(needle)
}

/**
 * Favorites (only what the user starred, in starred order) first, then Volatility indices, then
 * the remaining categories. A starred market also stays in its own section. Empty non-favorite
 * sections are omitted; the favorites section is always returned so it can show its empty state.
 */
export function buildMarketSections(markets: Market[], favorites: string[], query = ''): MarketSection[] {
  const visible = markets.filter((market) => matchesMarketQuery(market, query))
  const bySymbol = new Map(visible.map((market) => [market.symbol, market]))
  const favoriteItems = favorites
    .map((symbol) => bySymbol.get(symbol))
    .filter((market): market is Market => market != null)

  const volatility = visible.filter(isVolatilityIndex).sort(byVolatilityRank)
  const rest = visible.filter((market) => !isVolatilityIndex(market))

  const sections: MarketSection[] = [
    { id: 'favorites', label: 'Favorites', items: favoriteItems },
    { id: 'volatility', label: 'Volatility indices', items: volatility },
  ]
  for (const category of CATEGORY_SECTIONS) {
    sections.push({ ...category, items: rest.filter((market) => market.category === category.id) })
  }
  return sections.filter((section) => section.id === 'favorites' || section.items.length > 0)
}

/** Display label without the redundant " Index" suffix (full name stays in the tooltip). */
export function shortMarketName(displayName: string): string {
  return displayName.replace(/\s+Index$/i, '')
}
