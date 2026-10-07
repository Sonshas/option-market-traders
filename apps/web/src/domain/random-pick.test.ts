import { describe, expect, it } from 'vitest'
import { contractCanWin } from './digit-contracts'
import { settleDigitContract } from './outcome/settle'
import { DEMO_WIN_RATE, demoExitDigit } from './outcome/demo-win-rate'
import { randomDigitPick } from './random-pick'

function seeded(seed: number): () => number {
  let state = seed >>> 0
  return () => {
    state = (state * 1664525 + 1013904223) >>> 0
    return state / 2 ** 32
  }
}

describe('randomDigitPick', () => {
  it('returns null without markets', () => {
    expect(randomDigitPick([])).toBeNull()
  })

  it('covers all six contracts and only winnable targets', () => {
    const random = seeded(7)
    const options = new Set<string>()
    for (let i = 0; i < 5_000; i += 1) {
      const pick = randomDigitPick(['R_10', 'R_50'], random)!
      options.add(pick.contractOption)
      expect(contractCanWin(pick)).toBe(true)
    }
    expect([...options].sort()).toEqual(['differ', 'even', 'match', 'odd', 'over', 'under'])
  })

  it('random picks still win about 95% with DEMO settlement', () => {
    const random = seeded(11)
    const runs = 20_000
    let wins = 0
    for (let i = 0; i < runs; i += 1) {
      const pick = randomDigitPick(['R_100'], random)!
      const digit = demoExitDigit(pick, Math.floor(random() * 10), random)
      if (settleDigitContract({ ...pick, exitPrice: 0, exitDigit: digit }) === 'won') wins += 1
    }
    expect(Math.abs(wins / runs - DEMO_WIN_RATE)).toBeLessThan(0.01)
  })
})
