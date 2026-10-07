import { calculateTradeResult, contractKindOf, isValidDigit, selectionTarget } from '@/domain/digit-contracts'
import type { Trade } from '@/types'

export type SettledResult = 'WIN' | 'LOSS' | 'REFUNDED' | 'OPEN'

/**
 * WIN / LOSS of a trade for history, P/L summaries and Auto Trade.
 * Uses the same natural contract rules as DEMO/REAL settlement when the exit digit is present.
 * Falls back to the stored settlement status only when the exit digit is missing (old rows).
 */
export function settledResult(
  trade: Pick<Trade, 'status' | 'contractType' | 'contractOption' | 'selectedDigit' | 'barrier' | 'exitDigit'>,
): SettledResult {
  if (trade.status === 'open') return 'OPEN'
  if (trade.status === 'cancelled' || trade.status === 'tie') return 'REFUNDED'
  if (isValidDigit(trade.exitDigit)) {
    const kind = contractKindOf(trade.contractOption)
    const target = selectionTarget({
      contractType: trade.contractType,
      contractOption: trade.contractOption,
      selectedDigit: trade.selectedDigit,
      barrier: trade.barrier,
    })
    return calculateTradeResult(kind, target, trade.exitDigit)
  }
  return trade.status === 'won' ? 'WIN' : 'LOSS'
}
