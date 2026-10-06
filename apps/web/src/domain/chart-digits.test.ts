import { describe, expect, it } from 'vitest'
import { computeDigitStats, digitsFromTicks } from '@/domain/digit-stats'
import { candlesToChart } from '@/domain/chart-data'
import { deriveFeedStatus, mergeHistoryWithLive } from '@/hooks/useMarketData'
import { extractLastDigit, mapDerivCandle, mapDerivOhlc } from '@/providers/market-data/deriv-digits'
import type { Tick } from '@/types'

function tick(price: number, epoch: number, pipSize = 0.01): Tick {
  return {
    symbol: 'R_100',
    price,
    timestamp: epoch * 1000,
    epoch,
    pipSize,
    lastDigit: extractLastDigit(price, pipSize),
    isSimulated: false,
    feedLabel: 'test',
    bid: null,
    ask: null,
  }
}

describe('last digit with Deriv pip size', () => {
  it('keeps trailing zeros of the displayed quote', () => {
    // 661.10 arrives as the JS number 661.1 — the displayed last digit is 0, not 1.
    expect(extractLastDigit(661.1, 0.01)).toBe(0)
    expect(extractLastDigit(661.1, 2)).toBe(0)
    expect(extractLastDigit(661, 0.01)).toBe(0)
    expect(extractLastDigit(1.2, 0.001)).toBe(0)
    expect(extractLastDigit(9876.5, 0.1)).toBe(5)
  })

  it('reads the final displayed digit for common pip sizes', () => {
    expect(extractLastDigit(665.26, 0.01)).toBe(6)
    expect(extractLastDigit(664.93, 2)).toBe(3)
    expect(extractLastDigit(5123.457, 0.001)).toBe(7)
    expect(extractLastDigit(1.08123, 0.00001)).toBe(3)
  })

  it('handles float noise without changing the digit', () => {
    expect(extractLastDigit(0.1 + 0.2, 0.01)).toBe(0)
    expect(extractLastDigit(1234.5699999, 0.01)).toBe(7)
  })
})

describe('digit windows and percentages', () => {
  const ticks = Array.from({ length: 1200 }, (_, i) => tick(600 + i / 100, 1_791_000_000 + i * 2))
  const digits = digitsFromTicks(ticks)

  it('analyses exactly the most recent N ticks for every window', () => {
    for (const window of [25, 50, 100, 500, 1000]) {
      const stats = computeDigitStats(digits, window)
      expect(stats.window).toBe(window)
      expect(stats.sampleSize).toBe(window)
      expect(stats.counts.reduce((a, b) => a + b, 0)).toBe(window)
      expect(stats.lastDigit).toBe(digits[digits.length - 1])
    }
  })

  it('uses the last N ticks, not the first N', () => {
    const custom = [1, 1, 1, 1, 1, 2, 3, 4, 5, 6]
    const stats = computeDigitStats(custom, 5)
    expect(stats.counts[1]).toBe(0)
    expect(stats.counts.slice(2, 7)).toEqual([1, 1, 1, 1, 1])
  })

  it('reports the real available count when fewer ticks exist than requested', () => {
    const stats = computeDigitStats(digits.slice(0, 37), 100)
    expect(stats.window).toBe(100)
    expect(stats.sampleSize).toBe(37)
  })

  it('percentages are count / total × 100 and sum to 100 ± rounding', () => {
    for (const window of [25, 50, 100, 500, 1000]) {
      const stats = computeDigitStats(digits, window)
      const sum = stats.percentages.reduce((a, b) => a + b, 0)
      expect(Math.abs(sum - 100)).toBeLessThanOrEqual(0.05)
      stats.counts.forEach((count, digit) => {
        expect(stats.percentages[digit]).toBeCloseTo((count / stats.sampleSize) * 100, 1)
      })
    }
  })

  it('example: 14 of 200 → 7.0%', () => {
    const sample = [...Array.from({ length: 14 }, () => 0), ...Array.from({ length: 186 }, () => 5)]
    const stats = computeDigitStats(sample, 200)
    expect(stats.counts[0]).toBe(14)
    expect(stats.percentages[0]!.toFixed(1)).toBe('7.0')
  })

  it('returns zeros (never invented values) for an empty sample', () => {
    const stats = computeDigitStats([], 100)
    expect(stats.sampleSize).toBe(0)
    expect(stats.percentages.every((p) => p === 0)).toBe(true)
    expect(stats.lastDigit).toBeNull()
  })
})

describe('Deriv candle mapping', () => {
  it('maps ticks_history candles to ms candles', () => {
    expect(mapDerivCandle({ epoch: 1_791_018_000, open: 667.28, high: 667.58, low: 658.41, close: 665.26 })).toEqual({
      time: 1_791_018_000_000,
      open: 667.28,
      high: 667.58,
      low: 658.41,
      close: 665.26,
    })
    expect(mapDerivCandle({ epoch: 1, open: 'x', high: 1, low: 1, close: 1 })).toBeNull()
  })

  it('maps ohlc stream updates (string prices) by open_time, not tick epoch', () => {
    expect(
      mapDerivOhlc({ open_time: 1_791_020_880, open: '665.26', high: '665.26', low: '664.84', close: '664.86' }),
    ).toEqual({ time: 1_791_020_880_000, open: 665.26, high: 665.26, low: 664.84, close: 664.86 })
  })

  it('converts to whole-second chart points in ascending order', () => {
    const chart = candlesToChart([
      { time: 120_000, open: 2, high: 3, low: 1, close: 2 },
      { time: 60_000, open: 1, high: 2, low: 1, close: 2 },
    ])
    expect(chart.map((c) => c.time)).toEqual([60, 120])
  })

  it('merges live OHLC with history without duplicating the forming candle', () => {
    const history = [
      { time: 60_000, open: 1, high: 2, low: 1, close: 2 },
      { time: 120_000, open: 2, high: 2, low: 2, close: 2 },
    ]
    const live = [
      { time: 120_000, open: 2, high: 3, low: 2, close: 3 },
      { time: 180_000, open: 3, high: 3, low: 3, close: 3 },
    ]
    expect(mergeHistoryWithLive(history, live)).toEqual([history[0], live[0], live[1]])
    expect(mergeHistoryWithLive(history, [])).toEqual(history)
  })
})

describe('feed status', () => {
  const base = { staleMs: 10_000, watchingSince: 0 }
  it('is CONNECTED only with an open socket and a fresh tick', () => {
    expect(deriveFeedStatus({ ...base, socketStatus: 'live', lastTickReceivedAt: 95_000, now: 100_000 })).toBe('live')
    expect(deriveFeedStatus({ ...base, socketStatus: 'live', lastTickReceivedAt: 80_000, now: 100_000 })).toBe(
      'disconnected',
    )
    expect(deriveFeedStatus({ ...base, socketStatus: 'reconnecting', lastTickReceivedAt: 99_000, now: 100_000 })).toBe(
      'disconnected',
    )
  })

  it('is CONNECTING while the first tick for a newly selected symbol is awaited', () => {
    expect(
      deriveFeedStatus({ staleMs: 10_000, socketStatus: 'live', lastTickReceivedAt: 0, watchingSince: 98_000, now: 100_000 }),
    ).toBe('connecting')
    expect(deriveFeedStatus({ ...base, socketStatus: 'connecting', lastTickReceivedAt: 0, now: 100_000 })).toBe(
      'connecting',
    )
  })
})
