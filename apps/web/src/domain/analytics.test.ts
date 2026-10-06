import { beforeEach, describe, expect, it } from 'vitest'
import { computeDigitStats, currentParityStreak, digitOfTick, digitsFromTicks } from '@/domain/digit-stats'
import {
  balanceSeriesFromLedger,
  candlesToChart,
  cumulativePnlSeries,
  summarizeTrades,
  ticksToChartLine,
  toChartLine,
} from '@/domain/chart-data'
import { botProgress, decideBotContract, evaluateBotStop } from '@/domain/bot-strategies'
import { distinctSymbols, filterTrades, tradesToCsv } from '@/domain/trade-filters'
import {
  clearTickBufferForTests,
  firstTickAtOrAfter,
  getBufferedTicks,
  getLastReceivedAt,
  mergeTicks,
  recordTicks,
} from '@/providers/market-data/tick-buffer'
import { formatQuote, pipDecimals } from '@/lib/format'
import type { Tick, Trade, WalletLedger } from '@/types'

function tick(price: number, timestamp: number, pipSize = 0.01, extra: Partial<Tick> = {}): Tick {
  return { symbol: 'R_100', price, timestamp, pipSize, isSimulated: false, feedLabel: 'test', ...extra }
}

function trade(partial: Partial<Trade>): Trade {
  const stamp = '2026-10-02T10:00:00.000Z'
  return {
    id: partial.id ?? Math.random().toString(36).slice(2),
    userId: 'u',
    accountId: 'a',
    accountMode: 'demo',
    walletId: 'w',
    walletKind: 'demo',
    symbol: 'R_100',
    market: 'R_100',
    contractType: 'EVEN_ODD',
    contractOption: 'even',
    selectedDigit: null,
    barrier: null,
    stake: 10,
    durationMs: 15_000,
    duration: 15_000,
    payoutRate: 0.85,
    status: 'won',
    result: 'won',
    entryPrice: 100,
    exitPrice: 101,
    payout: 18.5,
    profitLoss: 8.5,
    expiresAt: stamp,
    resolvedAt: stamp,
    isSimulated: true,
    createdAt: stamp,
    updatedAt: stamp,
    ...partial,
  }
}

describe('digit statistics', () => {
  it('derives digits from pip size, keeping trailing zeros', () => {
    expect(digitOfTick(tick(1234.5, 1, 0.01))).toBe(0)
    expect(digitOfTick(tick(8912.3456, 1, 0.0001))).toBe(6)
    expect(digitOfTick(tick(1.2, 1, 0.01, { lastDigit: 7 }))).toBe(7)
    expect(digitsFromTicks([tick(1.23, 1), tick(9.99, 2, 0.01, { isSimulated: true })])).toEqual([3])
  })

  it('computes distribution, parity and barrier ratios over the window', () => {
    const digits = [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 9, 9]
    const stats = computeDigitStats(digits, 10, 5)
    expect(stats.sampleSize).toBe(10)
    expect(stats.counts).toEqual([0, 0, 1, 1, 1, 1, 1, 1, 1, 3])
    expect(stats.percentages[9]).toBe(30)
    expect(stats.evenPct).toBe(40)
    expect(stats.oddPct).toBe(60)
    expect(stats.overPct).toBe(60)
    expect(stats.underPct).toBe(30)
    expect(stats.equalPct).toBe(10)
    expect(stats.lastDigit).toBe(9)
    expect(stats.mostFrequent).toBe(9)
    expect(stats.leastFrequent).toBe(0)
  })

  it('returns an empty sample without inventing values', () => {
    const stats = computeDigitStats([], 100)
    expect(stats.sampleSize).toBe(0)
    expect(stats.lastDigit).toBeNull()
    expect(stats.mostFrequent).toBeNull()
    expect(stats.percentages.every((value) => value === 0)).toBe(true)
  })

  it('measures the current parity streak', () => {
    expect(currentParityStreak([1, 2, 4, 6])).toEqual({ parity: 'even', length: 3 })
    expect(currentParityStreak([])).toEqual({ parity: null, length: 0 })
  })
})

describe('chart data transforms', () => {
  it('converts ticks to ascending unique seconds', () => {
    const line = ticksToChartLine([tick(3, 3_500), tick(1, 1_000), tick(2, 1_900), tick(9, 2_000, 0.01, { isSimulated: true })])
    expect(line).toEqual([
      { time: 1, value: 2 },
      { time: 3, value: 3 },
    ])
  })

  it('dedupes candles per second and sorts them', () => {
    const out = candlesToChart([
      { time: 120_000, open: 2, high: 3, low: 1, close: 2 },
      { time: 60_000, open: 1, high: 2, low: 0.5, close: 1.5 },
    ])
    expect(out.map((c) => c.time)).toEqual([60, 120])
  })

  it('builds a balance series from ledger rows', () => {
    const ledger = [
      { createdAt: '2026-10-02T10:00:10.000Z', balanceAfter: 9990 },
      { createdAt: '2026-10-02T10:00:30.000Z', balanceAfter: 10008.5 },
    ] as WalletLedger[]
    const series = balanceSeriesFromLedger(ledger, 10_000)
    expect(series.map((p) => p.value)).toEqual([10_000, 9990, 10008.5])
    expect(toChartLine(series)).toHaveLength(3)
  })

  it('accumulates realized P/L from settled trades only', () => {
    const trades = [
      trade({ resolvedAt: '2026-10-02T10:00:02.000Z', profitLoss: -10, status: 'lost' }),
      trade({ resolvedAt: '2026-10-02T10:00:01.000Z', profitLoss: 8.5, status: 'won' }),
      trade({ status: 'open', profitLoss: null }),
    ]
    expect(cumulativePnlSeries(trades).map((p) => p.value)).toEqual([8.5, -1.5])
    const summary = summarizeTrades(trades)
    expect(summary).toMatchObject({ total: 2, wins: 1, losses: 1, winRate: 50, netPnl: -1.5, totalStaked: 20 })
    expect(summarizeTrades([]).winRate).toBeNull()
  })
})

describe('tick buffer', () => {
  beforeEach(() => clearTickBufferForTests())

  it('merges, sorts and caps genuine ticks', () => {
    const merged = mergeTicks([tick(1, 1000)], [tick(3, 3000), tick(2, 2000), tick(9, 2500, 0.01, { isSimulated: true })], 2)
    expect(merged.map((t) => t.price)).toEqual([2, 3])
  })

  it('finds the first tick at or after a time', () => {
    recordTicks('R_100', [tick(1, 1000), tick(2, 2000), tick(3, 3000)], 50)
    expect(firstTickAtOrAfter('R_100', 1500)?.price).toBe(2)
    expect(firstTickAtOrAfter('R_100', 2000)?.price).toBe(2)
    expect(firstTickAtOrAfter('R_100', 3001)).toBeNull()
    expect(getBufferedTicks('R_100')).toHaveLength(3)
    expect(getLastReceivedAt('R_100')).toBe(50)
    recordTicks('R_100', [tick(0.5, 500)], 99)
    expect(getLastReceivedAt('R_100')).toBe(50)
  })
})

describe('DEMO bot strategies', () => {
  it('waits for enough live digits', () => {
    expect(decideBotContract('parity-filter', [1, 2, 3])).toBeNull()
  })

  it('applies each documented rule', () => {
    const digits = [1, 3, 5, 7, 2, 4]
    expect(decideBotContract('parity-filter', digits)?.contractOption).toBe('even')
    expect(decideBotContract('digit-gate', digits)).toMatchObject({ contractType: 'MATCH_DIFFER', contractOption: 'differ', selectedDigit: 4 })
    expect(decideBotContract('pulse-window', digits)?.contractOption).toBe('even')
    expect(decideBotContract('range-anchor', [9, 9, 9, 9, 9])).toMatchObject({ contractOption: 'under', barrier: 7 })
    expect(decideBotContract('range-anchor', [0, 0, 0, 0, 0])).toMatchObject({ contractOption: 'over', barrier: 2 })
    expect(decideBotContract('drift-watch', digits)).toMatchObject({ contractOption: 'under', barrier: 6 })
    expect(decideBotContract('breakout-rail', digits)).toMatchObject({ contractOption: 'over', barrier: 3 })
    expect(decideBotContract('unknown', digits)).toBeNull()
  })

  it('tracks progress and stops on limits', () => {
    const trades = [
      trade({ status: 'won', profitLoss: 8.5, resolvedAt: '2026-10-02T10:00:01.000Z' }),
      trade({ status: 'lost', profitLoss: -10, resolvedAt: '2026-10-02T10:00:02.000Z' }),
      trade({ status: 'lost', profitLoss: -10, resolvedAt: '2026-10-02T10:00:03.000Z' }),
    ]
    const progress = botProgress(trades)
    expect(progress).toMatchObject({ tradesPlaced: 3, openTrades: 0, wins: 1, losses: 2, realizedPnl: -11.5, lossStreak: 2 })
    const limits = { maxRuns: 10, takeProfit: null, stopLoss: null, lossStreakLimit: 3 }
    expect(evaluateBotStop(progress, limits)).toBeNull()
    expect(evaluateBotStop(progress, { ...limits, lossStreakLimit: 2 })).toMatch(/Loss streak/)
    expect(evaluateBotStop(progress, { ...limits, stopLoss: 10 })).toMatch(/Stop loss/)
    expect(evaluateBotStop({ ...progress, realizedPnl: 5 }, { ...limits, takeProfit: 5 })).toMatch(/Take profit/)
    expect(evaluateBotStop(progress, { ...limits, maxRuns: 3 })).toMatch(/Max runs/)
  })
})

describe('trade filters and export', () => {
  const trades = [
    trade({ id: 'a', status: 'won', symbol: 'R_100' }),
    trade({ id: 'b', status: 'lost', symbol: 'R_50', contractType: 'OVER_UNDER', contractOption: 'over', barrier: 5 }),
  ]

  it('filters by outcome, contract and market', () => {
    expect(filterTrades(trades, { outcome: 'won', contractType: 'all', symbol: 'all' }).map((t) => t.id)).toEqual(['a'])
    expect(filterTrades(trades, { outcome: 'all', contractType: 'OVER_UNDER', symbol: 'all' }).map((t) => t.id)).toEqual(['b'])
    expect(filterTrades(trades, { outcome: 'all', contractType: 'all', symbol: 'R_100' }).map((t) => t.id)).toEqual(['a'])
    expect(distinctSymbols(trades)).toEqual(['R_100', 'R_50'])
  })

  it('exports CSV with a header row', () => {
    const csv = tradesToCsv(trades).split('\n')
    expect(csv[0]).toMatch(/^id,account_mode,symbol/)
    expect(csv).toHaveLength(3)
  })
})

describe('quote formatting', () => {
  it('keeps provider precision so the shown last digit matches', () => {
    expect(pipDecimals(0.01)).toBe(2)
    expect(pipDecimals(0.0001)).toBe(4)
    expect(pipDecimals(3)).toBe(3)
    expect(formatQuote(1234.5, 0.01)).toBe('1,234.50')
    expect(formatQuote(null, 0.01)).toBe('Unavailable')
  })
})
