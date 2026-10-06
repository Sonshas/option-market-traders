import { describe, expect, it } from 'vitest'
import { AI_SCANNER_NOTE, pickLabel, rankVolatilities, strongestSetup } from '@/domain/digit-scanner'

/** Digits with exact counts per digit (order does not matter for counting). */
function digitsWith(counts: number[]): number[] {
  return counts.flatMap((count, digit) => Array.from({ length: count }, () => digit))
}

const uniform = digitsWith([10, 10, 10, 10, 10, 10, 10, 10, 10, 10])

describe('AI Bot Scanner: strongest setup per market', () => {
  it('Even/Odd picks the side with the higher count and reports both counts', () => {
    const pick = strongestSetup('R_10', digitsWith([10, 15, 10, 15, 10, 15, 10, 15, 10, 15]), 'EVEN_ODD', 1000)!
    expect(pick.contractOption).toBe('odd')
    expect(pick.hits).toBe(75)
    expect(pick.expected).toBe(63)
    expect(pick.countsLine).toBe('EVEN 50 / ODD 75 in last 125 ticks')
  })

  it('Over/Under chooses barrier and side by deviation, not the trivially high OVER 0 count', () => {
    // Digits 0..4 are rare, 5..9 common: UNDER is weak, OVER 4 stands out most.
    const pick = strongestSetup('R_25', digitsWith([5, 5, 5, 5, 5, 15, 15, 15, 15, 15]), 'OVER_UNDER', 1000)!
    expect(pick.contractOption).toBe('over')
    expect(pick.barrier).toBe(4)
    expect(pick.hits).toBe(75)
    expect(pick.countsLine).toBe('OVER 4: 75 / UNDER 4: 20 / EQUAL 4: 5 in last 100 ticks')
  })

  it('Over/Under omits the impossible side at barrier 0 or 9', () => {
    const pick = strongestSetup('R_25', digitsWith([2, 12, 12, 12, 12, 12, 12, 12, 12, 12]), 'OVER_UNDER', 1000)!
    expect(pickLabel(pick)).toBe('OVER 0')
    expect(pick.countsLine).toBe('OVER 0: 108 / EQUAL 0: 2 in last 110 ticks')
  })

  it('Match/Differ picks MATCH on a hot digit or DIFFER on a cold digit, whichever deviates more', () => {
    const hot = strongestSetup('R_50', digitsWith([10, 10, 10, 10, 10, 10, 10, 30, 10, 10]), 'MATCH_DIFFER', 1000)!
    expect(pickLabel(hot)).toBe('MATCH 7')
    expect(hot.countsLine).toBe('Digit 7 appeared 30 times in last 120 ticks (12 expected)')

    const cold = strongestSetup('R_75', digitsWith([12, 12, 0, 12, 12, 12, 12, 12, 12, 14]), 'MATCH_DIFFER', 1000)!
    expect(pickLabel(cold)).toBe('DIFFER 2')
    expect(cold.selectedDigit).toBe(2)
  })

  it('uses only the latest window and returns null without ticks', () => {
    const digits = [...digitsWith([0, 50, 0, 0, 0, 0, 0, 0, 0, 0]), ...digitsWith([20, 0, 0, 0, 0, 0, 0, 0, 0, 0])]
    const pick = strongestSetup('R_100', digits, 'EVEN_ODD', 20)!
    expect(pick.sampleSize).toBe(20)
    expect(pick.contractOption).toBe('even')
    expect(strongestSetup('R_100', [], 'EVEN_ODD', 100)).toBeNull()
  })
})

describe('AI Bot Scanner: cross-market ranking', () => {
  const markets = [
    { symbol: 'R_10', digits: uniform },
    { symbol: 'R_25', digits: digitsWith([10, 10, 10, 10, 10, 10, 10, 10, 10, 40]) },
    { symbol: 'R_50', digits: [] },
    { symbol: 'R_75', digits: digitsWith([10, 10, 10, 10, 10, 10, 10, 10, 10, 20]) },
  ]

  it('ranks volatilities by deviation from the expected count and drops markets without ticks', () => {
    const ranked = rankVolatilities(markets, 'EVEN_ODD', 1000)
    expect(ranked.map((pick) => pick.symbol)).toEqual(['R_25', 'R_75', 'R_10'])
    expect(ranked[0]!.contractOption).toBe('odd')
    expect(ranked[0]!.countsLine).toBe('EVEN 50 / ODD 80 in last 130 ticks')
  })

  it('keeps input order on ties and ranks per contract type', () => {
    const tied = rankVolatilities(
      [
        { symbol: '1HZ10V', digits: uniform },
        { symbol: 'R_10', digits: uniform },
      ],
      'MATCH_DIFFER',
      1000,
    )
    expect(tied.map((pick) => pick.symbol)).toEqual(['1HZ10V', 'R_10'])
    const match = rankVolatilities(markets, 'MATCH_DIFFER', 1000)
    expect(match[0]!.symbol).toBe('R_25')
    expect(pickLabel(match[0]!)).toBe('MATCH 9')
  })

  it('shows counts only: no percentages, accuracy or win-rate wording', () => {
    const lines = rankVolatilities(markets, 'OVER_UNDER', 1000).map((pick) => pick.countsLine)
    for (const text of [...lines, AI_SCANNER_NOTE]) {
      expect(text).not.toContain('%')
      expect(text).not.toMatch(/accura|win rate|guarantee|confidence/i)
    }
  })
})
