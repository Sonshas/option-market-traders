import { describe, expect, it } from 'vitest'
import webSource from './digit-contracts.ts?raw'
import denoSource from '../../../../supabase/functions/_shared/digit-contracts.ts?raw'
import {
  CANNOT_WIN_WARNING,
  MAX_PAYOUT_RATE,
  REAL_STAKE_MAX,
  REAL_STAKE_MIN,
  TRADE_DURATIONS,
  contractCanWin,
  digitPayoutRate,
  extractLastDigit,
  lastDigitOfPrice,
  normalizePipSize,
  payoutFor,
  potentialPayout,
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

describe('settleDigitContract', () => {
  it.each([0, 2, 4, 6, 8])('EVEN wins / ODD loses on digit %i', (digit) => {
    expect(settle('EVEN_ODD', 'even', digit)).toBe('won')
    expect(settle('EVEN_ODD', 'odd', digit)).toBe('lost')
  })

  it.each([1, 3, 5, 7, 9])('ODD wins / EVEN loses on digit %i', (digit) => {
    expect(settle('EVEN_ODD', 'odd', digit)).toBe('won')
    expect(settle('EVEN_ODD', 'even', digit)).toBe('lost')
  })

  it('MATCH wins only on the selected digit, DIFFER on every other digit', () => {
    for (let digit = 0; digit <= 9; digit += 1) {
      expect(settle('MATCH_DIFFER', 'match', digit, { selectedDigit: 7 })).toBe(digit === 7 ? 'won' : 'lost')
      expect(settle('MATCH_DIFFER', 'differ', digit, { selectedDigit: 7 })).toBe(digit === 7 ? 'lost' : 'won')
    }
  })

  it('OVER / UNDER win strictly beyond the barrier; the barrier digit loses both', () => {
    for (let barrier = 0; barrier <= 9; barrier += 1) {
      for (let digit = 0; digit <= 9; digit += 1) {
        expect(settle('OVER_UNDER', 'over', digit, { barrier })).toBe(digit > barrier ? 'won' : 'lost')
        expect(settle('OVER_UNDER', 'under', digit, { barrier })).toBe(digit < barrier ? 'won' : 'lost')
      }
    }
  })

  it('OVER 9 and UNDER 0 never win', () => {
    for (let digit = 0; digit <= 9; digit += 1) {
      expect(settle('OVER_UNDER', 'over', digit, { barrier: 9 })).toBe('lost')
      expect(settle('OVER_UNDER', 'under', digit, { barrier: 0 })).toBe('lost')
    }
  })

  it('falls back to the price string when no valid exit digit is given', () => {
    expect(
      settleDigitContract({ contractType: 'EVEN_ODD', contractOption: 'odd', selectedDigit: null, barrier: null, exitPrice: 1234.57 }),
    ).toBe('won')
    expect(
      settleDigitContract({ contractType: 'EVEN_ODD', contractOption: 'odd', selectedDigit: null, barrier: null, exitPrice: 1234.57, exitDigit: 12 }),
    ).toBe('won')
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

function allSelections(): DigitContractSelection[] {
  const out: DigitContractSelection[] = [selection('EVEN_ODD', 'even'), selection('EVEN_ODD', 'odd')]
  for (let d = 0; d <= 9; d += 1) {
    out.push(selection('MATCH_DIFFER', 'match', d), selection('MATCH_DIFFER', 'differ', d))
    out.push(selection('OVER_UNDER', 'over', d), selection('OVER_UNDER', 'under', d))
  }
  return out
}

describe('digitPayoutRate (5% house margin)', () => {
  it.each([
    ['EVEN', selection('EVEN_ODD', 'even'), 0.9],
    ['ODD', selection('EVEN_ODD', 'odd'), 0.9],
    ['MATCH', selection('MATCH_DIFFER', 'match', 3), 8.5],
    ['DIFFER', selection('MATCH_DIFFER', 'differ', 3), 0.0555],
  ])('%s → %f', (_label, sel, rate) => {
    expect(digitPayoutRate(sel)).toBe(rate)
  })

  it.each([
    [0, 0.0555, 0],
    [1, 0.1875, 8.5],
    [2, 0.3571, 3.75],
    [3, 0.5833, 2.1666],
    [4, 0.9, 1.375],
    [5, 1.375, 0.9],
    [6, 2.1666, 0.5833],
    [7, 3.75, 0.3571],
    [8, 8.5, 0.1875],
    [9, 0, 0.0555],
  ])('barrier %i: OVER → %f, UNDER → %f', (barrier, over, under) => {
    expect(digitPayoutRate(selection('OVER_UNDER', 'over', barrier))).toBe(over)
    expect(digitPayoutRate(selection('OVER_UNDER', 'under', barrier))).toBe(under)
  })

  it('matches 0.95 / P − 1 rounded down to 4 decimals', () => {
    for (const sel of allSelections()) {
      const p = winProbability(sel)
      if (p === 0) continue
      const exact = 0.95 / p - 1
      const rate = digitPayoutRate(sel)
      expect(rate).toBeLessThanOrEqual(exact + 1e-12)
      expect(exact - rate).toBeLessThan(0.0001)
      expect(Number(rate.toFixed(4))).toBe(rate)
    }
  })

  it('every contract that can win returns at most $0.95 per $1 (also after cent rounding)', () => {
    for (const sel of allSelections()) {
      const p = winProbability(sel)
      if (p === 0) continue
      expect(p * (1 + digitPayoutRate(sel))).toBeLessThanOrEqual(0.95 + 1e-12)
      for (const stake of [1, 1.15, 10, 37.37, 500]) {
        expect((p * potentialPayout(stake, sel)) / stake).toBeLessThanOrEqual(0.95 + 1e-12)
      }
    }
  })

  it('OVER 9 / UNDER 0 cannot win: rate 0, payout $0.00, no division by zero', () => {
    for (const sel of [selection('OVER_UNDER', 'over', 9), selection('OVER_UNDER', 'under', 0)]) {
      expect(winProbability(sel)).toBe(0)
      expect(contractCanWin(sel)).toBe(false)
      expect(digitPayoutRate(sel)).toBe(0)
      expect(potentialPayout(10, sel)).toBe(0)
      expect(Number.isFinite(digitPayoutRate(sel))).toBe(true)
    }
    expect(CANNOT_WIN_WARNING).toBe('This contract cannot win — 0% chance')
  })

  it('never exceeds MAX_PAYOUT_RATE and is never negative', () => {
    for (const sel of allSelections()) {
      const rate = digitPayoutRate(sel)
      expect(rate).toBeGreaterThanOrEqual(0)
      expect(rate).toBeLessThanOrEqual(MAX_PAYOUT_RATE)
    }
  })
})

describe('payoutFor', () => {
  it.each([
    [10, 0.9, 19],
    [1, 0.9, 1.9],
    [10, 8.5, 95],
    [10, 0.0555, 10.55],
    [1.15, 0.9, 2.18],
    [12.34, 0.0555, 13.02],
    [500, 8.5, 4750],
    [1.15, 0.8, 2.07],
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
    expect(validateRealStake(1.15)).toBeNull()
    expect(validateRealStake(500)).toBeNull()
    expect(validateRealStake(500.01)).toMatch(/Maximum/)
    expect(validateRealStake(1.001)).toMatch(/decimal/)
    expect(validateRealStake('5')).toMatch(/stake/)
    expect(validateRealStake(5, 3.85)).toMatch(/Insufficient/)
    expect(validateRealStake(3.85, 3.85)).toBeNull()
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
    [{ symbol: 'frxEURUSD' }, /market/],
    [{ duration: 10_000 }, /duration/],
    [{ stake: 0.5 }, /Minimum/],
    [{ stake: 501 }, /Maximum/],
    [{ idempotency_key: 'x' }, /Invalid/],
    [{ contract_option: 'over' }, /contract/],
    [{ account_mode: undefined }, /REAL account/],
    [{ account_mode: 'DEMO' }, /REAL account/],
    [{ account_mode: 'real' }, /REAL account/],
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
