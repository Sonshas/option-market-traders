import { describe, expect, it } from 'vitest'
import webSource from './digit-contracts.ts?raw'
import denoSource from '../../../../supabase/functions/_shared/digit-contracts.ts?raw'
import {
  DIGIT_CONTRACT_OPTIONS,
  DIGIT_PAYOUT_RATE,
  MAX_PAYOUT_RATE,
  REAL_STAKE_MAX,
  REAL_STAKE_MIN,
  TRADE_DURATIONS,
  calculateTradeResult,
  contractCanWin,
  digitPayoutRate,
  extractLastDigit,
  lastDigitOfPrice,
  normalizePipSize,
  payoutFor,
  selectExitTick,
  settleDigitContract,
  validateContractSelection,
  validateRealStake,
  validateRealTradeRequest,
  winProbability,
  type DigitContractOption,
  type DigitContractSelection,
  type DigitContractType,
} from '@/domain/digit-contracts'
import { DURATIONS } from '@/lib/constants'

function settle(type: DigitContractType, option: DigitContractOption, digit: number, extra: { selectedDigit?: number; barrier?: number } = {}) {
  return settleDigitContract({
    contractType: type,
    contractOption: option,
    selectedDigit: extra.selectedDigit ?? null,
    barrier: extra.barrier ?? null,
    exitPrice: 0,
    exitDigit: digit,
  })
}

describe('calculateTradeResult / settleDigitContract (natural rules)', () => {
  it('EVEN / ODD validation cases', () => {
    for (const d of [0, 2, 4, 6, 8]) {
      expect(calculateTradeResult('EVEN', null, d)).toBe('WIN')
      expect(calculateTradeResult('ODD', null, d)).toBe('LOSS')
      expect(settle('EVEN_ODD', 'even', d)).toBe('won')
      expect(settle('EVEN_ODD', 'odd', d)).toBe('lost')
    }
    for (const d of [1, 3, 5, 7, 9]) {
      expect(calculateTradeResult('ODD', null, d)).toBe('WIN')
      expect(calculateTradeResult('EVEN', null, d)).toBe('LOSS')
      expect(settle('EVEN_ODD', 'odd', d)).toBe('won')
      expect(settle('EVEN_ODD', 'even', d)).toBe('lost')
    }
  })

  it('MATCH / DIFFER 7', () => {
    expect(calculateTradeResult('MATCH', 7, 7)).toBe('WIN')
    expect(calculateTradeResult('MATCH', 7, 6)).toBe('LOSS')
    expect(calculateTradeResult('MATCH', 7, 8)).toBe('LOSS')
    expect(calculateTradeResult('DIFFER', 7, 7)).toBe('LOSS')
    expect(calculateTradeResult('DIFFER', 7, 6)).toBe('WIN')
    expect(calculateTradeResult('DIFFER', 7, 8)).toBe('WIN')
    expect(settle('MATCH_DIFFER', 'match', 7, { selectedDigit: 7 })).toBe('won')
    expect(settle('MATCH_DIFFER', 'differ', 6, { selectedDigit: 7 })).toBe('won')
  })

  it('OVER / UNDER 5', () => {
    expect(calculateTradeResult('OVER', 5, 6)).toBe('WIN')
    expect(calculateTradeResult('OVER', 5, 9)).toBe('WIN')
    expect(calculateTradeResult('OVER', 5, 5)).toBe('LOSS')
    expect(calculateTradeResult('OVER', 5, 4)).toBe('LOSS')
    expect(calculateTradeResult('UNDER', 5, 4)).toBe('WIN')
    expect(calculateTradeResult('UNDER', 5, 0)).toBe('WIN')
    expect(calculateTradeResult('UNDER', 5, 5)).toBe('LOSS')
    expect(calculateTradeResult('UNDER', 5, 6)).toBe('LOSS')
  })

  it('falls back to the price string when no valid exit digit is given', () => {
    // 1234.57 → last digit 7 → ODD wins
    expect(
      settleDigitContract({ contractType: 'EVEN_ODD', contractOption: 'odd', selectedDigit: null, barrier: null, exitPrice: 1234.57 }),
    ).toBe('won')
    expect(
      settleDigitContract({ contractType: 'EVEN_ODD', contractOption: 'even', selectedDigit: null, barrier: null, exitPrice: 1234.57 }),
    ).toBe('lost')
  })
})

function selection(contractType: DigitContractType, contractOption: DigitContractOption, digit: number | null = null): DigitContractSelection {
  return {
    contractType,
    contractOption,
    selectedDigit: contractType === 'MATCH_DIFFER' ? digit : null,
    barrier: contractType === 'OVER_UNDER' ? digit : null,
  }
}

describe('digitPayoutRate (flat rate for every winnable contract)', () => {
  it('pays DIGIT_PAYOUT_RATE (0.9) on EVEN, ODD, MATCH, DIFFER, OVER and UNDER', () => {
    expect(DIGIT_PAYOUT_RATE).toBe(0.9)
    expect(winProbability(selection('EVEN_ODD', 'even'))).toBe(0.5)
    expect(digitPayoutRate(selection('EVEN_ODD', 'even'))).toBe(0.9)
    expect(digitPayoutRate(selection('EVEN_ODD', 'odd'))).toBe(0.9)
    for (let d = 0; d <= 9; d += 1) {
      expect(digitPayoutRate(selection('MATCH_DIFFER', 'match', d))).toBe(0.9)
      expect(digitPayoutRate(selection('MATCH_DIFFER', 'differ', d))).toBe(0.9)
    }
    for (let d = 0; d <= 8; d += 1) expect(digitPayoutRate(selection('OVER_UNDER', 'over', d))).toBe(0.9)
    for (let d = 1; d <= 9; d += 1) expect(digitPayoutRate(selection('OVER_UNDER', 'under', d))).toBe(0.9)
  })

  it('returns 0 for contracts that cannot win (OVER 9, UNDER 0)', () => {
    expect(contractCanWin(selection('OVER_UNDER', 'over', 9))).toBe(false)
    expect(digitPayoutRate(selection('OVER_UNDER', 'over', 9))).toBe(0)
    expect(contractCanWin(selection('OVER_UNDER', 'under', 0))).toBe(false)
    expect(digitPayoutRate(selection('OVER_UNDER', 'under', 0))).toBe(0)
  })

  it('a $10 stake wins $19.00 on every winnable contract', () => {
    for (const sel of [
      selection('EVEN_ODD', 'even'),
      selection('MATCH_DIFFER', 'match', 3),
      selection('MATCH_DIFFER', 'differ', 3),
      selection('OVER_UNDER', 'over', 5),
      selection('OVER_UNDER', 'under', 5),
    ]) {
      expect(payoutFor(10, digitPayoutRate(sel), 'won')).toBe(19)
    }
  })

  it('never exceeds MAX_PAYOUT_RATE and is never negative', () => {
    for (const [contractType, options] of Object.entries(DIGIT_CONTRACT_OPTIONS) as Array<
      [DigitContractType, DigitContractOption[]]
    >) {
      for (const contractOption of options) {
        for (let d = 0; d <= 9; d += 1) {
          const rate = digitPayoutRate(selection(contractType, contractOption, d))
          expect(rate).toBeGreaterThanOrEqual(0)
          expect(rate).toBeLessThanOrEqual(MAX_PAYOUT_RATE)
        }
      }
    }
  })
})

describe('payoutFor', () => {
  it.each([
    [10, 0.9, 19],
    [10, 0.0555, 10.55],
    [1, 0.0555, 1.05],
  ])('stake %f at rate %f returns %f (rounded down to the cent)', (stake, rate, expected) => {
    expect(payoutFor(stake, rate, 'won')).toBe(expected)
  })

  it('returns the stake on tie / refund and nothing on loss', () => {
    expect(payoutFor(5, 0.9, 'tie')).toBe(5)
    expect(payoutFor(5, 0.9, 'cancelled')).toBe(5)
    expect(payoutFor(5, 0.9, 'lost')).toBe(0)
  })
})

describe('selectExitTick', () => {
  const expiry = 1_000_000
  it('picks the first tick at or after expiry regardless of order', () => {
    const ticks = [
      { epochMs: expiry + 2000, price: 3 },
      { epochMs: expiry - 1000, price: 1 },
      { epochMs: expiry, price: 2 },
    ]
    expect(selectExitTick(ticks, expiry)?.price).toBe(2)
  })

  it('never uses a tick before expiry', () => {
    expect(selectExitTick([{ epochMs: expiry - 1, price: 1 }], expiry)).toBeNull()
    expect(selectExitTick([], expiry)).toBeNull()
  })

  it('skips invalid ticks', () => {
    expect(
      selectExitTick(
        [
          { epochMs: expiry + 1, price: Number.NaN },
          { epochMs: expiry + 2, price: 9 },
        ],
        expiry,
      )?.price,
    ).toBe(9)
  })
})

describe('pip-size digit extraction', () => {
  it('normalizes decimal-place pip sizes', () => {
    expect(normalizePipSize(2)).toBeCloseTo(0.01)
    expect(normalizePipSize(4)).toBeCloseTo(0.0001)
    expect(normalizePipSize(0.001)).toBe(0.001)
    expect(normalizePipSize(0)).toBe(0.01)
  })

  it('keeps trailing zeros that the JSON number dropped', () => {
    expect(extractLastDigit(44662.425, 4)).toBe(0)
    expect(extractLastDigit(660.7, 2)).toBe(0)
    expect(extractLastDigit(660.73, 2)).toBe(3)
    expect(extractLastDigit(1022.02, 0.01)).toBe(2)
    expect(extractLastDigit(9876.123, 3)).toBe(3)
  })

  it('rejects invalid input', () => {
    expect(extractLastDigit(Number.NaN, 2)).toBeNull()
    expect(extractLastDigit(1, -1)).toBeNull()
  })

  it('lastDigitOfPrice parses the price string', () => {
    expect(lastDigitOfPrice(123.45)).toBe(5)
    expect(lastDigitOfPrice(120)).toBe(2)
  })
})

describe('validation', () => {
  it('validates contract selections', () => {
    expect(validateContractSelection({ contractType: 'EVEN_ODD', contractOption: 'even' })).toBeNull()
    expect(validateContractSelection({ contractType: 'EVEN_ODD', contractOption: 'over' })).toMatch(/contract type/)
    expect(validateContractSelection({ contractType: 'MATCH_DIFFER', contractOption: 'match', selectedDigit: 10 })).toMatch(/digit/)
    expect(validateContractSelection({ contractType: 'MATCH_DIFFER', contractOption: 'differ', selectedDigit: 0 })).toBeNull()
    expect(validateContractSelection({ contractType: 'OVER_UNDER', contractOption: 'under', barrier: 2.5 })).toMatch(/barrier/)
    expect(validateContractSelection({ contractType: 'OVER_UNDER', contractOption: 'under', barrier: 9 })).toBeNull()
  })

  it('enforces the $1 – $500 REAL stake limits and balance', () => {
    expect(REAL_STAKE_MIN).toBe(1)
    expect(REAL_STAKE_MAX).toBe(500)
    expect(validateRealStake(0.99)).toMatch(/Minimum/)
    expect(validateRealStake(1)).toBeNull()
    expect(validateRealStake(500.01)).toMatch(/Maximum/)
    expect(validateRealStake(5, 3.85)).toMatch(/Insufficient/)
  })

  const base = {
    account_mode: 'REAL',
    symbol: 'R_100',
    contract_type: 'MATCH_DIFFER',
    contract_option: 'match',
    selected_digit: 3,
    barrier: 7,
    stake: 2,
    duration: 15_000,
    idempotency_key: 'abc12345-def6',
  }

  it('accepts a valid REAL request and drops fields that do not apply', () => {
    const result = validateRealTradeRequest(base)
    expect(result.ok).toBe(true)
    if (result.ok) {
      expect(result.value.selectedDigit).toBe(3)
      expect(result.value.barrier).toBeNull()
    }
  })

  it.each([
    [{ symbol: 'BTCUSDT' }, /market/],
    [{ account_mode: 'DEMO' }, /REAL account/],
  ])('rejects %o', (patch, message) => {
    const result = validateRealTradeRequest({ ...base, ...patch })
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.error).toMatch(message)
  })

  it('DEMO and REAL share the same duration list', () => {
    expect(DURATIONS).toBe(TRADE_DURATIONS)
  })
})

describe('Edge Function copy', () => {
  it('supabase/functions/_shared/digit-contracts.ts is identical to src/domain/digit-contracts.ts', () => {
    expect(denoSource.length).toBeGreaterThan(1000)
    expect(denoSource.replace(/\r\n/g, '\n')).toBe(webSource.replace(/\r\n/g, '\n'))
  })
})
