import type { ContractOption, ContractType, Trade } from '@/types'

/**
 * DEMO bot strategies: deterministic rules over recent genuine tick digits.
 * They make no claim of an edge — digit outcomes on synthetic indices are random.
 */

export type BotDecision = {
  contractType: ContractType
  contractOption: ContractOption
  selectedDigit: number | null
  barrier: number | null
}

export const BOT_MIN_DIGITS = 5
export const BOT_TRADE_DURATION_MS = 15_000

export const BOT_STRATEGY_RULES: Record<string, string> = {
  'parity-filter': 'EVEN/ODD — backs the parity that appeared less often in the last 20 live digits.',
  'range-anchor': 'OVER/UNDER — UNDER 7 when the last 20 digits average 4.5 or more, otherwise OVER 2.',
  'digit-gate': 'MATCH/DIFFER — DIFFERS from the most recent live digit.',
  'pulse-window': 'EVEN/ODD — follows the parity of the most recent live digit.',
  'drift-watch': 'OVER/UNDER — always UNDER 6.',
  'breakout-rail': 'OVER/UNDER — always OVER 3.',
}

export function decideBotContract(botId: string, digits: number[]): BotDecision | null {
  if (digits.length < BOT_MIN_DIGITS) return null
  const recent = digits.slice(-20)
  const last = digits[digits.length - 1]!
  switch (botId) {
    case 'parity-filter': {
      const even = recent.filter((d) => d % 2 === 0).length
      const odd = recent.length - even
      return { contractType: 'EVEN_ODD', contractOption: even < odd ? 'even' : 'odd', selectedDigit: null, barrier: null }
    }
    case 'range-anchor': {
      const mean = recent.reduce((sum, d) => sum + d, 0) / recent.length
      return mean >= 4.5
        ? { contractType: 'OVER_UNDER', contractOption: 'under', selectedDigit: null, barrier: 7 }
        : { contractType: 'OVER_UNDER', contractOption: 'over', selectedDigit: null, barrier: 2 }
    }
    case 'digit-gate':
      return { contractType: 'MATCH_DIFFER', contractOption: 'differ', selectedDigit: last, barrier: null }
    case 'pulse-window':
      return {
        contractType: 'EVEN_ODD',
        contractOption: last % 2 === 0 ? 'even' : 'odd',
        selectedDigit: null,
        barrier: null,
      }
    case 'drift-watch':
      return { contractType: 'OVER_UNDER', contractOption: 'under', selectedDigit: null, barrier: 6 }
    case 'breakout-rail':
      return { contractType: 'OVER_UNDER', contractOption: 'over', selectedDigit: null, barrier: 3 }
    default:
      return null
  }
}

export type BotProgress = {
  tradesPlaced: number
  openTrades: number
  wins: number
  losses: number
  realizedPnl: number
  lossStreak: number
}

/** Aggregate a bot run's own trades (oldest → newest by resolution). */
export function botProgress(trades: Trade[]): BotProgress {
  const settled = trades
    .filter((t) => t.status !== 'open')
    .sort(
      (a, b) =>
        new Date(a.resolvedAt ?? a.updatedAt).getTime() - new Date(b.resolvedAt ?? b.updatedAt).getTime(),
    )
  let wins = 0
  let losses = 0
  let pnl = 0
  let lossStreak = 0
  for (const trade of settled) {
    pnl += trade.profitLoss ?? 0
    if (trade.status === 'won') {
      wins += 1
      lossStreak = 0
    } else if (trade.status === 'lost') {
      losses += 1
      lossStreak += 1
    }
  }
  return {
    tradesPlaced: trades.length,
    openTrades: trades.length - settled.length,
    wins,
    losses,
    realizedPnl: Math.round(pnl * 100) / 100,
    lossStreak,
  }
}

export type BotLimits = {
  maxRuns: number
  takeProfit: number | null
  stopLoss: number | null
  lossStreakLimit: number
}

/** Reason the run must stop, or null to keep going. Evaluated only with no open trade. */
export function evaluateBotStop(progress: BotProgress, limits: BotLimits): string | null {
  if (limits.takeProfit != null && limits.takeProfit > 0 && progress.realizedPnl >= limits.takeProfit) {
    return `Take profit reached (${progress.realizedPnl.toFixed(2)})`
  }
  if (limits.stopLoss != null && limits.stopLoss > 0 && progress.realizedPnl <= -limits.stopLoss) {
    return `Stop loss reached (${progress.realizedPnl.toFixed(2)})`
  }
  if (limits.lossStreakLimit > 0 && progress.lossStreak >= limits.lossStreakLimit) {
    return `Loss streak limit reached (${progress.lossStreak})`
  }
  if (progress.tradesPlaced >= limits.maxRuns) {
    return `Max runs completed (${progress.tradesPlaced})`
  }
  return null
}
