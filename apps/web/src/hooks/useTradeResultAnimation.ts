import { useEffect, useState, useSyncExternalStore } from 'react'
import { digitOfTick } from '@/domain/digit-stats'
import { createTradeResultAnimator, type TradeResultAnimationState } from '@/features/trading/trade-result-animation'
import type { AccountMode, Tick, Trade } from '@/types'

/**
 * Digit-strip animation for the most recently placed trade of the current account mode (DEMO or REAL).
 * `trades` are that mode's open + settled trades; `ticks` the live ticks of the market shown on the strip.
 */
export function useTradeResultAnimation({
  kind,
  trades,
  ticks,
  symbol,
}: {
  kind: AccountMode
  trades: readonly Trade[]
  ticks: readonly Tick[]
  symbol: string
}): TradeResultAnimationState {
  const [animator] = useState(() => createTradeResultAnimator())
  const latestTick = ticks.length > 0 ? ticks[ticks.length - 1]! : null
  const pipSize = latestTick?.pipSize ?? null

  useEffect(() => () => animator.dispose(), [animator])

  useEffect(() => {
    animator.setAccountMode(kind)
  }, [animator, kind])

  useEffect(() => {
    if (!latestTick || latestTick.isSimulated) return
    animator.observeDigit(symbol, digitOfTick(latestTick))
  }, [animator, latestTick, symbol])

  useEffect(() => {
    animator.syncTrades(trades, { pipSizeFor: (market) => (market === symbol ? pipSize : null) })
  }, [animator, trades, symbol, pipSize])

  return useSyncExternalStore(animator.subscribe, animator.getState, animator.getState)
}
