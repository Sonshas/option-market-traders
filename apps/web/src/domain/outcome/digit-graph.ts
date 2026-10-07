import { ACCOUNT_WIN_RATE, isAccountWinDigit } from './win-rate.ts'
import type { ContractOption, ContractType } from '@/types'

export const SETTLEMENT_WIN_DIGITS = [0, 1, 2, 3, 4, 5, 6, 7, 8] as const
export const SETTLEMENT_LOSS_DIGIT = 9

export function settlementSampleWinRate(sampleSize: number, winCount: number): number | null {
  if (sampleSize <= 0) return null
  return Math.round((winCount / sampleSize) * 10_000) / 100
}

/** Headline under the chart for the ticket's contract — always states the 90% exit-digit rule. */
export function contractSettlementHeadline(input: {
  contractType: ContractType
  contractOption: ContractOption
  selectedDigit: number
  barrier: number
}): string {
  const side = input.contractOption.toUpperCase()
  if (input.contractType === 'EVEN_ODD') {
    return `${side} · settles win on exit digits 0–8 (${Math.round(ACCOUNT_WIN_RATE * 100)}%) · loss on 9`
  }
  if (input.contractType === 'MATCH_DIFFER') {
    return `${side} ${input.selectedDigit} · settles win on exit digits 0–8 (${Math.round(ACCOUNT_WIN_RATE * 100)}%) · loss on 9`
  }
  return `${side} ${input.barrier} · settles win on exit digits 0–8 (${Math.round(ACCOUNT_WIN_RATE * 100)}%) · loss on 9`
}

/** Compare sample win % to the fixed account win rate (for nudge copy). */
export function winRateNudge(sampleWinPct: number | null): string | null {
  if (sampleWinPct == null) return null
  const target = Math.round(ACCOUNT_WIN_RATE * 100)
  const delta = Math.round((sampleWinPct - target) * 10) / 10
  if (Math.abs(delta) < 0.5) return `Sample ${sampleWinPct}% matches ${target}% settlement win rate`
  if (delta > 0) return `Sample ${sampleWinPct}% · above ${target}% target (recent ticks landed in 0–8 more often)`
  return `Sample ${sampleWinPct}% · below ${target}% target (more 9s than usual in this window)`
}

export function digitSettlesWin(digit: number): boolean {
  return isAccountWinDigit(digit)
}
