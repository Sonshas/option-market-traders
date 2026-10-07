import { describe, expect, it } from 'vitest'
import webSource from './admin-panel.ts?raw'
import denoSource from '../../../../supabase/functions/_shared/admin-panel.ts?raw'
import {
  effectiveWinRate,
  parseWinRate,
  periodSeries,
  startOfLocalDay,
  startOfLocalMonth,
  startOfLocalWeek,
  summarizePeriods,
  usdToKesAt,
} from '@/domain/admin-panel'

// Wednesday 7 Oct 2026, 15:57 Nairobi (12:57 UTC).
const NOW = Date.parse('2026-10-07T12:57:00.000Z')

describe('shared module', () => {
  it('web and edge copies are byte-identical', () => {
    expect(denoSource).toBe(webSource)
  })
})

describe('Nairobi calendar periods', () => {
  it('starts the day at local midnight (21:00 UTC the day before)', () => {
    expect(new Date(startOfLocalDay(NOW)).toISOString()).toBe('2026-10-06T21:00:00.000Z')
    expect(new Date(startOfLocalDay(Date.parse('2026-10-07T21:30:00.000Z'))).toISOString()).toBe('2026-10-07T21:00:00.000Z')
  })

  it('starts the week on Monday and the month on the 1st', () => {
    expect(new Date(startOfLocalWeek(NOW)).toISOString()).toBe('2026-10-04T21:00:00.000Z')
    expect(new Date(startOfLocalMonth(NOW)).toISOString()).toBe('2026-09-30T21:00:00.000Z')
    expect(new Date(startOfLocalMonth(NOW, 180, -1)).toISOString()).toBe('2026-08-31T21:00:00.000Z')
  })
})

describe('summarizePeriods', () => {
  it('returns zeros for no rows', () => {
    const empty = summarizePeriods([], NOW)
    expect(empty).toEqual({
      total: { count: 0, usd: 0 },
      today: { count: 0, usd: 0 },
      week: { count: 0, usd: 0 },
      month: { count: 0, usd: 0 },
    })
  })

  it('buckets by local day, week and month', () => {
    const rows = [
      { at: '2026-10-07T08:00:00.000Z', usd: 10 }, // today
      { at: '2026-10-06T22:00:00.000Z', usd: 5.5 }, // today (01:00 local)
      { at: '2026-10-06T20:00:00.000Z', usd: 3 }, // yesterday 23:00 local, this week
      { at: '2026-10-02T10:00:00.000Z', usd: 2 }, // last week, this month
      { at: '2026-09-15T10:00:00.000Z', usd: 100 }, // last month
      { at: 'not a date', usd: 999 },
      { at: '2026-10-07T09:00:00.000Z', usd: null }, // counted with $0
    ]
    const s = summarizePeriods(rows, NOW)
    expect(s.total).toEqual({ count: 6, usd: 120.5 })
    expect(s.today).toEqual({ count: 3, usd: 15.5 })
    expect(s.week).toEqual({ count: 4, usd: 18.5 })
    expect(s.month).toEqual({ count: 5, usd: 20.5 })
  })
})

describe('periodSeries', () => {
  it('builds oldest-first buckets ending with the current period', () => {
    const series = periodSeries([{ at: '2026-10-07T08:00:00.000Z', usd: 4 }, { at: '2026-09-15T10:00:00.000Z', usd: 6 }], NOW, {
      days: 3,
      weeks: 2,
      months: 2,
    })
    expect(series.daily.map((p) => p.label)).toEqual(['10-05', '10-06', '10-07'])
    expect(series.daily.at(-1)).toMatchObject({ count: 1, usd: 4 })
    expect(series.weekly).toHaveLength(2)
    expect(series.weekly.at(-1)).toMatchObject({ label: 'Wk 10-05', count: 1 })
    expect(series.monthly.map((p) => [p.label, p.usd])).toEqual([
      ['2026-09', 6],
      ['2026-10', 4],
    ])
  })
})

describe('conversions and win rates', () => {
  it('converts USD to KES at the given rate', () => {
    expect(usdToKesAt(10, 130)).toBe(1300)
    expect(usdToKesAt(1.234, 129.5)).toBe(159.8)
    expect(usdToKesAt(10, null)).toBeNull()
    expect(usdToKesAt(10, 0)).toBeNull()
  })

  it('parses win rates strictly in 0..1', () => {
    expect(parseWinRate('0.95')).toBe(0.95)
    expect(parseWinRate(0)).toBe(0)
    expect(parseWinRate(1)).toBe(1)
    expect(parseWinRate(1.01)).toBeNull()
    expect(parseWinRate(null)).toBeNull()
  })

  it('resolves override before global before fallback', () => {
    expect(effectiveWinRate(0.3, 0.8, 0.95)).toBe(0.3)
    expect(effectiveWinRate(null, 0.8, 0.95)).toBe(0.8)
    expect(effectiveWinRate(null, null, 0.95)).toBe(0.95)
  })
})
