import { describe, expect, it } from 'vitest'
import webSource from './payment-settings.ts?raw'
import edgeSource from '../../../../../supabase/functions/_shared/payments/payment-settings.ts?raw'
import {
  depositFeesFromMap,
  hostFeesFromMaps,
  mergeMegapayConfig,
  mergeWithdrawalConfig,
  parseMegapayConfig,
  parseQuickAmounts,
  parseWithdrawalConfig,
  validateHostFeePatch,
  validatePayoutDeskFeePatch,
} from '@/domain/payments'

describe('payment-settings mirrors Edge _shared', () => {
  it('keeps payment-settings.ts byte-identical', () => {
    expect(webSource).toBe(edgeSource)
  })
})

describe('payment fee maps', () => {
  it('prefers DB deposit rows over env defaults', () => {
    const env = parseMegapayConfig({})
    const merged = mergeMegapayConfig(env, {
      DEPOSIT_KES_PER_USD: '140',
      DEPOSIT_MIN_KES: '2000',
      DEPOSIT_MAX_KES: '80000',
    })
    expect(merged).toEqual({ kesPerUsd: 140, minKes: 2000, maxKes: 80_000 })
    expect(parseQuickAmounts('2000, 5000')).toEqual([2000, 5000])
  })

  it('prefers DB withdrawal rows over env defaults', () => {
    const env = parseWithdrawalConfig({})
    const merged = mergeWithdrawalConfig(env, {
      WITHDRAWAL_KES_PER_USD: '128',
      WITHDRAWAL_MIN_KES: '1500',
      WITHDRAWAL_MAX_KES: '200000',
      WITHDRAWAL_FEE_KES: '50',
    })
    expect(merged.kesPerUsd).toBe(128)
    expect(merged.minKes).toBe(1500)
    expect(merged.maxKes).toBe(200_000)
    expect(merged.feeKes).toBe(50)
  })

  it('builds host fee bundle from maps', () => {
    const host = hostFeesFromMaps(
      {
        DEPOSIT_KES_PER_USD: '130',
        DEPOSIT_MIN_KES: '1600',
        DEPOSIT_MAX_KES: '150000',
        DEPOSIT_QUICK_AMOUNTS: '1600,2500',
        WITHDRAWAL_KES_PER_USD: '130',
        WITHDRAWAL_MIN_KES: '1000',
        WITHDRAWAL_MAX_KES: '400000',
        WITHDRAWAL_FEE_KES: '0',
      },
      {
        REAL_STAKE_MIN_USD: '2',
        REAL_STAKE_MAX_USD: '250',
        REAL_MAX_OPEN_TRADES: '3',
        REAL_DAILY_PROFIT_LIMIT_USD: '500',
      },
    )
    expect(host.trading.stakeMinUsd).toBe(2)
    expect(host.trading.stakeMaxUsd).toBe(250)
    expect(host.deposit.quickAmounts).toBe('1600,2500')
    expect(depositFeesFromMap({}).minKes).toBeGreaterThan(0)
  })

  it('rejects invalid fee patches', () => {
    expect(validateHostFeePatch({ deposit: { minKes: 5000, maxKes: 1000 } })[0]?.field).toBe('deposit.maxKes')
    expect(validateHostFeePatch({ withdrawal: { minKes: 5000, maxKes: 1000 } })[0]?.field).toBe('withdrawal.maxKes')
    expect(validateHostFeePatch({ trading: { stakeMinUsd: 50, stakeMaxUsd: 10 } })[0]?.field).toBe('trading.stakeMaxUsd')
    expect(validatePayoutDeskFeePatch({ kesPerUsdWithdrawal: 0 })[0]?.field).toBe('payoutDesk.kesPerUsdWithdrawal')
  })
})
