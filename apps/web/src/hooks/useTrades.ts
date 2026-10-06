import { useEffect, useState } from 'react'
import { loadDemoState, subscribeDemoStore } from '@/lib/demo-store'
import { subscribeRealWalletChanged } from '@/lib/real-wallet-events'
import { settleDemoTrades } from '@/providers/trading/demo-trading-provider'
import { tradeService } from '@/services/trades'
import type { AccountMode, Trade } from '@/types'

function readDemoTrades(): { open: Trade[]; history: Trade[] } {
  const trades = loadDemoState().trades
  return {
    open: trades.filter((trade) => trade.status === 'open'),
    history: trades.filter((trade) => trade.status !== 'open'),
  }
}

export function useTrades(kind: AccountMode) {
  const [open, setOpen] = useState<Trade[]>(() => (kind === 'demo' ? readDemoTrades().open : []))
  const [history, setHistory] = useState<Trade[]>(() => (kind === 'demo' ? readDemoTrades().history : []))
  const [loading, setLoading] = useState(kind === 'real')
  const [message, setMessage] = useState('')
  const [, setTick] = useState(0)
  const [realRefreshKey, setRealRefreshKey] = useState(0)

  useEffect(() => {
    if (kind !== 'real') return
    return subscribeRealWalletChanged(() => setRealRefreshKey((key) => key + 1))
  }, [kind])

  useEffect(() => {
    // Clear immediately on mode switch so DEMO rows never flash inside REAL (and vice versa).
    setOpen([])
    setHistory([])
    setMessage('')

    if (kind === 'demo') {
      setLoading(false)
      const refresh = () => {
        const next = readDemoTrades()
        setOpen(next.open)
        setHistory(next.history)
      }
      refresh()
      const unsubscribe = subscribeDemoStore(refresh)
      const timer = window.setInterval(() => {
        settleDemoTrades()
        setTick((value) => value + 1)
      }, 1000)
      return () => {
        unsubscribe()
        window.clearInterval(timer)
      }
    }
  }, [kind])

  useEffect(() => {
    if (kind !== 'real') return
    let cancelled = false
    if (realRefreshKey === 0) setLoading(true)
    void Promise.all([tradeService.listOpen('real'), tradeService.listHistory('real')]).then(
      ([openResult, historyResult]) => {
        if (!cancelled) {
          setOpen(openResult.data)
          setHistory(historyResult.data)
          setMessage(openResult.message)
          setLoading(false)
        }
      },
    )
    return () => {
      cancelled = true
    }
  }, [kind, realRefreshKey])

  // REAL countdowns re-render every second while a trade is open.
  const hasRealOpen = kind === 'real' && open.length > 0
  useEffect(() => {
    if (!hasRealOpen) return
    const timer = window.setInterval(() => setTick((value) => value + 1), 1000)
    return () => window.clearInterval(timer)
  }, [hasRealOpen])

  return {
    open,
    history,
    loading: kind === 'demo' ? false : loading,
    message: kind === 'demo' ? 'DEMO trades — simulated practice only.' : message,
  }
}
