import { useEffect, useState } from 'react'
import { getMarketDataProvider } from '@/services/market-data'
import { getBufferedTicks, subscribeTickBuffer } from '@/providers/market-data/tick-buffer'
import type { ConnectionStatus, Market, Tick } from '@/types'

/**
 * Public landing-page feed: genuine Deriv ticks for the first few synthetic markets.
 * Nothing is synthesised — symbols without ticks simply stay empty.
 */
export function useLiveTicker(limit = 8, historyCount = 120) {
  const [markets, setMarkets] = useState<Market[]>([])
  const [ticks, setTicks] = useState<Record<string, Tick[]>>({})
  const [status, setStatus] = useState<ConnectionStatus>(() => getMarketDataProvider('demo').getStatus())
  const [settled, setSettled] = useState(false)

  useEffect(() => {
    const provider = getMarketDataProvider('demo')
    let cancelled = false
    const cleanups: Array<() => void> = []
    const pending: Record<string, Tick[]> = {}
    let timer: number | null = null

    const flush = () => {
      timer = null
      if (cancelled) return
      const batch = { ...pending }
      for (const key of Object.keys(pending)) delete pending[key]
      setTicks((prev) => ({ ...prev, ...batch }))
    }
    const queue = (symbol: string, next: Tick[], delay: number) => {
      pending[symbol] = next.slice(-historyCount)
      if (timer == null) timer = window.setTimeout(flush, delay)
    }

    const unsubStatus = provider.onConnectionStatus?.((next) => {
      if (!cancelled) setStatus(next)
    })

    provider
      .listMarkets()
      .then((list) => {
        if (cancelled) return
        const real = list.filter((m) => !m.isSimulated)
        setMarkets(real)
        setSettled(true)
        for (const market of real.slice(0, limit)) {
          const { symbol } = market
          cleanups.push(subscribeTickBuffer(symbol, (next) => queue(symbol, next, 600)))
          cleanups.push(provider.subscribeTicks(symbol, () => undefined))
          provider
            .getTickHistory?.(symbol, historyCount)
            .then(() => {
              if (!cancelled) queue(symbol, getBufferedTicks(symbol), 0)
            })
            .catch(() => undefined)
        }
      })
      .catch(() => {
        if (!cancelled) setSettled(true)
      })

    return () => {
      cancelled = true
      if (timer != null) window.clearTimeout(timer)
      for (const cleanup of cleanups) cleanup()
      unsubStatus?.()
    }
  }, [limit, historyCount])

  return { markets, ticks, status, settled }
}

export function changePctOf(ticks: Tick[] | undefined): number | null {
  if (!ticks || ticks.length < 2) return null
  const first = ticks[0]!.price
  if (!first) return null
  return ((ticks[ticks.length - 1]!.price - first) / first) * 100
}
