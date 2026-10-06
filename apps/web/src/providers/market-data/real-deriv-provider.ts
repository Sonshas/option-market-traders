import { LIVE_MARKET_UNAVAILABLE } from '@/domain/account'
import {
  extractLastDigit,
  mapDerivCandle,
  mapDerivOhlc,
  timeframeToDerivGranularity,
} from '@/providers/market-data/deriv-digits'
import {
  getSharedDerivFeed,
  type DerivConnectionStatus,
  type DerivFeed,
  type DerivOhlcPayload,
  type DerivTickPayload,
} from '@/providers/market-data/deriv-feed'
import {
  REAL_FEED_LABEL_DERIV,
  REAL_MARKET_UNAVAILABLE,
  getMarketDataProviderId,
  isMarketDataProviderConfigured,
} from '@/providers/market-data/env'
import {
  DERIV_REAL_TIMEFRAMES,
  buildDerivMarketCatalog,
  defaultRealDerivSymbol,
  getFallbackDerivCatalog,
  isDerivSymbol,
  mergeActiveSymbols,
  type DerivCatalogEntry,
} from '@/providers/market-data/deriv-symbols'
import type { MarketDataProvider, LiveCandleUpdate } from '@/providers/market-data/providers'
import { recordTick, recordTicks, registerLiveTickSource } from '@/providers/market-data/tick-buffer'
import type { Candle, ConnectionStatus, Market, MarketSnapshot, Tick, Timeframe } from '@/types'

/** CONNECTED requires a genuine tick within this window. */
export const STALE_MS = 10_000
const CANDLE_HISTORY_COUNT = 500
const SEAM_BACKFILL_DELAY_MS = 4_000
const CATALOG_TTL_MS = 5 * 60_000

function mapStatus(status: DerivConnectionStatus): ConnectionStatus {
  switch (status) {
    case 'CONNECTED':
      return 'live'
    case 'CONNECTING':
      return 'connecting'
    case 'RECONNECTING':
      return 'reconnecting'
    case 'ERROR':
      return 'error'
    default:
      return 'disconnected'
  }
}

function disconnectedSnapshot(note: string): MarketSnapshot {
  return {
    status: 'disconnected',
    candles: [],
    lastTick: null,
    note,
    isSimulated: false,
    feedLabel: note,
    bid: null,
    ask: null,
    lastUpdateAt: null,
  }
}

function tickFromPayload(payload: DerivTickPayload): Tick {
  const lastDigit = extractLastDigit(payload.quote, payload.pipSize)
  return {
    symbol: payload.symbol,
    price: payload.quote,
    timestamp: payload.epoch * (payload.epoch < 1e12 ? 1000 : 1),
    epoch: payload.epoch,
    pipSize: payload.pipSize,
    lastDigit,
    isSimulated: false,
    feedLabel: REAL_FEED_LABEL_DERIV,
    bid: null,
    ask: null,
  }
}

/** An `ohlc` update carries the genuine tick (close at epoch) that produced it. */
function tickFromOhlc(ohlc: DerivOhlcPayload): Tick {
  return tickFromPayload({ symbol: ohlc.symbol, quote: ohlc.close, epoch: ohlc.epoch, pipSize: ohlc.pipSize })
}

function ticksFromHistory(
  symbol: string,
  hist: { prices: number[]; times: number[]; pipSize: number },
): Tick[] {
  const n = Math.min(hist.prices.length, hist.times.length)
  const ticks: Tick[] = []
  for (let i = 0; i < n; i += 1) {
    const quote = Number(hist.prices[i])
    const epoch = Number(hist.times[i])
    if (!Number.isFinite(quote) || !Number.isFinite(epoch)) continue
    ticks.push(tickFromPayload({ symbol, quote, epoch, pipSize: hist.pipSize }))
  }
  return ticks
}

/**
 * REAL market-data via Deriv public WebSocket (ticks / history / active_symbols).
 * Never invents prices or digits. Never falls back to DEMO simulation.
 * Does not authorize, place trades, or mutate wallets.
 */
class DerivRealMarketDataProvider implements MarketDataProvider {
  readonly id = 'real-deriv'
  readonly isSimulated = false

  private catalog: DerivCatalogEntry[] = getFallbackDerivCatalog()
  private catalogLoadedAt = 0
  /** Market-list prices and the Deriv epoch (s) of each — kept apart from the tick buffer. */
  private lastPrices = new Map<string, number>()
  private quoteEpochs = new Map<string, number>()
  private lastQuotes = new Map<string, Tick>()
  private lastMessageAt = 0
  private pipSizes = new Map<string, number>()
  private statusHandlers = new Set<(status: ConnectionStatus, detail?: string) => void>()
  private feedUnsub: (() => void) | null = null

  private feed(): DerivFeed {
    return getSharedDerivFeed()
  }

  private ensureListeners(): void {
    if (this.feedUnsub) return
    this.feedUnsub = this.feed().onTick((payload) => this.handleTick(payload))
    let wasConnected = false
    this.feed().onStatus((status) => {
      const mapped = mapStatus(status)
      for (const handler of this.statusHandlers) handler(mapped)
      if (status === 'CONNECTED') {
        // After a reconnect, refill whatever ticks were missed while the socket was down.
        if (wasConnected) for (const symbol of this.symbolRefs.keys()) this.scheduleSeamBackfill(symbol, 1000)
        wasConnected = true
      }
    })
  }

  /**
   * `ticks_history` can lag the live stream by a tick, and a new stream starts with the next tick,
   * so the tick at the seam can be missed. A short re-fetch once the stream runs fills it
   * (the tick buffer de-duplicates by epoch).
   */
  private scheduleSeamBackfill(symbol: string, count = 60): void {
    setTimeout(() => {
      if (!this.symbolRefs.has(symbol)) return
      void this.getTickHistory(symbol, count).catch(() => undefined)
    }, SEAM_BACKFILL_DELAY_MS)
  }

  private handleTick(payload: DerivTickPayload): void {
    this.lastMessageAt = Date.now()
    this.setListQuote(payload.symbol, payload.quote, payload.epoch)
    this.pipSizes.set(payload.symbol, payload.pipSize)
    const tick = tickFromPayload(payload)
    this.lastQuotes.set(payload.symbol, tick)
    recordTick(tick)
  }

  getStatus(): ConnectionStatus {
    if (!isMarketDataProviderConfigured() || getMarketDataProviderId() !== 'deriv') {
      return 'disconnected'
    }
    const status = mapStatus(this.feed().getConnectionStatus())
    if (status === 'live' && this.lastMessageAt > 0 && Date.now() - this.lastMessageAt > STALE_MS) {
      return 'error'
    }
    return status
  }

  getLatestQuote(symbol: string): Tick | null {
    return this.lastQuotes.get(symbol) ?? null
  }

  async getTickHistory(symbol: string, count = 1000): Promise<Tick[]> {
    if (!isMarketDataProviderConfigured() || getMarketDataProviderId() !== 'deriv') return []
    this.ensureListeners()
    await this.feed().connect()
    const hist = await this.feed().getTicksHistory(symbol, count)
    const ticks = ticksFromHistory(symbol, hist)
    recordTicks(symbol, ticks)
    const last = ticks[ticks.length - 1]
    if (last?.epoch != null) this.setListQuote(symbol, last.price, last.epoch)
    return ticks
  }

  private setListQuote(symbol: string, price: number, epoch: number): void {
    if ((this.quoteEpochs.get(symbol) ?? 0) > epoch) return
    this.lastPrices.set(symbol, price)
    this.quoteEpochs.set(symbol, epoch)
  }

  /**
   * Latest genuine quote per listed symbol (`ticks_history` count 1) for the market list only.
   * Not written to the tick buffer, so digit windows never mix in these sparse samples.
   */
  async refreshQuotes(symbols: string[]): Promise<void> {
    if (!isMarketDataProviderConfigured() || getMarketDataProviderId() !== 'deriv') return
    await this.feed().connect()
    await Promise.all(
      symbols.map(async (symbol) => {
        try {
          const hist = await this.feed().getTicksHistory(symbol, 1)
          const n = Math.min(hist.prices.length, hist.times.length)
          if (n === 0) return
          this.setListQuote(symbol, Number(hist.prices[n - 1]), Number(hist.times[n - 1]))
        } catch {
          /* leave the previous genuine quote (or none) */
        }
      }),
    )
  }

  async backfillRange(symbol: string, fromMs: number, toMs: number): Promise<void> {
    if (!isMarketDataProviderConfigured() || getMarketDataProviderId() !== 'deriv') return
    await this.feed().connect()
    const hist = await this.feed().getTicksRange(
      symbol,
      Math.floor(fromMs / 1000),
      Math.ceil(toMs / 1000),
      50,
    )
    recordTicks(symbol, ticksFromHistory(symbol, hist))
  }

  async listMarkets(): Promise<Market[]> {
    if (!isMarketDataProviderConfigured() || getMarketDataProviderId() !== 'deriv') {
      return []
    }
    this.ensureListeners()
    if (Date.now() - this.catalogLoadedAt > CATALOG_TTL_MS) {
      try {
        await this.feed().connect()
        const active = await this.feed().getActiveSymbols()
        this.catalog = mergeActiveSymbols(active)
        this.catalogLoadedAt = Date.now()
        for (const entry of this.catalog) {
          this.pipSizes.set(entry.symbol, entry.pipSize)
        }
      } catch {
        this.catalog = getFallbackDerivCatalog()
      }
    }
    return buildDerivMarketCatalog(this.catalog, this.lastPrices, this.getStatus(), this.quoteEpochs)
  }

  async getMarket(symbol: string): Promise<Market | null> {
    const markets = await this.listMarkets()
    return markets.find((m) => m.symbol === symbol) ?? null
  }

  async getSnapshot(symbol: string, timeframe: Timeframe): Promise<MarketSnapshot> {
    if (!isMarketDataProviderConfigured() || getMarketDataProviderId() !== 'deriv') {
      return disconnectedSnapshot(
        `${LIVE_MARKET_UNAVAILABLE} Set VITE_MARKET_DATA_PROVIDER=deriv (public Deriv WebSocket).`,
      )
    }
    if (!isDerivSymbol(symbol, this.catalog.length ? this.catalog : getFallbackDerivCatalog())) {
      // Allow unknown symbols through if they look like Deriv codes after catalog refresh.
      if (!/^[A-Z0-9_]+$/i.test(symbol)) {
        return disconnectedSnapshot(
          `${REAL_MARKET_UNAVAILABLE} Symbol ${symbol} is not available on the REAL Deriv feed.`,
        )
      }
    }
    if (!(DERIV_REAL_TIMEFRAMES as readonly string[]).includes(timeframe)) {
      return disconnectedSnapshot(
        `${REAL_MARKET_UNAVAILABLE} Timeframe ${timeframe} is not supported for REAL charts (use 1m/5m/15m/30m/1h/4h/1d).`,
      )
    }

    this.ensureListeners()
    try {
      await this.feed().connect()
      const granularity = timeframeToDerivGranularity(timeframe)
      let candles: Candle[] = []
      if (granularity != null) {
        // Official Deriv OHLC only — candles are never rebuilt from ticks on the client.
        const hist = await this.feed().getCandlesHistory(symbol, granularity, CANDLE_HISTORY_COUNT)
        candles = hist.candles
          .map((c) => mapDerivCandle(c))
          .filter((c): c is Candle => c != null)
      }

      const lastTick: Tick | null = this.lastQuotes.get(symbol) ?? null

      const liveStatus = this.getStatus()
      // Historical candles alone are not "live" — require a genuine tick or open WS.
      const status: ConnectionStatus =
        liveStatus === 'live' || liveStatus === 'connecting' || liveStatus === 'reconnecting'
          ? liveStatus === 'live' && this.lastQuotes.has(symbol)
            ? 'live'
            : liveStatus === 'live'
              ? 'connecting'
              : liveStatus
          : liveStatus === 'error'
            ? 'error'
            : candles.length > 0
              ? 'connecting'
              : 'disconnected'

      return {
        status,
        candles,
        lastTick,
        note: REAL_FEED_LABEL_DERIV,
        isSimulated: false,
        feedLabel: REAL_FEED_LABEL_DERIV,
        bid: null,
        ask: null,
        lastUpdateAt: lastTick?.timestamp ?? null,
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Unknown error'
      return {
        status: 'error',
        candles: [],
        lastTick: null,
        note: `${REAL_MARKET_UNAVAILABLE} (${message})`,
        isSimulated: false,
        feedLabel: REAL_MARKET_UNAVAILABLE,
        bid: null,
        ask: null,
        lastUpdateAt: null,
      }
    }
  }

  subscribeTicks(symbol: string, onTick: (tick: Tick) => void): () => void {
    if (!isMarketDataProviderConfigured() || getMarketDataProviderId() !== 'deriv') {
      return () => undefined
    }
    this.ensureListeners()
    let active = true
    const unsubFeed = this.feed().onTick((payload) => {
      if (!active || payload.symbol !== symbol) return
      onTick(tickFromPayload(payload))
    })
    const release = this.retainSymbol(symbol)

    return () => {
      active = false
      unsubFeed()
      release()
    }
  }

  private symbolRefs = new Map<string, number>()

  /** Reference-counted feed subscription so one consumer leaving never cuts off another. */
  private retainSymbol(symbol: string): () => void {
    const count = this.symbolRefs.get(symbol) ?? 0
    this.symbolRefs.set(symbol, count + 1)
    if (count === 0) {
      void this.feed()
        .connect()
        .then(() => this.feed().subscribeTicks(symbol))
        .then(() => this.scheduleSeamBackfill(symbol))
        .catch(() => undefined)
    }
    let released = false
    return () => {
      if (released) return
      released = true
      const next = (this.symbolRefs.get(symbol) ?? 1) - 1
      if (next <= 0) {
        this.symbolRefs.delete(symbol)
        void this.feed().unsubscribeTicks(symbol)
      } else {
        this.symbolRefs.set(symbol, next)
      }
    }
  }

  subscribeLive(
    symbol: string,
    timeframe: Timeframe,
    onUpdate: (update: LiveCandleUpdate) => void,
  ): () => void {
    if (!isMarketDataProviderConfigured() || getMarketDataProviderId() !== 'deriv') {
      return () => undefined
    }
    const granularity = timeframeToDerivGranularity(timeframe)
    if (!(DERIV_REAL_TIMEFRAMES as readonly string[]).includes(timeframe) || granularity == null) {
      return () => undefined
    }
    this.ensureListeners()
    return this.feed().subscribeCandles(symbol, granularity, (ohlc) => {
      const candle = mapDerivOhlc({
        open_time: ohlc.openTime,
        open: ohlc.open,
        high: ohlc.high,
        low: ohlc.low,
        close: ohlc.close,
      })
      if (!candle) return
      onUpdate({ candle, isFinal: false, tick: tickFromOhlc(ohlc), bid: null, ask: null })
    })
  }

  onConnectionStatus(handler: (status: ConnectionStatus, detail?: string) => void): () => void {
    if (!isMarketDataProviderConfigured() || getMarketDataProviderId() !== 'deriv') {
      handler('disconnected', 'Market data provider not configured')
      return () => undefined
    }
    this.ensureListeners()
    this.statusHandlers.add(handler)
    handler(this.getStatus())
    return () => this.statusHandlers.delete(handler)
  }
}

const derivProviderInstance = new DerivRealMarketDataProvider()

export const derivRealMarketDataProvider: MarketDataProvider = derivProviderInstance

if (isMarketDataProviderConfigured() && getMarketDataProviderId() === 'deriv') {
  const settlementSubscriptions = new Set<string>()
  registerLiveTickSource({
    ensureSubscribed(symbol) {
      if (settlementSubscriptions.has(symbol)) return
      settlementSubscriptions.add(symbol)
      derivProviderInstance.subscribeTicks(symbol, () => undefined)
    },
    backfill(symbol, fromMs, toMs) {
      return derivProviderInstance.backfillRange(symbol, fromMs, toMs)
    },
    async loadRecent(symbol, count) {
      await derivProviderInstance.getTickHistory(symbol, count)
    },
  })
}

export { defaultRealDerivSymbol }
