import { effectiveWinRate } from '@/domain/admin-panel'
import { normalizePipSize } from '@/domain/digit-contracts'
import { settleDigitContract } from './settle'

/** DEMO and Practice outcomes are set to win this share of the time. */
export const DEMO_WIN_RATE = 0.95

type DemoContract = {
  contractType?: string
  contractOption?: string
  selectedDigit?: number | null
  barrier?: number | null
}

function digitsWhere(contract: DemoContract, outcome: 'won' | 'lost'): number[] {
  const digits: number[] = []
  for (let digit = 0; digit <= 9; digit += 1) {
    if (settleDigitContract({ ...contract, exitPrice: 0, exitDigit: digit }) === outcome) digits.push(digit)
  }
  return digits
}

/** Effective rate for a user: per-user override, then the global setting, then DEMO_WIN_RATE. Values are 0..1. */
export function resolveWinRate(override: unknown, global: unknown): number {
  return effectiveWinRate(override, global, DEMO_WIN_RATE)
}

/**
 * Exit digit for a DEMO trade: wins with probability `winRate` (0..1, default DEMO_WIN_RATE).
 * Keeps the natural digit when it already gives the chosen outcome; falls back to it when no digit can.
 */
export function demoExitDigit(
  contract: DemoContract,
  naturalDigit: number,
  random: () => number = Math.random,
  winRate: number = DEMO_WIN_RATE,
): number {
  const rate = Number.isFinite(winRate) ? Math.min(1, Math.max(0, winRate)) : DEMO_WIN_RATE
  const outcome = random() < rate ? 'won' : 'lost'
  const candidates = digitsWhere(contract, outcome)
  if (candidates.length === 0 || candidates.includes(naturalDigit)) return naturalDigit
  return candidates[Math.floor(random() * candidates.length)] ?? naturalDigit
}

/** The price with its final pip digit replaced, so the shown exit price matches the exit digit. */
export function priceWithLastDigit(price: number, pipSize: number | null | undefined, digit: number): number {
  const pip = normalizePipSize(pipSize ?? 0)
  const decimals = Math.max(0, Math.round(-Math.log10(pip)))
  const units = Math.round(Math.abs(price) / pip)
  const adjusted = units - (units % 10) + digit
  const value = Number((adjusted * pip).toFixed(decimals))
  return price < 0 ? -value : value
}
