import { calculateTradeResult, contractKindOf, isValidDigit } from '@/domain/digit-contracts'
import type { Trade } from '@/types'

export type SettledResult = 'WIN' | 'LOSS' | 'REFUNDED' | 'OPEN'

/**
 * WIN / LOSS of a trade for history, P/L summaries and Auto Trade, from calculateTradeResult on the settled exit
 * digit. Falls back to the stored settlement status only when the exit digit or target is missing (old rows).
 */
export function settledResult(
  trade: Pick<Trade, 'status' | 'contractType' | 'contractOption' | 'selectedDigit' | 'barrier' | 'exitDigit'>,
): SettledResult {
  if (trade.status === 'open') return 'OPEN'
  if (trade.status === 'cancelled' || trade.status === 'tie') return 'REFUNDED'
  const target =
    trade.contractType === 'MATCH_DIFFER' ? trade.selectedDigit : trade.contractType === 'OVER_UNDER' ? trade.barrier : null
  const needsTarget = trade.contractType !== 'EVEN_ODD'
  if (isValidDigit(trade.exitDigit) && (!needsTarget || isValidDigit(target))) {
    return calculateTradeResult(contractKindOf(trade.contractOption), target ?? null, trade.exitDigit)
  }
  return trade.status === 'won' ? 'WIN' : 'LOSS'
}
