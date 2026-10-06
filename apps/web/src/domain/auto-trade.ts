import { REAL_STAKE_MAX, validateRealStake } from '@/domain/digit-contracts'
import type { BotProgress } from '@/domain/bot-strategies'
import type { TradeStatus } from '@/types'

/**
 * Auto Trade strategy rules shared by the DEMO and REAL executors. Volatility, contract, side and digit are never
 * chosen here: every order copies the loaded prediction (see orderFromPrediction in domain/prediction).
 */

export type AutoAccount = 'DEMO' | 'REAL'

export const AUTO_TRADE_DEFAULTS = {
  targetProfit: 20,
  stopLoss: 50,
  multiplier: 2,
  maxLossStreak: 6,
  maxStake: 500,
} as const
export const AUTO_MAX_TRADES_LIMIT = 1000
/** Safety stops not shown in the panel; a run still stops on each of them. */
export const AUTO_HIDDEN_DEFAULTS = {
  maxTrades: AUTO_MAX_TRADES_LIMIT,
  stopOnInsufficientBalance: true,
} as const
export const AUTO_MULTIPLIER_MIN = 1
export const AUTO_MULTIPLIER_MAX = 3
/** DEMO stakes below this are rejected. */
export const AUTO_MIN_STAKE = 0.5
export const REAL_AUTO_CONFIRM_TEXT =
  'Auto Trade will place real-money trades from your REAL balance until you stop it or a limit is hit.'

export interface AutoTradeSettings {
  account: AutoAccount
  durationTicks: number
  baseStake: number
  maxTrades: number
  targetProfit: number
  stopLoss: number
  stopOnInsufficientBalance: boolean
  multiplier: number
  maxLossStreak: number
  maxStake: number
}

function round2(value: number): number {
  return Math.round(value * 100) / 100
}

/** Stake after a settled trade: loss → last × multiplier, win → base, refund/tie → unchanged. */
export function nextAutoStake(
  lastStake: number,
  lastOutcome: Exclude<TradeStatus, 'open'> | null,
  settings: Pick<AutoTradeSettings, 'baseStake' | 'multiplier'>,
): number {
  if (lastOutcome == null || lastOutcome === 'won') return round2(settings.baseStake)
  if (lastOutcome === 'lost') return round2(lastStake * settings.multiplier)
  return round2(lastStake)
}

/**
 * Stake for the next trade. With "stop on insufficient balance" off, a Martingale stake the balance cannot
 * cover falls back to the base stake (evaluateAutoStop still stops if even that is unaffordable).
 */
export function resolveAutoStake(
  nextStake: number,
  balance: number,
  settings: Pick<AutoTradeSettings, 'baseStake' | 'stopOnInsufficientBalance'>,
): number {
  if (!settings.stopOnInsufficientBalance && nextStake > balance && settings.baseStake <= balance) {
    return round2(settings.baseStake)
  }
  return nextStake
}

/** Settings problem that prevents starting, or null. */
export function validateAutoSettings(settings: AutoTradeSettings): string | null {
  if (settings.account === 'REAL') {
    const stakeError = validateRealStake(settings.baseStake)
    if (stakeError) return stakeError
    if (settings.maxStake > REAL_STAKE_MAX) return `Max stake for REAL is $${REAL_STAKE_MAX}.`
  } else if (!Number.isFinite(settings.baseStake) || settings.baseStake < AUTO_MIN_STAKE) {
    return `Base stake must be at least $${AUTO_MIN_STAKE.toFixed(2)}.`
  }
  if (!Number.isInteger(settings.maxTrades) || settings.maxTrades < 1 || settings.maxTrades > AUTO_MAX_TRADES_LIMIT) {
    return `Number of trades must be between 1 and ${AUTO_MAX_TRADES_LIMIT}.`
  }
  if (!(settings.targetProfit > 0)) return 'Target profit must be greater than zero.'
  if (!(settings.stopLoss > 0)) return 'Stop loss must be greater than zero.'
  if (
    !Number.isFinite(settings.multiplier) ||
    settings.multiplier < AUTO_MULTIPLIER_MIN ||
    settings.multiplier > AUTO_MULTIPLIER_MAX
  ) {
    return `Multiplier must be between ×${AUTO_MULTIPLIER_MIN} and ×${AUTO_MULTIPLIER_MAX}.`
  }
  if (!Number.isInteger(settings.maxLossStreak) || settings.maxLossStreak < 1) {
    return 'Max consecutive losses must be at least 1.'
  }
  if (!(settings.maxStake >= settings.baseStake)) return 'Max stake must be at least the base stake.'
  return null
}

/**
 * Reason the session must stop before the next trade, or null to continue. Evaluated only while no session
 * trade is open. The server still enforces REAL stake limits, the open-trade cap, the daily cap and balance.
 */
export function evaluateAutoStop(
  progress: Pick<BotProgress, 'realizedPnl' | 'lossStreak'> & { tradesPlaced?: number },
  nextStake: number,
  availableBalance: number,
  settings: Pick<AutoTradeSettings, 'targetProfit' | 'stopLoss' | 'maxLossStreak' | 'maxStake'> &
    Partial<Pick<AutoTradeSettings, 'account' | 'maxTrades'>>,
): string | null {
  const account = settings.account ?? 'DEMO'
  if (progress.realizedPnl >= settings.targetProfit) {
    return `Target profit reached (+$${progress.realizedPnl.toFixed(2)})`
  }
  if (progress.realizedPnl <= -settings.stopLoss) {
    return `Stop loss reached (−$${Math.abs(progress.realizedPnl).toFixed(2)})`
  }
  if (progress.lossStreak >= settings.maxLossStreak) {
    return `${progress.lossStreak} losses in a row — safety stop`
  }
  if (settings.maxTrades != null && (progress.tradesPlaced ?? 0) >= settings.maxTrades) {
    return `Completed ${progress.tradesPlaced} of ${settings.maxTrades} trades`
  }
  if (nextStake > settings.maxStake) {
    return `Next stake $${nextStake.toFixed(2)} is above the max stake $${settings.maxStake.toFixed(2)}`
  }
  if (account === 'REAL' && nextStake > REAL_STAKE_MAX) {
    return `Next stake $${nextStake.toFixed(2)} is above the REAL limit of $${REAL_STAKE_MAX}`
  }
  if (nextStake > availableBalance) {
    return `Balance too low for the next $${nextStake.toFixed(2)} stake`
  }
  return null
}
