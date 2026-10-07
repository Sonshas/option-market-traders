import { describe, expect, it } from 'vitest'
import { settleDigitContract } from './settle'
import { DEMO_WIN_RATE, demoExitDigit, priceWithLastDigit, resolveWinRate } from './demo-win-rate'
import { calculateTradeResult, contractKindOf, extractLastDigit, selectionTarget } from '@/domain/digit-contracts'
import { randomDigitPick } from '@/domain/random-pick'

function seeded(seed: number): () => number {
  let state = seed >>> 0
  return () => {
    state = (state * 1664525 + 1013904223) >>> 0
    return state / 2 ** 32
  }
}

describe('demoExitDigit', () => {
  it.each([
    { contractType: 'EVEN_ODD', contractOption: 'even', selectedDigit: null, barrier: null },
    { contractType: 'MATCH_DIFFER', contractOption: 'match', selectedDigit: 7, barrier: null },
    { contractType: 'MATCH_DIFFER', contractOption: 'differ', selectedDigit: 3, barrier: null },
    { contractType: 'OVER_UNDER', contractOption: 'over', selectedDigit: null, barrier: 7 },
    { contractType: 'OVER_UNDER', contractOption: 'under', selectedDigit: null, barrier: 2 },
  ])('wins about 95% of $contractOption trades', (contract) => {
    const random = seeded(42)
    const runs = 20_000
    let wins = 0
    for (let i = 0; i < runs; i += 1) {
      const natural = Math.floor(random() * 10)
      const digit = demoExitDigit(contract, natural, random)
      if (settleDigitContract({ ...contract, exitPrice: 0, exitDigit: digit }) === 'won') wins += 1
    }
    expect(Math.abs(wins / runs - DEMO_WIN_RATE)).toBeLessThan(0.01)
  })

  it('keeps the natural digit for contracts that cannot win', () => {
    const contract = { contractType: 'OVER_UNDER', contractOption: 'over', selectedDigit: null, barrier: 9 }
    expect(demoExitDigit(contract, 4, () => 0)).toBe(4)
  })

  it.each([0, 0.25, 0.5, 0.8, 1])('follows a configured win rate of %s', (rate) => {
    const contract = { contractType: 'MATCH_DIFFER', contractOption: 'match', selectedDigit: 5, barrier: null }
    const random = seeded(7)
    const runs = 20_000
    let wins = 0
    for (let i = 0; i < runs; i += 1) {
      const digit = demoExitDigit(contract, Math.floor(random() * 10), random, rate)
      if (settleDigitContract({ ...contract, exitPrice: 0, exitDigit: digit }) === 'won') wins += 1
    }
    if (rate === 0) expect(wins).toBe(0)
    else if (rate === 1) expect(wins).toBe(runs)
    else expect(Math.abs(wins / runs - rate)).toBeLessThan(0.01)
  })

  it('treats an invalid rate as the default and clamps out-of-range rates', () => {
    const contract = { contractType: 'EVEN_ODD', contractOption: 'even', selectedDigit: null, barrier: null }
    expect(demoExitDigit(contract, 3, () => 0.99, 5) % 2).toBe(0)
    expect(demoExitDigit(contract, 4, () => 0, -1) % 2).toBe(1)
    expect(demoExitDigit(contract, 4, () => 0.5, Number.NaN) % 2).toBe(0)
  })
})

describe('resolveWinRate', () => {
  it('prefers the per-user override, then the global rate, then DEMO_WIN_RATE', () => {
    expect(resolveWinRate(0.4, 0.7)).toBe(0.4)
    expect(resolveWinRate(0, 0.7)).toBe(0)
    expect(resolveWinRate(null, 0.7)).toBe(0.7)
    expect(resolveWinRate(undefined, '0.6')).toBe(0.6)
    expect(resolveWinRate(null, null)).toBe(DEMO_WIN_RATE)
  })

  it('ignores out-of-range values instead of clamping them', () => {
    expect(resolveWinRate(1.5, 0.7)).toBe(0.7)
    expect(resolveWinRate(-0.1, null)).toBe(DEMO_WIN_RATE)
    expect(resolveWinRate('abc', 2)).toBe(DEMO_WIN_RATE)
  })
})

describe('DEMO exit: digit, price and result always agree', () => {
  it.each([0.01, 0.001, 2, 3])('for random picks on pip size %s', (pipSize) => {
    const random = seeded(99)
    for (let i = 0; i < 3_000; i += 1) {
      const pick = randomDigitPick(['R_100'], random)!
      const naturalPrice = Number((1000 + random() * 9000).toFixed(4))
      const natural = extractLastDigit(naturalPrice, pipSize)!
      const digit = demoExitDigit(pick, natural, random)
      const price = digit === natural ? naturalPrice : priceWithLastDigit(naturalPrice, pipSize, digit)
      expect(extractLastDigit(price, pipSize)).toBe(digit)
      const status = settleDigitContract({ ...pick, exitPrice: price, exitDigit: digit })
      const expected = calculateTradeResult(contractKindOf(pick.contractOption), selectionTarget(pick), digit)
      expect(status).toBe(expected === 'WIN' ? 'won' : 'lost')
    }
  })
})

describe('priceWithLastDigit', () => {
  it('replaces only the final pip digit', () => {
    expect(priceWithLastDigit(1234.56, 0.01, 3)).toBe(1234.53)
    expect(priceWithLastDigit(1234.56, 2, 9)).toBe(1234.59)
    expect(priceWithLastDigit(987.1234, 0.0001, 0)).toBe(987.123)
  })
})
