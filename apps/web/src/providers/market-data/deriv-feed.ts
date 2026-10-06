/**
 * Deriv public WebSocket client (market-data only).
 * Docs: https://developers.deriv.com/docs/websockets
 * Endpoint: wss://ws.derivws.com/websockets/v3?app_id=<APP_ID>
 *
 * Used for ticks / ticks_history / active_symbols only — never authorize or trade.
 */

import { getDerivWsUrl } from './env'
import { normalizePipSize } from './deriv-digits'

export type DerivConnectionStatus =
  | 'CONNECTING'
  | 'CONNECTED'
  | 'DISCONNECTED'
  | 'ERROR'
  | 'RECONNECTING'

export type DerivTickPayload = {
  symbol: string
  quote: number
  epoch: number
  pipSize: number
  id?: string
}

/** One official Deriv `ohlc` stream update for the candle that is currently forming. */
export type DerivOhlcPayload = {
  symbol: string
  granularity: number
  /** Candle start (seconds). */
  openTime: number
  /** Epoch of the tick that produced this update (seconds). */
  epoch: number
  open: number
  high: number
  low: number
  close: number
  pipSize: number
}

type CandleStream = {
  symbol: string
  granularity: number
  subId: string | null
  listeners: Set<(ohlc: DerivOhlcPayload) => void>
}

type PendingRequest = {
  resolve: (value: unknown) => void
  reject: (reason: Error) => void
  timer: ReturnType<typeof setTimeout>
}

type DerivFeedOptions = {
  url?: string
  requestTimeoutMs?: number
  maxBackoffMs?: number
  connectionTimeoutMs?: number
  staleTickMs?: number
}

/** An open socket that stops delivering ticks for streaming symbols this long is recycled. */
const DEFAULT_STALE_TICK_MS = 20_000
const DEFAULT_REQUEST_TIMEOUT_MS = 15_000
const DEFAULT_CONNECTION_TIMEOUT_MS = 12_000
const DEFAULT_MAX_BACKOFF_MS = 30_000

export class DerivFeed {
  private readonly url: string
  private readonly requestTimeoutMs: number
  private readonly maxBackoffMs: number
  private readonly connectionTimeoutMs: number

  private ws: WebSocket | null = null
  private status: DerivConnectionStatus = 'DISCONNECTED'
  private statusListeners = new Set<(s: DerivConnectionStatus) => void>()
  private tickListeners = new Set<(tick: DerivTickPayload) => void>()
  private pending = new Map<string, PendingRequest>()
  private reqSeq = 0
  private opening: Promise<void> | null = null
  private reconnectAttempt = 0
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null
  private connectionTimer: ReturnType<typeof setTimeout> | null = null
  private intentionalClose = false
  private tickSubscriptions = new Map<string, string | number>() // symbol -> subscription id (-1 unknown, -2 poll mode)
  private subscribedSymbols = new Set<string>()
  private pollTimers = new Map<string, ReturnType<typeof setInterval>>()
  private lastPolledEpoch = new Map<string, number>()
  private pollIntervalMs = 750
  private candleStreams = new Map<string, CandleStream>() // `${symbol}|${granularity}`
  private tickSubscribing = new Map<string, Promise<void>>()
  private lastTickAt = 0
  private streamingSymbols = new Set<string>()
  private watchdogTimer: ReturnType<typeof setInterval> | null = null
  private readonly staleTickMs: number

  constructor(options: DerivFeedOptions = {}) {
    this.url = options.url ?? getDerivWsUrl()
    this.requestTimeoutMs = options.requestTimeoutMs ?? DEFAULT_REQUEST_TIMEOUT_MS
    this.maxBackoffMs = options.maxBackoffMs ?? DEFAULT_MAX_BACKOFF_MS
    this.connectionTimeoutMs = options.connectionTimeoutMs ?? DEFAULT_CONNECTION_TIMEOUT_MS
    this.staleTickMs = options.staleTickMs ?? DEFAULT_STALE_TICK_MS
  }

  getConnectionStatus(): DerivConnectionStatus {
    return this.status
  }

  onStatus(listener: (s: DerivConnectionStatus) => void): () => void {
    this.statusListeners.add(listener)
    listener(this.status)
    return () => this.statusListeners.delete(listener)
  }

  onTick(listener: (tick: DerivTickPayload) => void): () => void {
    this.tickListeners.add(listener)
    return () => this.tickListeners.delete(listener)
  }

  async connect(): Promise<void> {
    this.intentionalClose = false
    if (this.ws?.readyState === WebSocket.OPEN) {
      this.setStatus('CONNECTED')
      return
    }
    if (this.ws?.readyState === WebSocket.CONNECTING) {
      this.setStatus('CONNECTING')
      if (this.opening) await this.opening
      return
    }
    this.opening = this.openSocket()
    try {
      await this.opening
    } finally {
      this.opening = null
    }
  }

  disconnect(): void {
    this.intentionalClose = true
    this.clearReconnect()
    this.clearConnectionTimer()
    this.clearAllPolls()
    this.stopWatchdog()
    this.rejectAllPending(new Error('Deriv feed disconnected'))
    this.tickSubscriptions.clear()
    this.subscribedSymbols.clear()
    this.candleStreams.clear()
    this.streamingSymbols.clear()
    if (this.ws) {
      try {
        this.ws.close()
      } catch {
        /* ignore */
      }
      this.ws = null
    }
    this.setStatus('DISCONNECTED')
  }

  /**
   * Subscribe to live quotes for a symbol.
   * Prefers Deriv `ticks` stream; if the public app rejects streaming (InvalidSymbol),
   * falls back to polling genuine `ticks_history` snapshots — never fabricates prices.
   */
  async subscribeTicks(symbol: string): Promise<void> {
    if (!symbol) return
    this.subscribedSymbols.add(symbol)
    const inFlight = this.tickSubscribing.get(symbol)
    if (inFlight) return inFlight
    const request = this.requestTickStream(symbol).finally(() => this.tickSubscribing.delete(symbol))
    this.tickSubscribing.set(symbol, request)
    return request
  }

  private async requestTickStream(symbol: string): Promise<void> {
    await this.ensureConnected()
    const existing = this.tickSubscriptions.get(symbol)
    if (existing != null) return

    try {
      const response = (await this.send({ ticks: symbol, subscribe: 1 })) as {
        error?: { message?: string; code?: string }
        subscription?: { id?: string }
        tick?: { id?: string; symbol?: string; quote?: number; epoch?: number; pip_size?: number }
      }
      if (response.error) {
        throw new Error(response.error.message ?? 'Deriv ticks subscribe failed')
      }
      const subId = response.subscription?.id ?? response.tick?.id
      const id = subId != null && String(subId) !== '' ? String(subId) : null
      if (!this.subscribedSymbols.has(symbol)) {
        // Unsubscribed (e.g. market switched) while the request was in flight.
        if (id) void this.send({ forget: id }).catch(() => undefined)
        return
      }
      this.tickSubscriptions.set(symbol, id ?? -1)
      if (response.tick) {
        this.emitTickFromMessage(response.tick)
      }
      return
    } catch {
      // Public test app_id often allows ticks_history but rejects ticks streaming.
      this.startHistoryPoll(symbol)
    }
  }

  /**
   * Official Deriv OHLC stream (`ticks_history` style=candles, subscribe=1) for the forming candle.
   * Reference-counted per symbol+granularity; the last listener leaving forgets the subscription.
   */
  subscribeCandles(
    symbol: string,
    granularity: number,
    listener: (ohlc: DerivOhlcPayload) => void,
  ): () => void {
    const key = `${symbol}|${granularity}`
    let stream = this.candleStreams.get(key)
    if (!stream) {
      stream = { symbol, granularity, subId: null, listeners: new Set() }
      this.candleStreams.set(key, stream)
      void this.openCandleStream(stream).catch(() => undefined)
    }
    stream.listeners.add(listener)
    const owned = stream
    return () => {
      owned.listeners.delete(listener)
      if (owned.listeners.size > 0) return
      if (this.candleStreams.get(key) === owned) this.candleStreams.delete(key)
      if (owned.subId) void this.forget(owned.subId)
    }
  }

  private async openCandleStream(stream: CandleStream): Promise<void> {
    await this.ensureConnected()
    const response = (await this.send({
      ticks_history: stream.symbol,
      adjust_start_time: 1,
      count: 1,
      end: 'latest',
      start: 1,
      style: 'candles',
      granularity: stream.granularity,
      subscribe: 1,
    })) as { subscription?: { id?: string } }
    const id = response.subscription?.id != null ? String(response.subscription.id) : null
    const key = `${stream.symbol}|${stream.granularity}`
    if (this.candleStreams.get(key) !== stream) {
      if (id) void this.forget(id)
      return
    }
    stream.subId = id
  }

  private async forget(subId: string): Promise<void> {
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN) return
    try {
      await this.send({ forget: subId })
    } catch {
      /* best-effort */
    }
  }

  async unsubscribeTicks(symbol: string): Promise<void> {
    this.subscribedSymbols.delete(symbol)
    this.streamingSymbols.delete(symbol)
    this.stopHistoryPoll(symbol)
    const subId = this.tickSubscriptions.get(symbol)
    this.tickSubscriptions.delete(symbol)
    if (subId == null || typeof subId === 'number') return
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN) return
    try {
      await this.send({ forget: String(subId) })
    } catch {
      /* best-effort */
    }
  }

  async getTicksHistory(
    symbol: string,
    count = 500,
  ): Promise<{ prices: number[]; times: number[]; pipSize: number }> {
    await this.ensureConnected()
    const response = (await this.send({
      ticks_history: symbol,
      adjust_start_time: 1,
      count,
      end: 'latest',
      start: 1,
      style: 'ticks',
    })) as {
      error?: { message?: string }
      history?: { prices?: number[]; times?: number[] }
      pip_size?: number
      echo_req?: { ticks_history?: string }
    }
    if (response.error) {
      throw new Error(response.error.message ?? 'Deriv ticks_history failed')
    }
    const prices = Array.isArray(response.history?.prices) ? response.history!.prices! : []
    const times = Array.isArray(response.history?.times) ? response.history!.times! : []
    const rawPip =
      typeof response.pip_size === 'number' && response.pip_size > 0
        ? response.pip_size
        : inferPipSize(prices)
    return { prices, times, pipSize: normalizePipSize(rawPip) }
  }

  /** Genuine ticks between two epochs (seconds), inclusive. */
  async getTicksRange(
    symbol: string,
    startEpoch: number,
    endEpoch: number,
    count = 100,
  ): Promise<{ prices: number[]; times: number[]; pipSize: number }> {
    await this.ensureConnected()
    const response = (await this.send({
      ticks_history: symbol,
      start: Math.max(1, Math.floor(startEpoch)),
      end: Math.floor(endEpoch),
      count,
      style: 'ticks',
    })) as {
      error?: { message?: string }
      history?: { prices?: number[]; times?: number[] }
      pip_size?: number
    }
    if (response.error) {
      throw new Error(response.error.message ?? 'Deriv ticks_history failed')
    }
    const prices = Array.isArray(response.history?.prices) ? response.history!.prices! : []
    const times = Array.isArray(response.history?.times) ? response.history!.times! : []
    const rawPip =
      typeof response.pip_size === 'number' && response.pip_size > 0
        ? response.pip_size
        : inferPipSize(prices)
    return { prices, times, pipSize: normalizePipSize(rawPip) }
  }

  async getCandlesHistory(
    symbol: string,
    granularity: number,
    count = 200,
  ): Promise<{
    candles: Array<{ epoch: number; open: number; high: number; low: number; close: number }>
  }> {
    await this.ensureConnected()
    const response = (await this.send({
      ticks_history: symbol,
      adjust_start_time: 1,
      count,
      end: 'latest',
      start: 1,
      style: 'candles',
      granularity,
    })) as {
      error?: { message?: string }
      candles?: Array<{
        epoch?: number
        open?: number
        high?: number
        low?: number
        close?: number
      }>
    }
    if (response.error) {
      throw new Error(response.error.message ?? 'Deriv candles history failed')
    }
    const candles = (response.candles ?? [])
      .map((c) => ({
        epoch: Number(c.epoch),
        open: Number(c.open),
        high: Number(c.high),
        low: Number(c.low),
        close: Number(c.close),
      }))
      .filter(
        (c) =>
          Number.isFinite(c.epoch) &&
          Number.isFinite(c.open) &&
          Number.isFinite(c.high) &&
          Number.isFinite(c.low) &&
          Number.isFinite(c.close),
      )
    return { candles }
  }

  async getActiveSymbols(): Promise<
    Array<{ symbol: string; displayName: string; market: string; submarket?: string; pipSize: number }>
  > {
    await this.ensureConnected()
    const response = (await this.send({
      active_symbols: 'brief',
    })) as {
      error?: { message?: string }
      active_symbols?: Array<{
        symbol?: string
        underlying_symbol?: string
        display_name?: string
        underlying_symbol_name?: string
        market?: string
        submarket?: string
        pip_size?: number
        exchange_is_open?: number
      }>
    }
    if (response.error) {
      throw new Error(response.error.message ?? 'Deriv active_symbols failed')
    }
    return (response.active_symbols ?? [])
      .map((s) => ({ ...s, symbol: s.underlying_symbol ?? s.symbol }))
      .filter((s) => typeof s.symbol === 'string' && s.symbol.length > 0)
      .map((s) => ({
        symbol: s.symbol!,
        displayName: s.underlying_symbol_name ?? s.display_name ?? s.symbol!,
        market: s.market ?? 'unknown',
        ...(s.submarket ? { submarket: s.submarket } : {}),
        pipSize: typeof s.pip_size === 'number' && s.pip_size > 0 ? s.pip_size : 0.01,
      }))
  }

  private async ensureConnected(): Promise<void> {
    const open = typeof WebSocket !== 'undefined' ? WebSocket.OPEN : 1
    if (this.ws != null && this.ws.readyState === open) return
    await this.connect()
    if (this.ws == null || this.ws.readyState !== open) {
      throw new Error('Deriv WebSocket not connected')
    }
  }

  private openSocket(): Promise<void> {
    return new Promise((resolve, reject) => {
      this.clearReconnect()
      this.setStatus(this.reconnectAttempt > 0 ? 'RECONNECTING' : 'CONNECTING')

      let settled = false
      const finishOk = () => {
        if (settled) return
        settled = true
        this.clearConnectionTimer()
        this.reconnectAttempt = 0
        this.setStatus('CONNECTED')
        this.startWatchdog()
        void this.resubscribeAll()
        resolve()
      }
      const finishErr = (err: Error) => {
        if (settled) return
        settled = true
        this.clearConnectionTimer()
        this.setStatus('ERROR')
        reject(err)
        this.scheduleReconnect()
      }

      try {
        this.ws = new WebSocket(this.url)
      } catch (err) {
        finishErr(err instanceof Error ? err : new Error('Failed to open Deriv WebSocket'))
        return
      }

      this.connectionTimer = setTimeout(() => {
        finishErr(new Error('Deriv connection timeout'))
        try {
          this.ws?.close()
        } catch {
          /* ignore */
        }
      }, this.connectionTimeoutMs)

      this.ws.onopen = () => finishOk()
      this.ws.onerror = () => finishErr(new Error('Deriv WebSocket error'))
      this.ws.onclose = () => {
        this.ws = null
        this.rejectAllPending(new Error('Deriv WebSocket closed'))
        if (this.intentionalClose) {
          this.setStatus('DISCONNECTED')
          return
        }
        this.setStatus('DISCONNECTED')
        this.scheduleReconnect()
        if (!settled) finishErr(new Error('Deriv WebSocket closed before open'))
      }
      this.ws.onmessage = (event) => this.handleMessage(String(event.data))
    })
  }

  private handleMessage(raw: string): void {
    let msg: Record<string, unknown>
    try {
      msg = JSON.parse(raw) as Record<string, unknown>
    } catch {
      return
    }

    const reqId = msg.req_id != null ? String(msg.req_id) : null
    if (reqId && this.pending.has(reqId)) {
      const pending = this.pending.get(reqId)!
      clearTimeout(pending.timer)
      this.pending.delete(reqId)
      if (msg.error) {
        const errObj = msg.error as { message?: string }
        pending.reject(new Error(errObj.message ?? 'Deriv API error'))
      } else {
        pending.resolve(msg)
      }
    }

    if (msg.msg_type === 'tick' && msg.tick && typeof msg.tick === 'object') {
      this.emitTickFromMessage(msg.tick as Record<string, unknown>)
    } else if (msg.msg_type === 'ohlc' && msg.ohlc && typeof msg.ohlc === 'object') {
      this.emitOhlc(msg.ohlc as Record<string, unknown>)
    }
  }

  private emitOhlc(raw: Record<string, unknown>): void {
    const symbol = typeof raw.symbol === 'string' ? raw.symbol : ''
    const granularity = Number(raw.granularity)
    const stream = this.candleStreams.get(`${symbol}|${granularity}`)
    if (!stream) return
    const payload: DerivOhlcPayload = {
      symbol,
      granularity,
      openTime: Number(raw.open_time),
      epoch: Number(raw.epoch),
      open: Number(raw.open),
      high: Number(raw.high),
      low: Number(raw.low),
      close: Number(raw.close),
      pipSize: normalizePipSize(Number(raw.pip_size)),
    }
    const values = [payload.openTime, payload.epoch, payload.open, payload.high, payload.low, payload.close]
    if (!values.every(Number.isFinite)) return
    for (const listener of stream.listeners) listener(payload)
  }

  private emitTickFromMessage(tick: Record<string, unknown>): void {
    const symbol = typeof tick.symbol === 'string' ? tick.symbol : ''
    const quote = Number(tick.quote)
    const epoch = Number(tick.epoch)
    const pipSize = normalizePipSize(Number(tick.pip_size))
    if (!symbol || !Number.isFinite(quote) || !Number.isFinite(epoch)) return
    const payload: DerivTickPayload = {
      symbol,
      quote,
      epoch,
      pipSize,
      id: tick.id != null ? String(tick.id) : undefined,
    }
    this.lastTickAt = Date.now()
    if (this.subscribedSymbols.has(symbol)) this.streamingSymbols.add(symbol)
    for (const listener of this.tickListeners) listener(payload)
  }

  /**
   * Recycles a socket that is open but has stopped delivering ticks for symbols that were
   * streaming; the close handler then runs the normal backoff reconnect + resubscribe.
   * Symbols that never ticked (e.g. closed markets) do not trigger it.
   */
  private startWatchdog(): void {
    if (this.watchdogTimer) return
    this.watchdogTimer = setInterval(() => {
      const open = typeof WebSocket !== 'undefined' ? WebSocket.OPEN : 1
      if (!this.ws || this.ws.readyState !== open) return
      if (this.streamingSymbols.size === 0 || this.lastTickAt === 0) return
      if (Date.now() - this.lastTickAt < this.staleTickMs) return
      this.lastTickAt = Date.now()
      try {
        this.ws.close()
      } catch {
        /* ignore */
      }
    }, Math.max(1000, Math.floor(this.staleTickMs / 4)))
  }

  private stopWatchdog(): void {
    if (this.watchdogTimer) {
      clearInterval(this.watchdogTimer)
      this.watchdogTimer = null
    }
  }

  private startHistoryPoll(symbol: string): void {
    this.tickSubscriptions.set(symbol, -2)
    if (this.pollTimers.has(symbol)) return

    const pollOnce = async () => {
      if (!this.subscribedSymbols.has(symbol)) return
      try {
        const hist = await this.getTicksHistory(symbol, 5)
        if (hist.prices.length === 0) return
        const prev = this.lastPolledEpoch.get(symbol)
        // Emit every genuine tick newer than the last one seen (first poll: latest sample only),
        // so 1-second indices do not skip ticks between polls.
        const start = prev == null ? hist.prices.length - 1 : 0
        for (let idx = start; idx < hist.prices.length; idx += 1) {
          const epoch = hist.times[idx]!
          const latest = this.lastPolledEpoch.get(symbol)
          if (latest != null && epoch <= latest) continue
          this.lastPolledEpoch.set(symbol, epoch)
          this.emitTickFromMessage({
            symbol,
            quote: hist.prices[idx]!,
            epoch,
            pip_size: hist.pipSize,
          })
        }
      } catch {
        /* keep polling; reconnect path handles socket loss */
      }
    }

    void pollOnce()
    const timer = setInterval(() => {
      void pollOnce()
    }, this.pollIntervalMs)
    this.pollTimers.set(symbol, timer)
  }

  private stopHistoryPoll(symbol: string): void {
    const timer = this.pollTimers.get(symbol)
    if (timer) {
      clearInterval(timer)
      this.pollTimers.delete(symbol)
    }
    this.lastPolledEpoch.delete(symbol)
  }

  private clearAllPolls(): void {
    for (const symbol of [...this.pollTimers.keys()]) {
      this.stopHistoryPoll(symbol)
    }
  }

  private send(payload: Record<string, unknown>): Promise<unknown> {
    return new Promise((resolve, reject) => {
      if (!this.ws || this.ws.readyState !== WebSocket.OPEN) {
        reject(new Error('Deriv WebSocket not open'))
        return
      }
      this.reqSeq += 1
      const reqId = String(this.reqSeq)
      const timer = setTimeout(() => {
        this.pending.delete(reqId)
        reject(new Error('Deriv request timeout'))
      }, this.requestTimeoutMs)
      this.pending.set(reqId, { resolve, reject, timer })
      try {
        this.ws.send(JSON.stringify({ ...payload, req_id: Number(reqId) }))
      } catch (err) {
        clearTimeout(timer)
        this.pending.delete(reqId)
        reject(err instanceof Error ? err : new Error('Deriv send failed'))
      }
    })
  }

  private async resubscribeAll(): Promise<void> {
    const symbols = [...this.subscribedSymbols]
    this.tickSubscriptions.clear()
    this.lastTickAt = Date.now()
    for (const symbol of symbols) {
      try {
        await this.subscribeTicks(symbol)
      } catch {
        /* will retry on next reconnect */
      }
    }
    for (const stream of this.candleStreams.values()) {
      stream.subId = null
      void this.openCandleStream(stream).catch(() => undefined)
    }
  }

  private scheduleReconnect(): void {
    if (this.intentionalClose) return
    this.clearReconnect()
    const attempt = this.reconnectAttempt
    this.reconnectAttempt += 1
    const delay = Math.min(1000 * 2 ** attempt, this.maxBackoffMs)
    this.setStatus('RECONNECTING')
    this.reconnectTimer = setTimeout(() => {
      void this.openSocket().catch(() => {
        /* scheduleReconnect already from onclose/error */
      })
    }, delay)
  }

  private clearReconnect(): void {
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer)
      this.reconnectTimer = null
    }
  }

  private clearConnectionTimer(): void {
    if (this.connectionTimer) {
      clearTimeout(this.connectionTimer)
      this.connectionTimer = null
    }
  }

  private rejectAllPending(err: Error): void {
    for (const [, pending] of this.pending) {
      clearTimeout(pending.timer)
      pending.reject(err)
    }
    this.pending.clear()
  }

  private setStatus(status: DerivConnectionStatus): void {
    if (this.status === status) return
    this.status = status
    for (const listener of this.statusListeners) listener(status)
  }
}

function inferPipSize(prices: number[]): number {
  for (let i = prices.length - 1; i >= 0; i -= 1) {
    const p = prices[i]
    if (!Number.isFinite(p)) continue
    const s = String(p)
    const dot = s.indexOf('.')
    if (dot === -1) return 1
    const decimals = s.length - dot - 1
    if (decimals <= 0) return 1
    return 10 ** -decimals
  }
  return 0.01
}

let sharedFeed: DerivFeed | null = null

export function getSharedDerivFeed(): DerivFeed {
  if (!sharedFeed) sharedFeed = new DerivFeed()
  return sharedFeed
}

export function resetSharedDerivFeedForTests(): void {
  sharedFeed?.disconnect()
  sharedFeed = null
}
