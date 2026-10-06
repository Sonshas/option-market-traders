import { describe, expect, it } from 'vitest'
import { buildMarketSections, isVolatilityIndex, shortMarketName, volatilityRank } from '@/domain/market-sections'
import { computeDigitStats } from '@/domain/digit-stats'
import { parseFavorites, toggleFavoriteIn } from '@/hooks/useMarketFavorites'
import { listPriceStatus } from '@/providers/market-data/deriv-symbols'
import type { Market } from '@/types'

function market(symbol: string, displayName: string, extra: Partial<Market> = {}): Market {
  return {
    symbol,
    displayName,
    category: 'synthetic',
    contractKinds: ['EVEN_ODD'],
    durationsMs: [],
    lastPrice: null,
    priceStatus: 'live',
    feedLabel: 'test',
    isSimulated: false,
    submarket: 'random_index',
    ...extra,
  }
}

// Order as Deriv's active_symbols may return it (not numeric).
const catalog: Market[] = [
  market('1HZ100V', 'Volatility 100 (1s) Index'),
  market('R_100', 'Volatility 100 Index'),
  market('CRASH500', 'Crash 500 Index', { submarket: 'crash_index' }),
  market('1HZ10V', 'Volatility 10 (1s) Index'),
  market('R_75', 'Volatility 75 Index'),
  market('R_10', 'Volatility 10 Index'),
  market('1HZ25V', 'Volatility 25 (1s) Index'),
  market('R_50', 'Volatility 50 Index'),
  market('R_25', 'Volatility 25 Index'),
  market('JD10', 'Jump 10 Index', { submarket: 'jump_index' }),
  market('frxEURUSD', 'EUR/USD', { category: 'forex', submarket: 'major_pairs' }),
]

describe('market sections', () => {
  it('groups volatility indices by Deriv submarket and orders them 10, 25, 50, 75, 100 then 1s', () => {
    const volatility = buildMarketSections(catalog, []).find((s) => s.id === 'volatility')!
    expect(volatility.label).toBe('Volatility indices')
    expect(volatility.items.map((m) => m.symbol)).toEqual([
      'R_10',
      'R_25',
      'R_50',
      'R_75',
      'R_100',
      '1HZ10V',
      '1HZ25V',
      '1HZ100V',
    ])
  })

  it('uses submarket over name: a crash/jump index is never a volatility index', () => {
    expect(isVolatilityIndex({ symbol: 'CRASH500', submarket: 'crash_index' })).toBe(false)
    expect(isVolatilityIndex({ symbol: 'R_100', submarket: 'random_index' })).toBe(true)
    expect(isVolatilityIndex({ symbol: 'R_100' })).toBe(true)
    expect(volatilityRank('R_25')).toEqual([0, 25])
    expect(volatilityRank('1HZ75V')).toEqual([1, 75])
  })

  it('favorites contain only starred markets and are empty by default', () => {
    const sections = buildMarketSections(catalog, [])
    expect(sections[0]).toMatchObject({ id: 'favorites', items: [] })
    expect(sections.map((s) => s.id)).toEqual(['favorites', 'volatility', 'synthetic', 'forex'])
  })

  it('a starred volatility index appears in both Favorites and Volatility indices', () => {
    const sections = buildMarketSections(catalog, ['R_50', 'frxEURUSD'])
    expect(sections[0]!.items.map((m) => m.symbol)).toEqual(['R_50', 'frxEURUSD'])
    expect(sections[1]!.items.some((m) => m.symbol === 'R_50')).toBe(true)
    expect(sections.find((s) => s.id === 'forex')!.items.map((m) => m.symbol)).toEqual(['frxEURUSD'])
  })

  it('keeps other categories as their own sections without duplicates', () => {
    const sections = buildMarketSections(catalog, [])
    const ids = sections.map((s) => s.id)
    expect(new Set(ids).size).toBe(ids.length)
    expect(sections.find((s) => s.id === 'synthetic')!.items.map((m) => m.symbol)).toEqual(['CRASH500', 'JD10'])
  })

  it('search filters every section but always keeps the favorites section', () => {
    const sections = buildMarketSections(catalog, ['R_100'], '25')
    expect(sections.map((s) => s.id)).toEqual(['favorites', 'volatility'])
    expect(sections[0]!.items).toEqual([])
    expect(sections[1]!.items.map((m) => m.symbol)).toEqual(['R_25', '1HZ25V'])
  })

  it('shortens the display name without losing the number', () => {
    expect(shortMarketName('Volatility 100 (1s) Index')).toBe('Volatility 100 (1s)')
    expect(shortMarketName('EUR/USD')).toBe('EUR/USD')
  })
})

describe('market favorites storage', () => {
  it('starts empty and ignores the legacy seeded defaults', () => {
    expect(parseFavorites(null)).toEqual([])
    expect(parseFavorites(JSON.stringify(['R_100', 'R_75', '1HZ100V']))).toEqual([])
    expect(parseFavorites('not json')).toEqual([])
    expect(parseFavorites(JSON.stringify(['R_25', 'R_25', 3, 'R_10']))).toEqual(['R_25', 'R_10'])
  })

  it('toggles a symbol in and out', () => {
    expect(toggleFavoriteIn([], 'R_50')).toEqual(['R_50'])
    expect(toggleFavoriteIn(['R_50', 'R_10'], 'R_50')).toEqual(['R_10'])
  })
})

describe('market list price status', () => {
  const now = 1_791_000_000_000
  it('is LIVE only with an open feed and a fresh quote for that symbol', () => {
    expect(listPriceStatus('live', 85.5, now / 1000 - 5, now)).toBe('live')
    expect(listPriceStatus('live', 85.5, now / 1000 - 600, now)).toBe('disconnected')
    expect(listPriceStatus('live', undefined, undefined, now)).toBe('connecting')
    expect(listPriceStatus('reconnecting', 85.5, now / 1000 - 1, now)).toBe('reconnecting')
  })
})

describe('digit counts (no percentages in the UI)', () => {
  it('reports even/odd and over/under as counts that add up to the sample', () => {
    const stats = computeDigitStats([0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 5, 5], 12, 5)
    expect(stats.evenCount + stats.oddCount).toBe(12)
    expect(stats.evenCount).toBe(5)
    expect(stats.overCount).toBe(4)
    expect(stats.underCount).toBe(5)
    expect(stats.equalCount).toBe(3)
  })
})
