/**
 * Unit tests for REAL Binance market-data adapter.
 * Uses mocks — does not require network or private keys.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  BinanceMarketFeed,
  setBinanceMarketFeedForTests,
} from '@/providers/market-data/binance-feed'
import { binanceRealMarketDataProvider } from '@/providers/market-data/real-binance-provider'
import { demoMarketDataProvider } from '@/providers/market-data/providers'
import { BINANCE_REAL_MARKETS, toBinanceInterval } from '@/providers/market-data/binance-symbols'
import { realTradingProvider } from '@/providers/trading/real-trading-provider'

vi.mock('@/providers/market-data/env', async () => {
  const actual = await vi.importActual<typeof import('@/providers/market-data/env')>(
    '@/providers/market-data/env',
  )
  return {
    ...actual,
    isMarketDataProviderConfigured: () => true,
    getMarketDataProviderId: () => 'binance' as const,
    getMarketDataApiUrl: () => 'http://localhost:3001',
    getMarketDataWsUrl: () => 'wss://stream.binance.com:9443',
  }
})

class FakeWebSocket {
  static OPEN = 1
  static CONNECTING = 0
  static CLOSED = 3
  readyState = FakeWebSocket.CONNECTING
  onopen: ((ev?: unknown) => void) | null = null
  onmessage: ((ev: { data: string }) => void) | null = null
  onerror: ((ev?: unknown) => void) | null = null
  onclose: ((ev?: unknown) => void) | null = null
  sent: string[] = []
  url: string
  static instances: FakeWebSocket[] = []

  constructor(url: string) {
    this.url = url
    FakeWebSocket.instances.push(this)
    queueMicrotask(() => {
      this.readyState = FakeWebSocket.OPEN
      this.onopen?.(undefined)
    })
  }

  send(data: string) {
    this.sent.push(data)
  }

  close() {
    this.readyState = FakeWebSocket.CLOSED
    this.onclose?.(undefined)
  }

  emit(data: unknown) {
    this.onmessage?.({ data: JSON.stringify(data) })
  }
}

describe('Binance symbol / timeframe helpers', () => {
  it('maps supported REAL timeframes', () => {
    expect(toBinanceInterval('1m')).toBe('1m')
    expect(toBinanceInterval('5m')).toBe('5m')
    expect(toBinanceInterval('15m')).toBe('15m')
    expect(toBinanceInterval('30m')).toBe('30m')
    expect(toBinanceInterval('1h')).toBe('1h')
    expect(toBinanceInterval('5s' as Parameters<typeof toBinanceInterval>[0])).toBeNull()
  })

  it('exposes curated REAL symbols only', () => {
    expect(BINANCE_REAL_MARKETS.map((m) => m.symbol)).toEqual([
      'BTCUSDT',
      'ETHUSDT',
      'BNBUSDT',
      'SOLUSDT',
      'XRPUSDT',
      'ADAUSDT',
      'DOGEUSDT',
      'AVAXUSDT',
    ])
  })
})

describe('BinanceMarketFeed', () => {
  beforeEach(() => {
    FakeWebSocket.instances = []
    vi.stubGlobal('WebSocket', FakeWebSocket as unknown as typeof WebSocket)
    setBinanceMarketFeedForTests(null)
  })

  afterEach(() => {
    setBinanceMarketFeedForTests(null)
    vi.unstubAllGlobals()
    vi.restoreAllMocks()
  })

  it('loads historical candles from proxied REST', async () => {
    const feed = new BinanceMarketFeed()
    setBinanceMarketFeedForTests(feed)
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => ({
        ok: true,
        json: async () => ({
          candles: [
            { time: 1_700_000_000, open: 1, high: 2, low: 0.5, close: 1.5 },
            { time: 1_700_000_060, open: 1.5, high: 2.2, low: 1.4, close: 2 },
          ],
        }),
      })),
    )

    const candles = await feed.fetchKlines('BTCUSDT', '1m')
    expect(candles).toHaveLength(2)
    expect(candles[1]?.close).toBe(2)
    expect(feed.getLastPrices().get('BTCUSDT')).toBe(2)
  })

  it('rejects invalid klines payloads', async () => {
    const feed = new BinanceMarketFeed()
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => ({
        ok: true,
        json: async () => ({ candles: [] }),
      })),
    )
    await expect(feed.fetchKlines('BTCUSDT', '1m')).rejects.toThrow(/Empty klines/)
  })

  it('updates current candle and appends on final kline', async () => {
    const feed = new BinanceMarketFeed()
    setBinanceMarketFeedForTests(feed)
    const updates: Array<{ time: number; close: number; isFinal: boolean }> = []

    const unsub = feed.subscribeLive('BTCUSDT', '1m', (update) => {
      updates.push({ time: update.candle.time, close: update.candle.close, isFinal: update.isFinal })
    })

    await vi.waitFor(() => expect(FakeWebSocket.instances.length).toBe(1))
    const ws = FakeWebSocket.instances[0]!

    ws.emit({
      e: 'kline',
      s: 'BTCUSDT',
      k: {
        t: 1_700_000_000_000,
        i: '1m',
        o: '100',
        h: '110',
        l: '90',
        c: '105',
        x: false,
        s: 'BTCUSDT',
      },
    })
    ws.emit({
      e: 'kline',
      s: 'BTCUSDT',
      k: {
        t: 1_700_000_000_000,
        i: '1m',
        o: '100',
        h: '112',
        l: '90',
        c: '108',
        x: true,
        s: 'BTCUSDT',
      },
    })
    ws.emit({
      e: 'kline',
      s: 'BTCUSDT',
      k: {
        t: 1_700_000_060_000,
        i: '1m',
        o: '108',
        h: '109',
        l: '107',
        c: '108.5',
        x: false,
        s: 'BTCUSDT',
      },
    })

    expect(updates).toHaveLength(3)
    expect(updates[0]).toMatchObject({ time: 1_700_000_000, close: 105, isFinal: false })
    expect(updates[1]).toMatchObject({ time: 1_700_000_000, close: 108, isFinal: true })
    expect(updates[2]).toMatchObject({ time: 1_700_000_060, close: 108.5, isFinal: false })
    expect(feed.getStatus()).toBe('live')
    expect(feed.hasReceivedLiveData()).toBe(true)

    unsub()
  })

  it('does not open duplicate sockets for parallel subscribers', async () => {
    const feed = new BinanceMarketFeed()
    const a = feed.subscribeLive('BTCUSDT', '1m', () => undefined)
    const b = feed.subscribeLive('ETHUSDT', '5m', () => undefined)
    await vi.waitFor(() => expect(FakeWebSocket.instances.length).toBe(1))
    a()
    b()
  })

  it('marks reconnecting on unexpected close and schedules single reconnect', async () => {
    vi.useFakeTimers()
    const feed = new BinanceMarketFeed()
    const statuses: string[] = []
    feed.onStatus((s) => statuses.push(s))
    feed.subscribeLive('BTCUSDT', '1m', () => undefined)
    await vi.waitFor(() => expect(FakeWebSocket.instances.length).toBe(1))
    FakeWebSocket.instances[0]!.close()
    expect(feed.getStatus()).toBe('reconnecting')
    vi.advanceTimersByTime(1000)
    await vi.waitFor(() => expect(FakeWebSocket.instances.length).toBe(2))
    vi.useRealTimers()
  })
})

describe('binanceRealMarketDataProvider', () => {
  beforeEach(() => {
    FakeWebSocket.instances = []
    vi.stubGlobal('WebSocket', FakeWebSocket as unknown as typeof WebSocket)
    setBinanceMarketFeedForTests(new BinanceMarketFeed())
  })

  afterEach(() => {
    setBinanceMarketFeedForTests(null)
    vi.unstubAllGlobals()
  })

  it('lists REAL crypto markets (not DEMO synthetics)', async () => {
    const markets = await binanceRealMarketDataProvider.listMarkets()
    expect(markets.every((m) => m.isSimulated === false)).toBe(true)
    expect(markets.every((m) => m.category === 'crypto')).toBe(true)
    expect(markets.some((m) => m.symbol === 'BTCUSDT')).toBe(true)
    expect(markets.some((m) => m.symbol === 'R_75')).toBe(false)
  })

  it('returns unavailable snapshot for unknown symbols (no DEMO fill)', async () => {
    const snap = await binanceRealMarketDataProvider.getSnapshot('R_75', '1m')
    expect(snap.candles).toHaveLength(0)
    expect(snap.isSimulated).toBe(false)
    expect(snap.note).toMatch(/UNAVAILABLE|allow-list/i)
  })

  it('loads snapshot OHLC from feed', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => ({
        ok: true,
        json: async () => ({
          candles: [{ time: 100, open: 1, high: 2, low: 0.5, close: 1.8 }],
        }),
      })),
    )
    const snap = await binanceRealMarketDataProvider.getSnapshot('BTCUSDT', '1m')
    expect(snap.candles).toHaveLength(1)
    expect(snap.isSimulated).toBe(false)
    expect(snap.lastTick?.price).toBe(1.8)
  })
})

describe('DEMO / REAL market-data separation', () => {
  it('never serves simulated prices in DEMO or REAL', async () => {
    const demo = await demoMarketDataProvider.listMarkets()
    const real = await binanceRealMarketDataProvider.listMarkets()
    expect(demo.every((m) => !m.isSimulated && m.lastPrice == null)).toBe(true)
    expect(real.every((m) => !m.isSimulated)).toBe(true)
    expect(demoMarketDataProvider.getStatus()).not.toBe('simulated')
  })

  it('keeps REAL order execution disabled even when market data works', async () => {
    const place = await realTradingProvider.placeTrade({
      symbol: 'BTCUSDT',
      contractType: 'EVEN_ODD',
      contractOption: 'even',
      stake: 10,
      durationMs: 15_000,
      kind: 'real',
      accountMode: 'real',
    })
    expect(place.connected).toBe(false)
    expect(place.data).toBeNull()
  })
})
