// Canonical: apps/web/src/domain/payments/payment-settings.ts
// Mirror: supabase/functions/_shared/payments/payment-settings.ts (must stay byte-identical)
// Pure payment / fee setting rules shared by the web app and the admin-fees Edge Function.

import {
  DEFAULT_KES_PER_USD,
  DEFAULT_MAX_KES,
  DEFAULT_MIN_KES,
  type MegapayConfig,
} from './megapay.ts'
import {
  DEFAULT_WITHDRAWAL_FEE_KES,
  DEFAULT_WITHDRAWAL_MAX_KES,
  DEFAULT_WITHDRAWAL_MIN_KES,
  WITHDRAWAL_HARD_MAX_KES,
  type WithdrawalConfig,
} from './withdrawals.ts'

export const PAYMENT_KEYS = {
  depositKesPerUsd: 'DEPOSIT_KES_PER_USD',
  depositMinKes: 'DEPOSIT_MIN_KES',
  depositMaxKes: 'DEPOSIT_MAX_KES',
  depositQuickAmounts: 'DEPOSIT_QUICK_AMOUNTS',
  withdrawalKesPerUsd: 'WITHDRAWAL_KES_PER_USD',
  withdrawalMinKes: 'WITHDRAWAL_MIN_KES',
  withdrawalMaxKes: 'WITHDRAWAL_MAX_KES',
  withdrawalFeeKes: 'WITHDRAWAL_FEE_KES',
} as const

export const TRADING_FEE_KEYS = {
  stakeMinUsd: 'REAL_STAKE_MIN_USD',
  stakeMaxUsd: 'REAL_STAKE_MAX_USD',
  maxOpenTrades: 'REAL_MAX_OPEN_TRADES',
  dailyProfitLimitUsd: 'REAL_DAILY_PROFIT_LIMIT_USD',
} as const

export const DEFAULT_DEPOSIT_QUICK_AMOUNTS = '1600,2500,5000,10000'
export const DEFAULT_STAKE_MIN_USD = 1
export const DEFAULT_STAKE_MAX_USD = 500
export const DEFAULT_MAX_OPEN_TRADES = 5
export const DEFAULT_DAILY_PROFIT_LIMIT_USD = 1000

export type SettingsMap = Record<string, string>

export interface DepositFeeSettings {
  kesPerUsd: number
  minKes: number
  maxKes: number
  quickAmounts: string
}

export interface WithdrawalFeeSettings {
  kesPerUsd: number
  minKes: number
  maxKes: number
  feeKes: number
}

export interface TradingFeeSettings {
  stakeMinUsd: number
  stakeMaxUsd: number
  maxOpenTrades: number
  dailyProfitLimitUsd: number
}

export interface PayoutDeskFeeSettings {
  minWithdrawUsd: number
  withdrawalFeePercent: number
  kesPerUsdWithdrawal: number
  kesPerUsdDeposit: number
  mpesaCapKes: number
  taxFeeUsd: number
  botFeeUsd: number
  previewStkConfirm: boolean
}

/** Matches payout-desk FALLBACK_RATES + preview flag defaults. */
export const FALLBACK_PAYOUT_DESK: PayoutDeskFeeSettings = {
  minWithdrawUsd: 1,
  withdrawalFeePercent: 0,
  kesPerUsdWithdrawal: 134,
  kesPerUsdDeposit: 134,
  mpesaCapKes: 400_000,
  taxFeeUsd: 0,
  botFeeUsd: 0,
  previewStkConfirm: true,
}

export interface HostFeeSettings {
  deposit: DepositFeeSettings
  withdrawal: WithdrawalFeeSettings
  trading: TradingFeeSettings
}

function positiveNumber(raw: string | undefined | null, fallback: number): number {
  if (raw == null || String(raw).trim() === '') return fallback
  const n = Number(raw)
  return Number.isFinite(n) && n > 0 ? n : fallback
}

function nonNegativeNumber(raw: string | undefined | null, fallback: number): number {
  if (raw == null || String(raw).trim() === '') return fallback
  const n = Number(raw)
  return Number.isFinite(n) && n >= 0 ? n : fallback
}

function wholePositive(raw: string | undefined | null, fallback: number): number {
  return Math.ceil(positiveNumber(raw, fallback))
}

export function parseQuickAmounts(raw: string | undefined | null): number[] {
  const text = String(raw ?? DEFAULT_DEPOSIT_QUICK_AMOUNTS)
  const amounts = text
    .split(/[,\s]+/)
    .map((part) => Number(part.trim()))
    .filter((n) => Number.isInteger(n) && n > 0)
  return amounts.length > 0 ? amounts : [1600, 2500, 5000, 10_000]
}

export function formatQuickAmounts(amounts: number[]): string {
  return amounts.filter((n) => Number.isInteger(n) && n > 0).join(',')
}

export function depositFeesFromMap(map: SettingsMap, envFallback?: Partial<MegapayConfig>): DepositFeeSettings {
  const kesPerUsd = Math.round(
    positiveNumber(map[PAYMENT_KEYS.depositKesPerUsd], envFallback?.kesPerUsd ?? DEFAULT_KES_PER_USD) * 10_000,
  ) / 10_000
  const minKes = wholePositive(map[PAYMENT_KEYS.depositMinKes], envFallback?.minKes ?? DEFAULT_MIN_KES)
  const maxKes = Math.max(
    minKes,
    Math.floor(positiveNumber(map[PAYMENT_KEYS.depositMaxKes], envFallback?.maxKes ?? DEFAULT_MAX_KES)),
  )
  return {
    kesPerUsd,
    minKes,
    maxKes,
    quickAmounts: map[PAYMENT_KEYS.depositQuickAmounts]?.trim() || DEFAULT_DEPOSIT_QUICK_AMOUNTS,
  }
}

export function withdrawalFeesFromMap(
  map: SettingsMap,
  envFallback?: Partial<WithdrawalConfig>,
): WithdrawalFeeSettings {
  const kesPerUsd = Math.round(
    positiveNumber(map[PAYMENT_KEYS.withdrawalKesPerUsd], envFallback?.kesPerUsd ?? DEFAULT_KES_PER_USD) * 10_000,
  ) / 10_000
  const minKes = wholePositive(map[PAYMENT_KEYS.withdrawalMinKes], envFallback?.minKes ?? DEFAULT_WITHDRAWAL_MIN_KES)
  const maxKes = Math.min(
    WITHDRAWAL_HARD_MAX_KES,
    Math.max(minKes, Math.floor(positiveNumber(map[PAYMENT_KEYS.withdrawalMaxKes], envFallback?.maxKes ?? DEFAULT_WITHDRAWAL_MAX_KES))),
  )
  const feeKes = Math.round(nonNegativeNumber(map[PAYMENT_KEYS.withdrawalFeeKes], envFallback?.feeKes ?? DEFAULT_WITHDRAWAL_FEE_KES))
  return { kesPerUsd, minKes, maxKes, feeKes }
}

export function tradingFeesFromMap(map: SettingsMap): TradingFeeSettings {
  const stakeMinUsd = Math.round(positiveNumber(map[TRADING_FEE_KEYS.stakeMinUsd], DEFAULT_STAKE_MIN_USD) * 100) / 100
  const stakeMaxUsd = Math.max(
    stakeMinUsd,
    Math.round(positiveNumber(map[TRADING_FEE_KEYS.stakeMaxUsd], DEFAULT_STAKE_MAX_USD) * 100) / 100,
  )
  const maxOpenTrades = Math.max(
    1,
    Math.min(50, Math.round(positiveNumber(map[TRADING_FEE_KEYS.maxOpenTrades], DEFAULT_MAX_OPEN_TRADES))),
  )
  const dailyProfitLimitUsd = Math.round(
    positiveNumber(map[TRADING_FEE_KEYS.dailyProfitLimitUsd], DEFAULT_DAILY_PROFIT_LIMIT_USD) * 100,
  ) / 100
  return { stakeMinUsd, stakeMaxUsd, maxOpenTrades, dailyProfitLimitUsd }
}

export function mergeMegapayConfig(envCfg: MegapayConfig, map: SettingsMap): MegapayConfig {
  const deposit = depositFeesFromMap(map, envCfg)
  return { kesPerUsd: deposit.kesPerUsd, minKes: deposit.minKes, maxKes: deposit.maxKes }
}

export function mergeWithdrawalConfig(envCfg: WithdrawalConfig, map: SettingsMap): WithdrawalConfig {
  const withdrawal = withdrawalFeesFromMap(map, envCfg)
  return {
    mode: envCfg.mode,
    kesPerUsd: withdrawal.kesPerUsd,
    minKes: withdrawal.minKes,
    maxKes: withdrawal.maxKes,
    feeKes: withdrawal.feeKes,
  }
}

export function hostFeesFromMaps(payment: SettingsMap, trading: SettingsMap, env?: {
  deposit?: Partial<MegapayConfig>
  withdrawal?: Partial<WithdrawalConfig>
}): HostFeeSettings {
  return {
    deposit: depositFeesFromMap(payment, env?.deposit),
    withdrawal: withdrawalFeesFromMap(payment, env?.withdrawal),
    trading: tradingFeesFromMap(trading),
  }
}

export type FeeFieldError = { field: string; message: string }

export function validateHostFeePatch(input: {
  deposit?: Partial<DepositFeeSettings>
  withdrawal?: Partial<WithdrawalFeeSettings>
  trading?: Partial<TradingFeeSettings>
}): FeeFieldError[] {
  const errors: FeeFieldError[] = []
  if (input.deposit) {
    const d = input.deposit
    if (d.kesPerUsd != null && (!(d.kesPerUsd > 0) || !Number.isFinite(d.kesPerUsd))) {
      errors.push({ field: 'deposit.kesPerUsd', message: 'Deposit KES/USD must be greater than 0.' })
    }
    if (d.minKes != null && (!Number.isInteger(d.minKes) || d.minKes < 1)) {
      errors.push({ field: 'deposit.minKes', message: 'Deposit minimum must be a whole KES amount ≥ 1.' })
    }
    if (d.maxKes != null && (!Number.isInteger(d.maxKes) || d.maxKes < 1)) {
      errors.push({ field: 'deposit.maxKes', message: 'Deposit maximum must be a whole KES amount ≥ 1.' })
    }
    if (d.minKes != null && d.maxKes != null && d.maxKes < d.minKes) {
      errors.push({ field: 'deposit.maxKes', message: 'Deposit maximum must be ≥ minimum.' })
    }
    if (d.quickAmounts != null) {
      const amounts = parseQuickAmounts(d.quickAmounts)
      if (amounts.length === 0) {
        errors.push({ field: 'deposit.quickAmounts', message: 'Enter at least one quick amount, e.g. 1600,2500,5000.' })
      }
    }
  }
  if (input.withdrawal) {
    const w = input.withdrawal
    if (w.kesPerUsd != null && (!(w.kesPerUsd > 0) || !Number.isFinite(w.kesPerUsd))) {
      errors.push({ field: 'withdrawal.kesPerUsd', message: 'Withdrawal KES/USD must be greater than 0.' })
    }
    if (w.minKes != null && (!Number.isInteger(w.minKes) || w.minKes < 1)) {
      errors.push({ field: 'withdrawal.minKes', message: 'Withdrawal minimum must be a whole KES amount ≥ 1.' })
    }
    if (w.maxKes != null && (!Number.isInteger(w.maxKes) || w.maxKes < 1 || w.maxKes > WITHDRAWAL_HARD_MAX_KES)) {
      errors.push({
        field: 'withdrawal.maxKes',
        message: `Withdrawal maximum must be between 1 and ${WITHDRAWAL_HARD_MAX_KES.toLocaleString('en-US')} KES.`,
      })
    }
    if (w.feeKes != null && (!Number.isInteger(w.feeKes) || w.feeKes < 0)) {
      errors.push({ field: 'withdrawal.feeKes', message: 'Withdrawal fee must be a whole KES amount ≥ 0.' })
    }
    if (w.minKes != null && w.maxKes != null && w.maxKes < w.minKes) {
      errors.push({ field: 'withdrawal.maxKes', message: 'Withdrawal maximum must be ≥ minimum.' })
    }
  }
  if (input.trading) {
    const t = input.trading
    if (t.stakeMinUsd != null && (!(t.stakeMinUsd > 0) || !Number.isFinite(t.stakeMinUsd))) {
      errors.push({ field: 'trading.stakeMinUsd', message: 'Minimum stake must be greater than 0.' })
    }
    if (t.stakeMaxUsd != null && (!(t.stakeMaxUsd > 0) || !Number.isFinite(t.stakeMaxUsd))) {
      errors.push({ field: 'trading.stakeMaxUsd', message: 'Maximum stake must be greater than 0.' })
    }
    if (t.stakeMinUsd != null && t.stakeMaxUsd != null && t.stakeMaxUsd < t.stakeMinUsd) {
      errors.push({ field: 'trading.stakeMaxUsd', message: 'Maximum stake must be ≥ minimum stake.' })
    }
    if (t.maxOpenTrades != null && (!Number.isInteger(t.maxOpenTrades) || t.maxOpenTrades < 1 || t.maxOpenTrades > 50)) {
      errors.push({ field: 'trading.maxOpenTrades', message: 'Max open trades must be an integer from 1 to 50.' })
    }
    if (t.dailyProfitLimitUsd != null && (!(t.dailyProfitLimitUsd > 0) || !Number.isFinite(t.dailyProfitLimitUsd))) {
      errors.push({ field: 'trading.dailyProfitLimitUsd', message: 'Daily profit limit must be greater than 0.' })
    }
  }
  return errors
}

export function validatePayoutDeskFeePatch(input: Partial<PayoutDeskFeeSettings>): FeeFieldError[] {
  const errors: FeeFieldError[] = []
  const positiveFields: Array<[keyof PayoutDeskFeeSettings, string]> = [
    ['minWithdrawUsd', 'Minimum withdraw'],
    ['kesPerUsdWithdrawal', 'Payout KES/USD'],
    ['mpesaCapKes', 'M-Pesa cap'],
  ]
  for (const [key, label] of positiveFields) {
    const value = input[key]
    if (value != null && (typeof value !== 'number' || !(value > 0) || !Number.isFinite(value))) {
      errors.push({ field: `payoutDesk.${key}`, message: `${label} must be greater than 0.` })
    }
  }
  return errors
}

export function paymentRowsFromHost(deposit: DepositFeeSettings, withdrawal: WithdrawalFeeSettings): Array<{
  key: string
  value: string
  description: string
}> {
  return [
    { key: PAYMENT_KEYS.depositKesPerUsd, value: String(deposit.kesPerUsd), description: 'M-Pesa deposit conversion: how many KES credit $1 USD.' },
    { key: PAYMENT_KEYS.depositMinKes, value: String(deposit.minKes), description: 'Minimum REAL deposit amount in whole KES.' },
    { key: PAYMENT_KEYS.depositMaxKes, value: String(deposit.maxKes), description: 'Maximum REAL deposit amount in whole KES.' },
    {
      key: PAYMENT_KEYS.depositQuickAmounts,
      value: formatQuickAmounts(parseQuickAmounts(deposit.quickAmounts)),
      description: 'Comma-separated quick-pick deposit amounts in KES.',
    },
    { key: PAYMENT_KEYS.withdrawalKesPerUsd, value: String(withdrawal.kesPerUsd), description: 'Legacy REAL withdrawal conversion: KES paid per $1 USD.' },
    { key: PAYMENT_KEYS.withdrawalMinKes, value: String(withdrawal.minKes), description: 'Minimum legacy REAL withdrawal gross amount in KES.' },
    { key: PAYMENT_KEYS.withdrawalMaxKes, value: String(withdrawal.maxKes), description: 'Maximum legacy REAL withdrawal gross amount in KES.' },
    { key: PAYMENT_KEYS.withdrawalFeeKes, value: String(withdrawal.feeKes), description: 'Fixed legacy REAL withdrawal fee in KES.' },
  ]
}

export function tradingRowsFromHost(trading: TradingFeeSettings): Array<{
  key: string
  value: number
  description: string
}> {
  return [
    { key: TRADING_FEE_KEYS.stakeMinUsd, value: trading.stakeMinUsd, description: 'Minimum REAL trade stake in USD.' },
    { key: TRADING_FEE_KEYS.stakeMaxUsd, value: trading.stakeMaxUsd, description: 'Maximum REAL trade stake in USD.' },
    { key: TRADING_FEE_KEYS.maxOpenTrades, value: trading.maxOpenTrades, description: 'Maximum concurrent open REAL trades per user.' },
    {
      key: TRADING_FEE_KEYS.dailyProfitLimitUsd,
      value: trading.dailyProfitLimitUsd,
      description: 'REAL trading pauses once net settled REAL profit since Africa/Nairobi midnight reaches this amount.',
    },
  ]
}
