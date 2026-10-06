import { describe, expect, it } from 'vitest'
import {
  TICK_DURATION_DEFAULT,
  TICK_DURATION_MAX,
  TICK_DURATION_MIN,
  estimatedTickExpiryMs,
  isValidTickDuration,
  nominalTickIntervalMs,
  selectNthTickAfter,
  tickAnchorMs,
  validateRealTradeRequest,
} from '@/domain/digit-contracts'

const t = (epochMs: number, price = 100.01) => ({ epochMs, price })

describe('tick durations', () => {
  it('allows whole ticks 1–10 only', () => {
    expect([TICK_DURATION_MIN, TICK_DURATION_DEFAULT, TICK_DURATION_MAX]).toEqual([1, 5, 10])
    for (let n = 1; n <= 10; n += 1) expect(isValidTickDuration(n)).toBe(true)
    for (const bad of [0, 11, 2.5, -1, Number.NaN, '5', null]) expect(isValidTickDuration(bad)).toBe(false)
  })

  it('knows the Deriv cadence per symbol family', () => {
    expect(nominalTickIntervalMs('1HZ100V')).toBe(1000)
    expect(nominalTickIntervalMs('R_50')).toBe(2000)
    expect(nominalTickIntervalMs('BTCUSDT')).toBeNull()
    expect(estimatedTickExpiryMs(10_000, 5, '1HZ10V')).toBe(15_000)
    expect(estimatedTickExpiryMs(10_000, 5, 'R_10')).toBe(20_000)
  })

  it('anchors on the later of the entry tick and the placement second', () => {
    expect(tickAnchorMs(10_000, 9_400)).toBe(10_000)
    expect(tickAnchorMs(10_000, 12_750)).toBe(12_000)
  })

  it('selects the Nth distinct tick strictly after the anchor', () => {
    const ticks = [t(9_000), t(10_000), t(11_000, 1.1), t(11_000, 9.9), t(13_000, 1.3), t(12_000, 1.2)]
    const first = selectNthTickAfter(ticks, 10_000, 1)
    expect(first?.exit.price).toBe(1.1)
    const third = selectNthTickAfter(ticks, 10_000, 3)
    expect(third?.exit.price).toBe(1.3)
    expect(third?.epochsMs).toEqual([11_000, 12_000, 13_000])
    expect(selectNthTickAfter(ticks, 10_000, 4)).toBeNull()
    expect(selectNthTickAfter(ticks, 10_000, 0)).toBeNull()
  })
})

describe('validateRealTradeRequest durations', () => {
  const base = {
    account_mode: 'REAL',
    symbol: 'R_100',
    contract_type: 'EVEN_ODD',
    contract_option: 'even',
    stake: 1,
    idempotency_key: 'abcdefgh-1234',
  }

  it('accepts duration_ticks 1–10 and ignores legacy duration then', () => {
    const parsed = validateRealTradeRequest({ ...base, duration_ticks: 5 })
    expect(parsed.ok).toBe(true)
    if (parsed.ok) {
      expect(parsed.value.durationTicks).toBe(5)
      expect(parsed.value.durationMs).toBeNull()
    }
  })

  it('rejects out-of-range or fractional ticks', () => {
    for (const bad of [0, 11, 2.5]) {
      const parsed = validateRealTradeRequest({ ...base, duration_ticks: bad })
      expect(parsed.ok).toBe(false)
      if (!parsed.ok) expect(parsed.error).toMatch(/1–10 ticks/)
    }
  })

  it('keeps the legacy seconds format working for old tabs', () => {
    const parsed = validateRealTradeRequest({ ...base, duration: 15_000 })
    expect(parsed.ok).toBe(true)
    if (parsed.ok) {
      expect(parsed.value.durationMs).toBe(15_000)
      expect(parsed.value.durationTicks).toBeNull()
    }
    expect(validateRealTradeRequest({ ...base, duration: 1234 }).ok).toBe(false)
  })
})
