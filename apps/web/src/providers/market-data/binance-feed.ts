import type { Candle, ConnectionStatus, Tick, Timeframe } from '@/types'
import {
  getMarketDataApiUrl,
  getMarketDataWsUrl,
  REAL_FEED_LABEL,
} from '@/providers/market-data/env'
import { toBinanceInterval } from '@/providers/market-data/binance-symbols'

export type LiveCandleHandler = (update: {
  candle: Candle
  isFinal: boolean
  tick: Tick
  bid: number | null
  ask: number | null
}) => void

export type StatusHandler = (status: ConnectionStatus, detail?: string) => void

type StreamKey = string

function streamKey(symbol: string, timeframe: Timeframe): StreamKey {
  return `${symbol.toUpperCase()}::${timeframe}`
}

function klineStream(symbol: string, interval: string): string {
  return `${symbol.toLowerCase()}@kline_${interval}`
}

function bookTickerStream(symbol: string): string {
  return `${symbol.toLowerCase()}@bookTicker`
}

function backoffMs(attempt: number): number {
  return Math.min(30_000, 1000 * 2 ** Math.min(attempt, 5))
}

/**
 * Multiplexed Binance public WS + REST helper.
 * One socket; subscribe/unsubscribe streams; exponential reconnect; no parallel loops.
 */
export class BinanceMarketFeed {
  private ws: WebSocket | null = null
  private status: ConnectionStatus = 'disconnected'
  private statusDetail = ''
  private reconnectAttempt = 0
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null
  private intentionalClose = false
  private connecting = false
  private nextId = 1
  private readonly candleHandlers = new Map<StreamKey, Set<LiveCandleHandler>>()
  private readonly statusHandlers = new Set<StatusHandler>()
  private readonly activeStreams = new Set<string>()
  private readonly lastPrices = new Map<string, number>()
  private readonly lastBidAsk = new Map<string, { bid: number | null; ask: number | null }>()
  private lastMessageAt: number | null = null
  private receivedLiveData = false

  getStatus(): ConnectionStatus {
    return this.status
  }

  getStatusDetail(): string {
    return this.statusDetail
  }

  getLastMessageAt(): number | null {
    return this.lastMessageAt
  }

  hasReceivedLiveData(): boolean {
    return this.receivedLiveData
  }

  getLastPrices(): Map<string, number> {
    return new Map(this.lastPrices)
  }

  getBidAsk(symbol: string): { bid: number | null; ask: number | null } {
    return this.lastBidAsk.get(symbol.toUpperCase()) ?? { bid: null, ask: null }
  }

  onStatus(handler: StatusHandler): () => void {
    this.statusHandlers.add(handler)
    handler(this.status, this.statusDetail)
    return () => {
      this.statusHandlers.delete(handler)
    }
  }

  private setStatus(next: ConnectionStatus, detail = '') {
    this.status = next
    this.statusDetail = detail
    for (const handler of this.statusHandlers) handler(next, detail)
  }

  async fetchKlines(symbol: string, timeframe: Timeframe, limit = 200): Promise<Candle[]> {
    const interval = toBinanceInterval(timeframe)
    if (!interval) {
      throw new Error(`Unsupported REAL timeframe: ${timeframe}`)
    }
    const base = getMarketDataApiUrl().replace(/\/$/, '')
    const url = `${base}/market-data/klines?symbol=${encodeURIComponent(symbol.toUpperCase())}&interval=${encodeURIComponent(interval)}&limit=${limit}`
    const res = await fetch(url)
    if (!res.ok) {
      const body = await res.text().catch(() => '')
      throw new Error(`Klines request failed (${res.status}): ${body || res.statusText}`)
    }
    const payload = (await res.json()) as {
      candles?: Array<{ time: number; open: number; high: number; low: number; close: number }>
      error?: string
    }
    if (!payload.candles || !Array.isArray(payload.candles)) {
      throw new Error(payload.error || 'Invalid klines response')
    }
    const candles = payload.candles
      .filter(
        (c) =>
          Number.isFinite(c.time) &&
          Number.isFinite(c.open) &&
          Number.isFinite(c.high) &&
          Number.isFinite(c.low) &&
          Number.isFinite(c.close),
      )
      .map((c) => ({
        time: c.time,
        open: c.open,
        high: c.high,
        low: c.low,
        close: c.close,
      }))
    if (candles.length === 0) {
      throw new Error('Empty klines response')
    }
    const last = candles[candles.length - 1]!
    this.lastPrices.set(symbol.toUpperCase(), last.close)
    return candles
  }

  subscribeLive(
    symbol: string,
    timeframe: Timeframe,
    onUpdate: LiveCandleHandler,
  ): () => void {
    const interval = toBinanceInterval(timeframe)
    if (!interval) {
      this.setStatus('error', `Unsupported timeframe ${timeframe}`)
      return () => undefined
    }

    const key = streamKey(symbol, timeframe)
    let set = this.candleHandlers.get(key)
    if (!set) {
      set = new Set()
      this.candleHandlers.set(key, set)
    }
    const isFirstForKey = set.size === 0
    set.add(onUpdate)

    const streams = [klineStream(symbol, interval), bookTickerStream(symbol)]
    for (const stream of streams) this.activeStreams.add(stream)

    this.ensureSocket()
    if (isFirstForKey) this.sendSubscribe(streams)

    return () => {
      const handlers = this.candleHandlers.get(key)
      if (!handlers) return
      handlers.delete(onUpdate)
      if (handlers.size > 0) return

      this.candleHandlers.delete(key)

      const symbolUpper = symbol.toUpperCase()
      const stillUsesSymbol = [...this.candleHandlers.keys()].some((k) =>
        k.startsWith(`${symbolUpper}::`),
      )
      const stillUsesKline = [...this.candleHandlers.keys()].some((k) => {
        const [sym, tf] = k.split('::')
        return sym === symbolUpper && tf === timeframe
      })

      const toUnsub: string[] = []
      if (!stillUsesKline) {
        toUnsub.push(klineStream(symbol, interval))
        this.activeStreams.delete(klineStream(symbol, interval))
      }
      if (!stillUsesSymbol) {
        toUnsub.push(bookTickerStream(symbol))
        this.activeStreams.delete(bookTickerStream(symbol))
      }
      if (toUnsub.length) this.sendUnsubscribe(toUnsub)

      if (this.candleHandlers.size === 0) {
        this.shutdown()
      }
    }
  }

  private ensureSocket() {
    if (this.ws && (this.ws.readyState === WebSocket.OPEN || this.ws.readyState === WebSocket.CONNECTING)) {
      return
    }
    if (this.connecting) return
    this.intentionalClose = false
    this.connecting = true
    this.setStatus(this.reconnectAttempt > 0 ? 'reconnecting' : 'connecting')

    const base = getMarketDataWsUrl().replace(/\/$/, '')
    const url = `${base}/ws`
    let socket: WebSocket
    try {
      socket = new WebSocket(url)
    } catch (err) {
      this.connecting = false
      this.setStatus('error', err instanceof Error ? err.message : 'WebSocket open failed')
      this.scheduleReconnect()
      return
    }
    this.ws = socket

    socket.onopen = () => {
      this.connecting = false
      this.reconnectAttempt = 0
      // Stay "connecting" until first live payload — then "live".
      if (!this.receivedLiveData) {
        this.setStatus('connecting', 'Socket open — waiting for first tick')
      } else {
        this.setStatus('live')
      }
      if (this.activeStreams.size > 0) {
        this.sendSubscribe([...this.activeStreams])
      }
    }

    socket.onmessage = (event) => {
      this.handleMessage(String(event.data))
    }

    socket.onerror = () => {
      this.setStatus('error', 'WebSocket error')
    }

    socket.onclose = () => {
      this.connecting = false
      this.ws = null
      if (this.intentionalClose) {
        this.setStatus('disconnected')
        return
      }
      this.setStatus('reconnecting', 'Connection lost')
      this.scheduleReconnect()
    }
  }

  private scheduleReconnect() {
    if (this.intentionalClose) return
    if (this.reconnectTimer != null) return
    if (this.candleHandlers.size === 0) return
    const delay = backoffMs(this.reconnectAttempt)
    this.reconnectAttempt += 1
    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = null
      this.ensureSocket()
    }, delay)
  }

  private sendSubscribe(streams: string[]) {
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN || streams.length === 0) return
    this.ws.send(
      JSON.stringify({
        method: 'SUBSCRIBE',
        params: streams,
        id: this.nextId++,
      }),
    )
  }

  private sendUnsubscribe(streams: string[]) {
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN || streams.length === 0) return
    this.ws.send(
      JSON.stringify({
        method: 'UNSUBSCRIBE',
        params: streams,
        id: this.nextId++,
      }),
    )
  }

  private handleMessage(raw: string) {
    let parsed: unknown
    try {
      parsed = JSON.parse(raw)
    } catch {
      return
    }
    if (!parsed || typeof parsed !== 'object') return
    const msg = parsed as Record<string, unknown>

    // Ignore subscribe acks
    if ('result' in msg || msg.e === undefined) {
      // Combined wrapper: { stream, data }
      if (typeof msg.stream === 'string' && msg.data && typeof msg.data === 'object') {
        this.handleEvent(msg.data as Record<string, unknown>)
      }
      return
    }
    this.handleEvent(msg)
  }

  private handleEvent(msg: Record<string, unknown>) {
    const event = msg.e
    if (event === 'kline' && msg.k && typeof msg.k === 'object') {
      const k = msg.k as Record<string, unknown>
      const symbol = String(msg.s ?? k.s ?? '').toUpperCase()
      const interval = String(k.i ?? '')
      const openTime = Number(k.t)
      const open = Number(k.o)
      const high = Number(k.h)
      const low = Number(k.l)
      const close = Number(k.c)
      const isFinal = Boolean(k.x)
      if (!symbol || !Number.isFinite(openTime) || !Number.isFinite(close)) return

      const candle: Candle = {
        time: Math.floor(openTime / 1000),
        open,
        high,
        low,
        close,
      }
      this.lastPrices.set(symbol, close)
      this.lastMessageAt = Date.now()
      this.receivedLiveData = true
      if (this.status !== 'live') this.setStatus('live')

      const bidAsk = this.getBidAsk(symbol)
      const tick: Tick = {
        symbol,
        price: close,
        timestamp: this.lastMessageAt,
        isSimulated: false,
        feedLabel: REAL_FEED_LABEL,
        bid: bidAsk.bid,
        ask: bidAsk.ask,
      }

      const timeframe = interval as Timeframe
      const key = streamKey(symbol, timeframe)
      const handlers = this.candleHandlers.get(key)
      if (!handlers) return
      for (const handler of handlers) {
        handler({ candle, isFinal, tick, bid: bidAsk.bid, ask: bidAsk.ask })
      }
      return
    }

    if (event === 'bookTicker') {
      const symbol = String(msg.s ?? '').toUpperCase()
      const bid = Number(msg.b)
      const ask = Number(msg.a)
      if (!symbol) return
      this.lastBidAsk.set(symbol, {
        bid: Number.isFinite(bid) ? bid : null,
        ask: Number.isFinite(ask) ? ask : null,
      })
      this.lastMessageAt = Date.now()
      if (Number.isFinite(Number(msg.a))) {
        // mid-ish last for list prices when only book updates
        const mid =
          Number.isFinite(bid) && Number.isFinite(ask) ? (bid + ask) / 2 : Number.isFinite(ask) ? ask : bid
        if (Number.isFinite(mid)) this.lastPrices.set(symbol, mid)
      }
      this.receivedLiveData = true
      if (this.status !== 'live') this.setStatus('live')
    }
  }

  shutdown() {
    this.intentionalClose = true
    if (this.reconnectTimer != null) {
      clearTimeout(this.reconnectTimer)
      this.reconnectTimer = null
    }
    if (this.ws) {
      try {
        this.ws.close()
      } catch {
        /* ignore */
      }
      this.ws = null
    }
    this.connecting = false
    this.activeStreams.clear()
    this.setStatus('disconnected')
  }
}

let sharedFeed: BinanceMarketFeed | null = null

export function getBinanceMarketFeed(): BinanceMarketFeed {
  if (!sharedFeed) sharedFeed = new BinanceMarketFeed()
  return sharedFeed
}

/** Test helper — replace singleton. */
export function setBinanceMarketFeedForTests(feed: BinanceMarketFeed | null) {
  sharedFeed = feed
}
