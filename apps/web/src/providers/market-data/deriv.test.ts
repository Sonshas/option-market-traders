/**
 * Unit tests for REAL Deriv market-data adapter.
 * Uses mocks — does not require network or private keys.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  applyTickToCandles,
  extractLastDigit,
  timeframeToDerivGranularity,
} from '@/providers/market-data/deriv-digits'
import {
  DerivFeed,
  resetSharedDerivFeedForTests,
} from '@/providers/market-data/deriv-feed'
import { demoMarketDataProvider } from '@/providers/market-data/providers'
import { derivRealMarketDataProvider } from '@/providers/market-data/real-deriv-provider'
import { realTradingProvider } from '@/providers/trading/real-trading-provider'
import { DERIV_REAL_TIMEFRAMES, mergeActiveSymbols } from '@/providers/market-data/deriv-symbols'
import { TIMEFRAMES } from '@/lib/constants'
import type { Timeframe } from '@/types'

vi.mock('@/providers/market-data/env', async () => {
  const actual = await vi.importActual<typeof import('@/providers/market-data/env')>(
    '@/providers/market-data/env',
  )
  return {
    ...actual,
    isMarketDataProviderConfigured: () => true,
    getMarketDataProviderId: () => 'deriv' as const,
    getDerivAppId: () => '1089',
    getDerivWsUrl: () => 'wss://ws.derivws.com/websockets/v3?app_id=1089',
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
    const msg = JSON.parse(data) as Record<string, unknown>
    const reqId = msg.req_id
    // Auto-respond to common Deriv requests for unit tests.
    queueMicrotask(() => {
      if (msg.ticks) {
        this.emit({
          msg_type: 'tick',
          req_id: reqId,
          subscription: { id: '99' },
          tick: {
            id: '99',
            symbol: msg.ticks,
            quote: 1234.56,
            epoch: 1_700_000_000,
            pip_size: 0.01,
          },
        })
        return
      }
      if (msg.ticks_history) {
        if (msg.style === 'candles') {
          this.emit({
            msg_type: 'candles',
            req_id: reqId,
            candles: [
              { epoch: 1_700_000_000, open: 100, high: 101, low: 99, close: 100.5 },
              { epoch: 1_700_000_060, open: 100.5, high: 102, low: 100, close: 101.2 },
            ],
          })
          return
        }
        this.emit({
          msg_type: 'history',
          req_id: reqId,
          pip_size: 0.01,
          history: {
            prices: [100.01, 100.02, 100.03],
            times: [1_700_000_000, 1_700_000_001, 1_700_000_002],
          },
        })
        return
      }
      if (msg.active_symbols) {
        this.emit({
          msg_type: 'active_symbols',
          req_id: reqId,
          active_symbols: [
            {
              symbol: 'R_100',
              display_name: 'Volatility 100 Index',
              market: 'synthetic_index',
              pip_size: 0.01,
            },
            {
              symbol: 'R_75',
              display_name: 'Volatility 75 Index',
              market: 'synthetic_index',
              pip_size: 0.0001,
            },
            {
              underlying_symbol: '1HZ100V',
              underlying_symbol_name: 'Volatility 100 (1s) Index',
              market: 'synthetic_index',
              pip_size: 0.01,
            },
          ],
        })
        return
      }
      if (msg.forget) {
        this.emit({ msg_type: 'forget', req_id: reqId, forget: 1 })
      }
    })
  }

  close() {
    this.readyState = FakeWebSocket.CLOSED
    this.onclose?.(undefined)
  }

  emit(data: unknown) {
    this.onmessage?.({ data: JSON.stringify(data) })
  }
}

describe('digit extraction / candle helpers', () => {
  it('extracts last digit from quote and pip size without inventing', () => {
    expect(extractLastDigit(1234.56, 0.01)).toBe(6)
    expect(extractLastDigit(100.01, 0.01)).toBe(1)
    expect(extractLastDigit(75.12345, 0.00001)).toBe(5)
    // Deriv history often returns decimal-place count (e.g. 2) instead of 0.01
    expect(extractLastDigit(607.15, 2)).toBe(5)
    expect(extractLastDigit(Number.NaN, 0.01)).toBeNull()
    expect(extractLastDigit(10, 0)).toBeNull()
  })

  it('maps REAL timeframes to Deriv granularity', () => {
    expect(timeframeToDerivGranularity('1m')).toBe(60)
    expect(timeframeToDerivGranularity('5m')).toBe(300)
    expect(timeframeToDerivGranularity('15m')).toBe(900)
    expect(timeframeToDerivGranularity('30m')).toBe(1800)
    expect(timeframeToDerivGranularity('1h')).toBe(3600)
    expect(timeframeToDerivGranularity('4h')).toBe(14400)
    expect(timeframeToDerivGranularity('1d')).toBe(86400)
    expect(timeframeToDerivGranularity('5s' as Timeframe)).toBeNull()
    expect(timeframeToDerivGranularity('30s' as Timeframe)).toBeNull()
  })

  it('offers no sub-minute timeframes (Deriv has no sub-minute candles)', () => {
    expect(TIMEFRAMES).toEqual(['1m', '5m', '15m', '30m', '1h', '4h', '1d'])
    expect(DERIV_REAL_TIMEFRAMES).toEqual(['1m', '5m', '15m', '30m', '1h', '4h', '1d'])
  })

  it('builds candles from genuine ticks', () => {
    let candles = applyTickToCandles([], 100, 60_000, 60_000)
    candles = applyTickToCandles(candles, 101, 60_500, 60_000)
    candles = applyTickToCandles(candles, 99, 120_000, 60_000)
    expect(candles).toHaveLength(2)
    expect(candles[0]).toMatchObject({ open: 100, high: 101, low: 100, close: 101 })
    expect(candles[1]).toMatchObject({ open: 99, close: 99 })
  })

  it('orders preferred Deriv symbols first', () => {
    const merged = mergeActiveSymbols([
      { symbol: 'frxEURUSD', displayName: 'EUR/USD', market: 'forex', pipSize: 0.00001 },
      { symbol: 'R_100', displayName: 'Volatility 100 Index', market: 'synthetic_index', pipSize: 0.01 },
    ])
    expect(merged[0]?.symbol).toBe('R_100')
  })
})

describe('DerivFeed connection / reconnect', () => {
  beforeEach(() => {
    FakeWebSocket.instances = []
    vi.stubGlobal('WebSocket', FakeWebSocket as unknown as typeof WebSocket)
    resetSharedDerivFeedForTests()
  })

  afterEach(() => {
    resetSharedDerivFeedForTests()
    vi.unstubAllGlobals()
    vi.useRealTimers()
  })

  it('connects and reports CONNECTED', async () => {
    const feed = new DerivFeed({ url: 'wss://ws.derivws.com/websockets/v3?app_id=1089' })
    await feed.connect()
    expect(feed.getConnectionStatus()).toBe('CONNECTED')
    expect(FakeWebSocket.instances[0]?.url).toContain('ws.derivws.com')
    feed.disconnect()
    expect(feed.getConnectionStatus()).toBe('DISCONNECTED')
  })

  it('lets concurrent callers wait for the socket that is still opening', async () => {
    const feed = new DerivFeed({ url: 'wss://test' })
    const first = feed.connect()
    const history = feed.getTicksHistory('R_100', 3)
    await first
    await expect(history).resolves.toMatchObject({ prices: [100.01, 100.02, 100.03] })
    expect(FakeWebSocket.instances).toHaveLength(1)
    feed.disconnect()
  })

  it('parses new-API active_symbols field names', async () => {
    const feed = new DerivFeed({ url: 'wss://test' })
    await feed.connect()
    const symbols = await feed.getActiveSymbols()
    const req = FakeWebSocket.instances[0]!.sent.find((s) => s.includes('active_symbols'))!
    expect(JSON.parse(req).product_type).toBeUndefined()
    expect(symbols).toContainEqual({
      symbol: '1HZ100V',
      displayName: 'Volatility 100 (1s) Index',
      market: 'synthetic_index',
      pipSize: 0.01,
    })
    expect(symbols.some((s) => s.symbol === 'R_100')).toBe(true)
    feed.disconnect()
  })

  it('normalizes tick payloads and prevents duplicate subscribe', async () => {
    const feed = new DerivFeed({ url: 'wss://test' })
    const ticks: Array<{ quote: number; symbol: string }> = []
    feed.onTick((t) => ticks.push(t))
    await feed.connect()
    await feed.subscribeTicks('R_100')
    await feed.subscribeTicks('R_100')
    const subscribeCalls = FakeWebSocket.instances[0]!.sent.filter((s) => s.includes('"ticks"'))
    expect(subscribeCalls.length).toBe(1)
    expect(ticks[0]?.symbol).toBe('R_100')
    expect(ticks[0]?.quote).toBe(1234.56)
    feed.disconnect()
  })

  it('streams official Deriv OHLC updates and forgets the string subscription id', async () => {
    class OhlcSocket extends FakeWebSocket {
      send(data: string) {
        const msg = JSON.parse(data) as Record<string, unknown>
        if (msg.ticks_history && msg.style === 'candles' && msg.subscribe === 1) {
          this.sent.push(data)
          queueMicrotask(() => {
            this.emit({
              msg_type: 'candles',
              req_id: msg.req_id,
              candles: [{ epoch: 1_791_020_880, open: 665.26, high: 665.26, low: 665.26, close: 665.26 }],
              subscription: { id: 'f6608d30-af94-7ffd-7fb9-3263b3cfb45e' },
            })
            this.emit({
              msg_type: 'ohlc',
              ohlc: {
                symbol: 'R_100',
                granularity: 60,
                open_time: 1_791_020_880,
                epoch: 1_791_020_884,
                open: '665.26',
                high: '665.26',
                low: '664.93',
                close: '664.93',
                pip_size: 2,
              },
              subscription: { id: 'f6608d30-af94-7ffd-7fb9-3263b3cfb45e' },
            })
          })
          return
        }
        super.send(data)
      }
    }
    vi.stubGlobal('WebSocket', OhlcSocket as unknown as typeof WebSocket)
    const feed = new DerivFeed({ url: 'wss://test' })
    await feed.connect()
    const updates: unknown[] = []
    const unsubscribe = feed.subscribeCandles('R_100', 60, (o) => updates.push(o))
    await vi.waitFor(() => expect(updates).toHaveLength(1))
    expect(updates[0]).toEqual({
      symbol: 'R_100',
      granularity: 60,
      openTime: 1_791_020_880,
      epoch: 1_791_020_884,
      open: 665.26,
      high: 665.26,
      low: 664.93,
      close: 664.93,
      pipSize: 0.01,
    })
    unsubscribe()
    await vi.waitFor(() =>
      expect(
        FakeWebSocket.instances[0]!.sent.some((s) =>
          s.includes('"forget":"f6608d30-af94-7ffd-7fb9-3263b3cfb45e"'),
        ),
      ).toBe(true),
    )
    feed.disconnect()
  })

  it('shares one in-flight ticks subscribe between concurrent callers', async () => {
    const feed = new DerivFeed({ url: 'wss://test' })
    await feed.connect()
    await Promise.all([feed.subscribeTicks('R_25'), feed.subscribeTicks('R_25')])
    const subscribeCalls = FakeWebSocket.instances[0]!.sent.filter((s) => s.includes('"ticks":"R_25"'))
    expect(subscribeCalls).toHaveLength(1)
    feed.disconnect()
  })

  it('forgets a tick subscription that resolves after the symbol was released', async () => {
    const feed = new DerivFeed({ url: 'wss://test' })
    await feed.connect()
    const pending = feed.subscribeTicks('R_50')
    await feed.unsubscribeTicks('R_50')
    await pending
    await vi.waitFor(() =>
      expect(FakeWebSocket.instances[0]!.sent.some((s) => s.includes('"forget":"99"'))).toBe(true),
    )
    feed.disconnect()
  })

  it('schedules reconnect with backoff after unexpected close', async () => {
    vi.useFakeTimers()
    const feed = new DerivFeed({
      url: 'wss://test',
      maxBackoffMs: 5_000,
      connectionTimeoutMs: 60_000,
    })
    const connectPromise = feed.connect()
    await vi.advanceTimersByTimeAsync(0)
    await connectPromise
    expect(feed.getConnectionStatus()).toBe('CONNECTED')
    FakeWebSocket.instances[0]!.close()
    expect(feed.getConnectionStatus()).toBe('RECONNECTING')
    await vi.advanceTimersByTimeAsync(1_000)
    expect(FakeWebSocket.instances.length).toBeGreaterThan(1)
    feed.disconnect()
  })

  it('falls back to ticks_history polling when ticks stream is rejected', async () => {
    class RejectTicksSocket extends FakeWebSocket {
      send(data: string) {
        this.sent.push(data)
        const msg = JSON.parse(data) as Record<string, unknown>
        const reqId = msg.req_id
        queueMicrotask(() => {
          if (msg.ticks) {
            this.emit({
              msg_type: 'tick',
              req_id: reqId,
              error: { code: 'InvalidSymbol', message: 'Symbol R_100 is invalid.' },
            })
            return
          }
          if (msg.ticks_history) {
            this.emit({
              msg_type: 'history',
              req_id: reqId,
              pip_size: 2,
              history: {
                prices: [607.12, 607.15],
                times: [1_700_000_000, 1_700_000_001],
              },
            })
            return
          }
          if (msg.forget) {
            this.emit({ msg_type: 'forget', req_id: reqId, forget: 1 })
          }
        })
      }
    }
    FakeWebSocket.instances = []
    vi.stubGlobal('WebSocket', RejectTicksSocket as unknown as typeof WebSocket)
    const feed = new DerivFeed({ url: 'wss://test' })
    const ticks: Array<{ quote: number; pipSize: number }> = []
    feed.onTick((t) => ticks.push(t))
    await feed.connect()
    await feed.subscribeTicks('R_100')
    // Allow poll once to resolve
    await new Promise((r) => setTimeout(r, 50))
    expect(ticks.length).toBeGreaterThan(0)
    expect(ticks[0]?.quote).toBe(607.15)
    expect(ticks[0]?.pipSize).toBe(0.01)
    feed.disconnect()
  })
})

describe('derivRealMarketDataProvider', () => {
  beforeEach(() => {
    FakeWebSocket.instances = []
    vi.stubGlobal('WebSocket', FakeWebSocket as unknown as typeof WebSocket)
    resetSharedDerivFeedForTests()
  })

  afterEach(() => {
    resetSharedDerivFeedForTests()
    vi.unstubAllGlobals()
  })

  it('lists REAL Deriv markets (never DEMO catalog)', async () => {
    const markets = await derivRealMarketDataProvider.listMarkets()
    expect(markets.length).toBeGreaterThan(0)
    expect(markets.every((m) => !m.isSimulated)).toBe(true)
    expect(markets.some((m) => m.symbol === 'R_100')).toBe(true)
  })

  it('loads historical candles without fabricating DEMO prices', async () => {
    const snap = await derivRealMarketDataProvider.getSnapshot('R_100', '1m')
    expect(snap.isSimulated).toBe(false)
    expect(snap.candles.length).toBeGreaterThan(0)
    expect(snap.feedLabel).toContain('Deriv')
  })

  it('rejects unsupported timeframe without inventing candles', async () => {
    const snap = await derivRealMarketDataProvider.getSnapshot('R_100', '5s' as Timeframe)
    expect(snap.candles).toEqual([])
    expect(snap.status).toBe('disconnected')
    expect(snap.note).toContain('REAL MARKET DATA NOT CONNECTED')
  })

  it('DEMO market data never falls back to simulated prices', async () => {
    const demo = await demoMarketDataProvider.listMarkets()
    const real = await derivRealMarketDataProvider.listMarkets()
    expect(demoMarketDataProvider.isSimulated).toBe(false)
    expect(derivRealMarketDataProvider.isSimulated).toBe(false)
    expect(demo.every((m) => !m.isSimulated && m.lastPrice == null)).toBe(true)
    expect(real.every((m) => !m.isSimulated)).toBe(true)
    expect(demoMarketDataProvider.getStatus()).not.toBe('simulated')
  })

  it('never places REAL trades from market-data path', async () => {
    const placed = await realTradingProvider.placeTrade({
      symbol: 'R_100',
      contractType: 'EVEN_ODD',
      contractOption: 'even',
      selectedDigit: null,
      barrier: null,
      stake: 1,
      durationMs: 5000,
      kind: 'real',
      accountMode: 'real',
    })
    expect(placed.connected).toBe(false)
    expect(placed.data).toBeNull()
    expect(placed.message).toMatch(/Sign in to trade|unavailable/i)
  })
})
