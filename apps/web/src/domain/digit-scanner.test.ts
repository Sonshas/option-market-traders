import { describe, expect, it } from 'vitest'
import { AI_SCANNER_NOTE, pickLabel, rankVolatilities, scanDigits, strongestSetup } from '@/domain/digit-scanner'

/** Digits with exact counts per digit (order does not matter for counting). */
function digitsWith(counts: number[]): number[] {
  return counts.flatMap((count, digit) => Array.from({ length: count }, () => digit))
}

const uniform = digitsWith([10, 10, 10, 10, 10, 10, 10, 10, 10, 10])

describe('scanDigits settlement stats', () => {
  it('counts settlement wins (0–8) and losses (9)', () => {
    const scan = scanDigits([0, 1, 2, 9, 9, 8], 100, 5)
    expect(scan.settlementWinCount).toBe(4)
    expect(scan.settlementLossCount).toBe(2)
  })
})

describe('AI Bot Scanner: strongest setup per market', () => {
  it('uses natural EVEN/ODD hit counts for ranking', () => {
    const digits = digitsWith([10, 15, 10, 15, 10, 15, 10, 15, 10, 15])
    const pick = strongestSetup('R_10', digits, 'EVEN_ODD', 1000)!
    expect(pick.hits).toBe(75)
    expect(pick.expected).toBe(63)
    expect(pick.contractOption).toBe('odd')
  })

  it('ranks Over/Under candidates by natural deviation; first candidate wins ties', () => {
    const pick = strongestSetup('R_25', digitsWith([5, 5, 5, 5, 5, 15, 15, 15, 15, 15]), 'OVER_UNDER', 1000)!
    expect(pick.contractOption).toBe('over')
    expect(pick.barrier).toBe(4)
    expect(pick.hits).toBe(75)
    expect(pick.expected).toBe(50)
  })

  it('Match/Differ uses natural digit hits; elevated digit wins MATCH', () => {
    const pick = strongestSetup('R_50', digitsWith([10, 10, 10, 10, 10, 10, 10, 30, 10, 10]), 'MATCH_DIFFER', 1000)!
    expect(pickLabel(pick)).toBe('MATCH 7')
    expect(pick.hits).toBe(30)
  })

  it('uses only the latest window and returns null without ticks', () => {
    const digits = [...digitsWith([0, 50, 0, 0, 0, 0, 0, 0, 0, 0]), ...digitsWith([20, 0, 0, 0, 0, 0, 0, 0, 0, 0])]
    const pick = strongestSetup('R_100', digits, 'EVEN_ODD', 20)!
    expect(pick.sampleSize).toBe(20)
    expect(pick.hits).toBe(20)
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

  it('ranks volatilities by natural contract deviation and drops markets without ticks', () => {
    const ranked = rankVolatilities(markets, 'EVEN_ODD', 1000)
    expect(ranked.map((pick) => pick.symbol)).toEqual(['R_25', 'R_75', 'R_10'])
    expect(ranked[0]!.contractOption).toBe('odd')
    expect(ranked[0]!.hits).toBe(80)
    expect(ranked[0]!.expected).toBe(65)
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

  it('scanner note avoids promises and internal settlement wording', () => {
    expect(AI_SCANNER_NOTE).toMatch(/Past ticks do not predict/)
    expect(AI_SCANNER_NOTE).not.toMatch(/0–8|90%|guarantee|confidence/i)
  })
})
