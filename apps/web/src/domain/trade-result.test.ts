import { describe, expect, it } from 'vitest'
import settleMigration from '../../../../supabase/migrations/20261003200000_real_trading_tick_duration.sql?raw'
import {
  DIGIT_CONTRACT_KINDS,
  calculateTradeResult,
  contractKindOf,
  selectionForKind,
  settleDigitContract,
  type DigitContractKind,
} from '@/domain/digit-contracts'

const USER_CASES: Array<[DigitContractKind, number | null, number, 'WIN' | 'LOSS']> = [
  ['EVEN', null, 0, 'WIN'],
  ['EVEN', null, 2, 'WIN'],
  ['EVEN', null, 8, 'WIN'],
  ['EVEN', null, 1, 'LOSS'],
  ['EVEN', null, 9, 'LOSS'],
  ['ODD', null, 1, 'WIN'],
  ['ODD', null, 7, 'WIN'],
  ['ODD', null, 9, 'WIN'],
  ['ODD', null, 0, 'LOSS'],
  ['ODD', null, 8, 'LOSS'],
  ['MATCH', 7, 7, 'WIN'],
  ['MATCH', 7, 6, 'LOSS'],
  ['MATCH', 7, 8, 'LOSS'],
  ['DIFFER', 7, 7, 'LOSS'],
  ['DIFFER', 7, 6, 'WIN'],
  ['DIFFER', 7, 8, 'WIN'],
  ['OVER', 5, 6, 'WIN'],
  ['OVER', 5, 9, 'WIN'],
  ['OVER', 5, 5, 'LOSS'],
  ['OVER', 5, 4, 'LOSS'],
  ['UNDER', 5, 4, 'WIN'],
  ['UNDER', 5, 0, 'WIN'],
  ['UNDER', 5, 5, 'LOSS'],
  ['UNDER', 5, 6, 'LOSS'],
]

/** Independent restatement of the contract rules, used only to cross-check the engine. */
function expected(kind: DigitContractKind, target: number, digit: number): 'WIN' | 'LOSS' {
  const win = {
    EVEN: [0, 2, 4, 6, 8].includes(digit),
    ODD: [1, 3, 5, 7, 9].includes(digit),
    MATCH: digit === target,
    DIFFER: digit !== target,
    OVER: digit > target,
    UNDER: digit < target,
  }[kind]
  return win ? 'WIN' : 'LOSS'
}

describe('calculateTradeResult', () => {
  it.each(USER_CASES)('%s %s with final digit %i → %s', (kind, target, digit, result) => {
    expect(calculateTradeResult(kind, target, digit)).toBe(result)
  })

  it('matches the contract rules for every contract, target and final digit 0–9', () => {
    for (const kind of DIGIT_CONTRACT_KINDS) {
      for (let target = 0; target <= 9; target += 1) {
        for (let digit = 0; digit <= 9; digit += 1) {
          expect(calculateTradeResult(kind, target, digit)).toBe(expected(kind, target, digit))
        }
      }
    }
  })

  it('OVER 9 and UNDER 0 can never win', () => {
    for (let digit = 0; digit <= 9; digit += 1) {
      expect(calculateTradeResult('OVER', 9, digit)).toBe('LOSS')
      expect(calculateTradeResult('UNDER', 0, digit)).toBe('LOSS')
    }
  })

  it('rejects invalid digits instead of guessing', () => {
    expect(() => calculateTradeResult('EVEN', null, 10)).toThrow(RangeError)
    expect(() => calculateTradeResult('EVEN', null, 1.5)).toThrow(RangeError)
    expect(() => calculateTradeResult('MATCH', null, 3)).toThrow(RangeError)
    expect(() => calculateTradeResult('OVER', 12, 3)).toThrow(RangeError)
  })

  it('settleDigitContract (DEMO + REAL settlement) goes through the same rule', () => {
    for (const kind of DIGIT_CONTRACT_KINDS) {
      for (let target = 0; target <= 9; target += 1) {
        const selection = selectionForKind(kind, target)
        expect(contractKindOf(selection.contractOption)).toBe(kind)
        for (let digit = 0; digit <= 9; digit += 1) {
          const outcome = settleDigitContract({ ...selection, exitPrice: 0, exitDigit: digit })
          expect(outcome).toBe(calculateTradeResult(kind, target, digit) === 'WIN' ? 'won' : 'lost')
        }
      }
    }
  })
})

describe('SQL settle_real_trade rule', () => {
  /** The outcome check in the latest migration defining public.settle_real_trade, whitespace-normalised. */
  function sqlRule(source: string): string {
    const start = source.lastIndexOf('v_outcome := case t.contract_type')
    const end = source.indexOf('end;', start)
    return source.slice(start, end + 4).replace(/\s+/g, ' ').trim()
  }

  it('is the same EVEN/ODD, MATCH/DIFFER, OVER/UNDER rule as calculateTradeResult', () => {
    expect(sqlRule(settleMigration)).toBe(
      [
        'v_outcome := case t.contract_type',
        "when 'EVEN_ODD' then case when (v_digit % 2 = 0) = (t.contract_option = 'even') then 'won' else 'lost' end",
        "when 'MATCH_DIFFER' then case when (v_digit = t.selected_digit) = (t.contract_option = 'match') then 'won' else 'lost' end",
        "else case when t.contract_option = 'over' and v_digit > t.barrier then 'won'",
        "when t.contract_option = 'under' and v_digit < t.barrier then 'won'",
        "else 'lost' end end;",
      ].join(' '),
    )
  })

  it('a JS transcription of that SQL agrees with calculateTradeResult everywhere', () => {
    const sql = (type: string, option: string, selected: number | null, barrier: number | null, d: number) => {
      if (type === 'EVEN_ODD') return (d % 2 === 0) === (option === 'even') ? 'won' : 'lost'
      if (type === 'MATCH_DIFFER') return (d === selected) === (option === 'match') ? 'won' : 'lost'
      if (option === 'over' && d > barrier!) return 'won'
      if (option === 'under' && d < barrier!) return 'won'
      return 'lost'
    }
    for (const kind of DIGIT_CONTRACT_KINDS) {
      for (let target = 0; target <= 9; target += 1) {
        const s = selectionForKind(kind, target)
        for (let digit = 0; digit <= 9; digit += 1) {
          const engine = calculateTradeResult(kind, target, digit) === 'WIN' ? 'won' : 'lost'
          expect(sql(s.contractType, s.contractOption, s.selectedDigit, s.barrier, digit)).toBe(engine)
        }
      }
    }
  })
})
