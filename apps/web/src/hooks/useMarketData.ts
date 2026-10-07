import { useEffect, useState } from 'react'
import { useAccountMode } from '@/hooks/useAccountMode'
import { getMarketDataProvider, type MarketDataProvider } from '@/services/market-data'
import { isMarketDataProviderConfigured } from '@/providers/market-data/env'
import { getBufferedTicks, getLastReceivedAt, subscribeTickBuffer } from '@/providers/market-data/tick-buffer'
import type { Candle, ConnectionStatus, Market, MarketSnapshot, Tick, Timeframe } from '@/types'

const CHART_UNAVAILABLE = 'Chart history is temporarily unavailable. Retryingâ€¦'
const TICKS_UNAVAILABLE = 'Live ticks are temporarily unavailable. Retryingâ€¦'
const LIST_REFRESH_MS = 2_000
const QUOTE_REFRESH_MS = 20_000
/** Failed Deriv candle history is retried with backoff (2s, 4s, 8s, then every 15s). */
const HISTORY_RETRIES = 6

export function useMarkets() {
  const { kind } = useAccountMode()
  const [markets, setMarkets] = useState<Market[]>([])
  const [loading, setLoading] = useState(true)
  const [connectionStatus, setConnectionStatus] = useState<ConnectionStatus>(() =>
    getMarketDataProvider(kind).getStatus(),
  )

  useEffect(() => {
    let cancelled = false
    const provider = getMarketDataProvider(kind)
    // Drop previous mode catalog immediately to prevent DEMOâ†”REAL leakage.
    setMarkets([])
    setLoading(true)
    setConnectionStatus(provider.getStatus())

    void provider.listMarkets().then((list) => {
      if (!cancelled) {
        setMarkets(list)
        setLoading(false)
      }
    })

    const unsubStatus = provider.onConnectionStatus?.((status) => {
      if (!cancelled) setConnectionStatus(status)
    })

    // Both modes use the genuine feed. Streamed symbols update the list every few seconds; every
    // other listed symbol gets its latest Deriv quote refreshed periodically (never invented).
    const refreshList = () =>
      void provider.listMarkets().then((next) => {
        if (!cancelled && next.length > 0) setMarkets(next)
      })
    const refreshQuotes = () =>
      void provider.listMarkets().then(async (list) => {
        if (cancelled || list.length === 0 || !provider.refreshQuotes) return
        await provider.refreshQuotes(list.map((m) => m.symbol))
        refreshList()
      })
    refreshQuotes()
    const listTimer = window.setInterval(refreshList, LIST_REFRESH_MS)
    const quoteTimer = window.setInterval(refreshQuotes, QUOTE_REFRESH_MS)

    return () => {
      cancelled = true
      window.clearInterval(listTimer)
      window.clearInterval(quoteTimer)
      unsubStatus?.()
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps -- refresh on mode change only
  }, [kind])

  return {
    markets,
    loading,
    status: connectionStatus,
    kind,
    marketDataConfigured: kind === 'real' ? isMarketDataProviderConfigured() : true,
  }
}

function applyLiveCandle(
  prev: MarketSnapshot,
  update: {
    candle: { time: number; open: number; high: number; low: number; close: number }
    isFinal: boolean
    tick: MarketSnapshot['lastTick']
    bid: number | null
    ask: number | null
  },
): MarketSnapshot {
  const candles = [...prev.candles]
  const last = candles[candles.length - 1]
  if (!last) {
    return {
      ...prev,
      candles: [update.candle],
      lastTick: update.tick,
      bid: update.bid,
      ask: update.ask,
      lastUpdateAt: update.tick?.timestamp ?? Date.now(),
      status: 'live',
    }
  }

  if (update.candle.time > last.time) {
    candles.push(update.candle)
  } else if (update.candle.time === last.time) {
    candles[candles.length - 1] = update.candle
  } else {
    // Stale candle â€” ignore OHLC but still refresh tick if newer.
    return {
      ...prev,
      lastTick: update.tick ?? prev.lastTick,
      bid: update.bid ?? prev.bid,
      ask: update.ask ?? prev.ask,
      lastUpdateAt: update.tick?.timestamp ?? prev.lastUpdateAt,
    }
  }

  return {
    ...prev,
    candles,
    lastTick: update.tick,
    bid: update.bid,
    ask: update.ask,
    lastUpdateAt: update.tick?.timestamp ?? Date.now(),
    status: 'live',
    note: update.tick?.feedLabel ?? prev.note,
    feedLabel: update.tick?.feedLabel ?? prev.feedLabel,
  }
}

/** History candles plus any live candles that started after the last historical one. */
export function mergeHistoryWithLive(history: Candle[], live: Candle[]): Candle[] {
  const lastHistory = history[history.length - 1]
  if (!lastHistory) return live
  const newer = live.filter((candle) => candle.time > lastHistory.time)
  const sameBucket = live.find((candle) => candle.time === lastHistory.time)
  const base = sameBucket ? [...history.slice(0, -1), sameBucket] : history
  return [...base, ...newer]
}

/** Feed identity for effect keys: DEMO and REAL on the same genuine feed keep their subscriptions. */
function feedIdOf(provider: MarketDataProvider): string {
  return provider.feedId ?? provider.id
}

/**
 * Snapshot + live OHLC for `symbol`/`timeframe`. State is keyed by feed+symbol+timeframe so a
 * previous market's candles are never returned after a switch. `enabled=false` skips loading.
 */
export function useMarketSnapshot(symbol: string, timeframe: Timeframe, enabled = true) {
  const { kind } = useAccountMode()
  const feedId = feedIdOf(getMarketDataProvider(kind))
  const key = `${feedId}|${symbol}|${timeframe}`
  const [state, setState] = useState<{ key: string; snapshot: MarketSnapshot | null; error: string | null }>({
    key: '',
    snapshot: null,
    error: null,
  })
  const [loading, setLoading] = useState(true)
  const [connectionStatus, setConnectionStatus] = useState<ConnectionStatus>('disconnected')

  useEffect(() => {
    if (!enabled) {
      setLoading(false)
      return
    }
    let cancelled = false
    const provider = getMarketDataProvider(kind)
    setLoading(true)
    setState({ key, snapshot: null, error: null })
    const setSnapshot = (update: (prev: MarketSnapshot | null) => MarketSnapshot | null) =>
      setState((prev) => {
        const snapshot = update(prev.key === key ? prev.snapshot : null)
        const error = prev.key === key && (snapshot?.candles.length ?? 0) === 0 ? prev.error : null
        return { key, snapshot, error }
      })
    const setError = (error: string) =>
      setState((prev) => (prev.key === key && (prev.snapshot?.candles.length ?? 0) === 0 ? { ...prev, error } : prev))

    const unsubStatus = provider.onConnectionStatus?.((status) => {
      if (!cancelled) {
        setConnectionStatus(status)
        setSnapshot((prev) => (prev ? { ...prev, status } : prev))
      }
    })

    let retryTimer: number | null = null
    const retryLater = (attempt: number) => {
      if (cancelled || attempt >= HISTORY_RETRIES) return
      retryTimer = window.setTimeout(() => loadHistory(attempt + 1), Math.min(2000 * 2 ** attempt, 15_000))
    }
    const loadHistory = (attempt: number) =>
      void provider
        .getSnapshot(symbol, timeframe)
        .then((next) => {
          if (cancelled) return
          const status = provider.getStatus()
          if (next.candles.length === 0 && next.status === 'error') {
            setError(next.note ?? CHART_UNAVAILABLE)
            setLoading(false)
            retryLater(attempt)
            return
          }
          setSnapshot((prev) => ({
            ...next,
            candles: prev ? mergeHistoryWithLive(next.candles, prev.candles) : next.candles,
            lastTick: prev?.lastTick ?? next.lastTick,
            lastUpdateAt: prev?.lastUpdateAt ?? next.lastUpdateAt,
            status,
          }))
          if (next.candles.length === 0 && next.status === 'disconnected') {
            setError(next.note ?? CHART_UNAVAILABLE)
          }
          setConnectionStatus(status)
          setLoading(false)
        })
        .catch(() => {
          if (cancelled) return
          setError(CHART_UNAVAILABLE)
          setLoading(false)
          retryLater(attempt)
        })
    loadHistory(0)

    let unsubscribe: (() => void) | undefined

    if (provider.subscribeLive) {
      unsubscribe = provider.subscribeLive(symbol, timeframe, (update) => {
        if (cancelled) return
        setSnapshot((prev) => {
          if (!prev || prev.candles.length === 0) {
            return {
              status: 'live',
              candles: [update.candle],
              lastTick: update.tick,
              note: update.tick.feedLabel,
              isSimulated: false,
              feedLabel: update.tick.feedLabel,
              bid: update.bid,
              ask: update.ask,
              lastUpdateAt: update.tick.timestamp,
            }
          }
          return applyLiveCandle(prev, update)
        })
      })
    } else {
      unsubscribe = provider.subscribeTicks(symbol, (tick) => {
        if (cancelled) return
        setSnapshot((prev) => {
          if (!prev || prev.candles.length === 0) {
            return prev ? { ...prev, lastTick: tick, lastUpdateAt: tick.timestamp } : prev
          }
          const last = prev.candles[prev.candles.length - 1]!
          const candles = [
            ...prev.candles.slice(0, -1),
            {
              ...last,
              close: tick.price,
              high: Math.max(last.high, tick.price),
              low: Math.min(last.low, tick.price),
            },
          ]
          return {
            ...prev,
            candles,
            lastTick: tick,
            lastUpdateAt: tick.timestamp,
          }
        })
      })
    }

    return () => {
      cancelled = true
      if (retryTimer != null) window.clearTimeout(retryTimer)
      unsubscribe?.()
      unsubStatus?.()
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps -- keyed by feed, not account: DEMO/REAL share one feed
  }, [symbol, timeframe, feedId, enabled])

  const current = enabled && state.key === key
  const snapshot = current ? state.snapshot : null
  const error = current ? state.error : null
  return { snapshot, loading: enabled && (loading || state.key !== key), error, kind, connectionStatus }
}

/**
 * Display status for one symbol: CONNECTED only while the socket is open AND a genuine tick for
 * `symbol` arrived within `staleMs`. CONNECTING while the first tick is awaited; otherwise DISCONNECTED.
 */
export function deriveFeedStatus(input: {
  socketStatus: ConnectionStatus
  lastTickReceivedAt: number
  watchingSince: number
  now: number
  staleMs: number
}): ConnectionStatus {
  const { socketStatus, lastTickReceivedAt, watchingSince, now, staleMs } = input
  if (socketStatus === 'live') {
    if (lastTickReceivedAt > 0 && now - lastTickReceivedAt <= staleMs) return 'live'
    return now - watchingSince <= staleMs && lastTickReceivedAt < watchingSince ? 'connecting' : 'disconnected'
  }
  if (socketStatus === 'connecting') return 'connecting'
  return 'disconnected'
}

export function useLiveFeedStatus(symbol: string, socketStatus: ConnectionStatus, staleMs = 10_000) {
  const [now, setNow] = useState(() => Date.now())
  const [since, setSince] = useState<{ symbol: string; at: number }>(() => ({ symbol, at: Date.now() }))
  if (since.symbol !== symbol) setSince({ symbol, at: now })

  useEffect(() => {
    const timer = window.setInterval(() => setNow(Date.now()), 1000)
    return () => window.clearInterval(timer)
  }, [])

  return deriveFeedStatus({
    socketStatus,
    lastTickReceivedAt: getLastReceivedAt(symbol),
    watchingSince: since.symbol === symbol ? since.at : now,
    now,
    staleMs,
  })
}

/**
 * Genuine tick series for `symbol`: backfilled from provider history, then extended with live ticks.
 * Returns an empty list (never invented data) when the feed is unavailable.
 */
export function useTickStream(symbol: string, historyCount = 1000) {
  const { kind } = useAccountMode()
  const feedId = feedIdOf(getMarketDataProvider(kind))
  const [state, setState] = useState<{ symbol: string; ticks: Tick[] }>(() => ({
    symbol,
    ticks: symbol ? getBufferedTicks(symbol) : [],
  }))
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    const setTicks = (next: Tick[]) => setState({ symbol, ticks: next })
    if (!symbol) {
      setTicks([])
      setLoading(false)
      return
    }
    let cancelled = false
    const provider = getMarketDataProvider(kind)
    const initial = getBufferedTicks(symbol)
    setTicks(initial)
    setError(null)
    setLoading(initial.length === 0)

    let pending: Tick[] | null = null
    let frame: number | null = null
    const unsubBuffer = subscribeTickBuffer(symbol, (next) => {
      pending = next
      if (frame != null) return
      frame = window.requestAnimationFrame(() => {
        frame = null
        if (!cancelled && pending) {
          setTicks(pending)
          setLoading(false)
        }
      })
    })
    const unsubTicks = provider.subscribeTicks(symbol, () => undefined)

    if (provider.getTickHistory) {
      provider
        .getTickHistory(symbol, historyCount)
        .then((history) => {
          if (cancelled) return
          setTicks(getBufferedTicks(symbol))
          setLoading(false)
          if (history.length === 0) setError(TICKS_UNAVAILABLE)
        })
        .catch(() => {
          if (cancelled) return
          setLoading(false)
          setError(TICKS_UNAVAILABLE)
        })
    } else {
      setLoading(false)
    }

    return () => {
      cancelled = true
      if (frame != null) window.cancelAnimationFrame(frame)
      unsubBuffer()
      unsubTicks()
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps -- keyed by feed, not account: DEMO/REAL share one feed
  }, [symbol, feedId, historyCount])

  // Never hand out the previous symbol's ticks during the render before the effect re-keys state.
  const ticks = state.symbol === symbol ? state.ticks : EMPTY_TICKS
  return { ticks, loading: loading || state.symbol !== symbol, error }
}

const EMPTY_TICKS: Tick[] = []
