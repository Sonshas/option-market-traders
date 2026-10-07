import { describe, expect, it } from 'vitest'
import hostSchema from '../../../../supabase/migrations/20260920111952_smartbasebinary_host_schema.sql?raw'
import { hostSchemaSection } from './host-schema-section'
import {
  DIGIT_CONTRACT_KINDS,
  calculateTradeResult,
  selectionForKind,
  settleDigitContract,
  type DigitContractKind,
} from '@/domain/digit-contracts'
import { settledResult } from '@/domain/trade-result'

const settleMigration = hostSchemaSection(hostSchema, '20261005200000_natural_contract_settlement.sql')

/** Independent restatement of the natural contract rules. */
function expectedNatural(kind: DigitContractKind, target: number, digit: number): 'WIN' | 'LOSS' {
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

describe('calculateTradeResult (natural rules)', () => {
  it('matches the natural contract rules for every contract, target and final digit 0–9', () => {
    for (const kind of DIGIT_CONTRACT_KINDS) {
      for (let target = 0; target <= 9; target += 1) {
        for (let digit = 0; digit <= 9; digit += 1) {
          expect(calculateTradeResult(kind, target, digit)).toBe(expectedNatural(kind, target, digit))
        }
      }
    }
  })
})

describe('settleDigitContract (natural outcome)', () => {
  it('uses natural contract rules for every trade type', () => {
    for (const kind of DIGIT_CONTRACT_KINDS) {
      for (let target = 0; target <= 9; target += 1) {
        const selection = selectionForKind(kind, target)
        for (let digit = 0; digit <= 9; digit += 1) {
          const outcome = settleDigitContract({ ...selection, exitPrice: 0, exitDigit: digit })
          expect(outcome).toBe(expectedNatural(kind, target, digit) === 'WIN' ? 'won' : 'lost')
        }
      }
    }
  })
})

describe('settledResult', () => {
  it('uses natural rules on the exit digit and contract', () => {
    expect(
      settledResult({
        status: 'won',
        contractType: 'EVEN_ODD',
        contractOption: 'even',
        selectedDigit: null,
        barrier: null,
        exitDigit: 2,
      }),
    ).toBe('WIN')
    expect(
      settledResult({
        status: 'lost',
        contractType: 'EVEN_ODD',
        contractOption: 'even',
        selectedDigit: null,
        barrier: null,
        exitDigit: 1,
      }),
    ).toBe('LOSS')
    expect(
      settledResult({
        status: 'won',
        contractType: 'MATCH_DIFFER',
        contractOption: 'match',
        selectedDigit: 7,
        barrier: null,
        exitDigit: 7,
      }),
    ).toBe('WIN')
  })
})

describe('SQL settle_real_trade rule', () => {
  it('uses natural contract outcome branches', () => {
    const sql = settleMigration.replace(/\s+/g, ' ')
    expect(sql).toContain("t.contract_option = 'even'")
    expect(sql).toContain("t.contract_option = 'odd'")
    expect(sql).toContain("t.contract_option = 'match'")
    expect(sql).not.toContain("v_outcome := case when v_digit between 0 and 8 then 'won' else 'lost' end;")
  })
})
