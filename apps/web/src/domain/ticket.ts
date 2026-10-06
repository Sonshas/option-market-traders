import {
  contractCanWin,
  digitPayoutRate,
  nominalTickIntervalMs,
  potentialPayout,
  type DigitContractSelection,
} from '@/domain/digit-contracts'
import type { Trade } from '@/types'

function money(value: number): string {
  return `$${value.toFixed(2)}`
}

/** "Payout $19.00" for a direction button; contracts that cannot win say so. */
export function directionPayoutLabel(stake: number, selection: DigitContractSelection): string {
  if (!contractCanWin(selection)) return 'Payout $0.00 · cannot win'
  if (!Number.isFinite(stake) || stake <= 0) return 'Payout —'
  return `Payout ${money(potentialPayout(stake, selection))}`
}

/** Ticket payout line, e.g. "$19.00 USD • 90.00%" (profit rate on a win). */
export function payoutSummary(stake: number, selection: DigitContractSelection): string {
  if (!contractCanWin(selection)) return '$0.00 USD • cannot win'
  if (!Number.isFinite(stake) || stake <= 0) return '— USD'
  return `${money(potentialPayout(stake, selection))} USD • ${(digitPayoutRate(selection) * 100).toFixed(2)}%`
}

/** Median spacing (ms) between consecutive genuine ticks, or null with fewer than 3 ticks. */
export function observedTickSpacingMs(epochsMs: readonly number[]): number | null {
  if (epochsMs.length < 3) return null
  const gaps: number[] = []
  for (let i = 1; i < epochsMs.length; i += 1) {
    const gap = epochsMs[i]! - epochsMs[i - 1]!
    if (gap > 0) gaps.push(gap)
  }
  if (gaps.length < 2) return null
  gaps.sort((a, b) => a - b)
  return gaps[Math.floor(gaps.length / 2)]!
}

/** Per-market tick hint; never claims 1 second where Deriv ticks every 2. */
export function tickHint(symbol: string, recentEpochsMs: readonly number[] = []): string {
  const nominal = nominalTickIntervalMs(symbol)
  if (nominal === 1_000) return 'Each tick ≈ 1 second'
  if (nominal === 2_000) return 'Each tick ≈ 2 seconds'
  const observed = observedTickSpacingMs(recentEpochsMs.slice(-50))
  if (observed == null) return 'Tick spacing depends on the market'
  const seconds = Math.max(1, Math.round(observed / 1000))
  return `Each tick is about ${seconds} second${seconds === 1 ? '' : 's'}`
}

/** Ticks still to come for an open tick contract (display only), or null for legacy time-based trades. */
export function ticksRemaining(trade: Pick<Trade, 'durationTicks' | 'tickAnchorMs'>, epochsMs: readonly number[]): number | null {
  if (trade.durationTicks == null || trade.tickAnchorMs == null) return null
  const anchor = trade.tickAnchorMs
  let seen = 0
  for (const epoch of epochsMs) if (epoch > anchor) seen += 1
  return Math.max(0, trade.durationTicks - seen)
}

export function clampTicks(value: number, min: number, max: number): number {
  if (!Number.isFinite(value)) return min
  return Math.min(max, Math.max(min, Math.round(value)))
}
