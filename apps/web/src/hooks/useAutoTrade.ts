import { useEffect, useState } from 'react'
import { getAutoTradeSnapshot, subscribeAutoTrade, type AutoTradeSnapshot } from '@/providers/bots/auto-trader'

/** Live Auto Trade run (DEMO or REAL) and its progress. */
export function useAutoTrade(): AutoTradeSnapshot {
  const [snapshot, setSnapshot] = useState(getAutoTradeSnapshot)
  useEffect(() => {
    const refresh = () => setSnapshot(getAutoTradeSnapshot())
    refresh()
    return subscribeAutoTrade(refresh)
  }, [])
  return snapshot
}
