import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import ticketSource from '@/features/trading/TradeTicket.tsx?raw'
import autoPanelSource from '@/features/trading/AutoTradePanel.tsx?raw'
import scannerSource from '@/features/trading/DigitScanner.tsx?raw'
import tradingPageSource from '@/pages/trading/TradingPage.tsx?raw'
import demoProviderSource from '@/providers/trading/demo-trading-provider.ts?raw'
import realProviderSource from '@/providers/trading/real-trading-provider.ts?raw'
import autoTraderSource from '@/providers/bots/auto-trader.ts?raw'
import autoTradeDomainSource from '@/domain/auto-trade.ts?raw'
import { AUTO_HIDDEN_DEFAULTS, AUTO_TRADE_DEFAULTS, type AutoAccount, type AutoTradeSettings } from '@/domain/auto-trade'
import { bestScanPick } from '@/domain/digit-scanner'
import {
  LOAD_PREDICTION_FIRST,
  loadedPredictionText,
  predictionLabel,
  scanResultFromPick,
  selectionOf,
  volatilityLabelOf,
  type ScanResult,
} from '@/domain/prediction'
import { createPredictionStore, type PredictionStore } from '@/lib/prediction-store'
import type { AccountExecutor, AutoOrder } from '@/providers/bots/auto-trade-executors'
import { PREDICTION_CHANGED_STOP, createAutoTradeEngine, type AutoTradeEngine } from '@/providers/bots/auto-trader'
import type { ContractType, Trade } from '@/types'

/** Mocked account: records every order, opens it, then settles it with the scripted outcome. */
function mockProvider(account: AutoAccount, outcomes: Array<'won' | 'lost'> = []) {
  const queue = [...outcomes]
  const placed: AutoOrder[] = []
  const trades = new Map<string, Trade>()
  const executor: AccountExecutor = {
    account,
    async getBalance() {
      return 10_000
    },
    async execute(order) {
      placed.push(order)
      const id = `${account}-${placed.length}`
      const at = new Date(1_700_000_000_000 + placed.length * 1000).toISOString()
      const trade = {
        id,
        symbol: order.symbol,
        ...order.selection,
        stake: order.stake,
        status: 'open',
        accountMode: account === 'REAL' ? 'real' : 'demo',
        isSimulated: account === 'DEMO',
        createdAt: at,
        updatedAt: at,
        resolvedAt: null,
      } as unknown as Trade
      trades.set(id, trade)
      return { ok: true, trade }
    },
    async getTrade(id) {
      const trade = trades.get(id)!
      if (trade.status !== 'open') return trade
      const outcome = queue.shift() ?? 'won'
      const settled = {
        ...trade,
        status: outcome,
        exitDigit: 3,
        profitLoss: outcome === 'won' ? Math.round(trade.stake * 0.9 * 100) / 100 : -trade.stake,
        resolvedAt: trade.createdAt,
      } as Trade
      trades.set(id, settled)
      return settled
    },
  }
  return { executor, placed, spy: vi.spyOn(executor, 'execute') }
}

function settingsFor(account: AutoAccount, patch: Partial<AutoTradeSettings> = {}): AutoTradeSettings {
  return {
    account,
    ...AUTO_HIDDEN_DEFAULTS,
    durationTicks: 1,
    baseStake: 1,
    ...AUTO_TRADE_DEFAULTS,
    ...patch,
  }
}

/** Genuine-looking digit samples per volatility; `bias` digits dominate so the scanner's single best pick is known. */
function digits(bias: number[], n = 1000): number[] {
  return Array.from({ length: n }, (_, i) => (i % 4 === 0 ? i % 10 : bias[i % bias.length]!))
}

const ODD_HEAVY = [
  { symbol: 'R_10', digits: digits([0, 1, 2, 3, 4, 5, 6, 7, 8, 9]) },
  { symbol: 'R_75', digits: digits([1, 3, 5, 7, 9]) },
]
const EVEN_HEAVY = [
  { symbol: 'R_10', digits: digits([0, 1, 2, 3, 4, 5, 6, 7, 8, 9]) },
  { symbol: '1HZ50V', digits: digits([0, 2, 4, 6, 8]) },
]
const NAMES: Record<string, string> = {
  R_10: 'Volatility 10 Index',
  R_75: 'Volatility 75 Index',
  '1HZ50V': 'Volatility 50 (1s) Index',
}

let scanSeq = 0
/** Same steps as the AI BOT SCANNER: begin (clears loaded), rank every volatility, store exactly one result. */
function scan(store: PredictionStore, markets: typeof ODD_HEAVY, contract: ContractType = 'EVEN_ODD'): ScanResult {
  store.beginScan()
  const pick = bestScanPick(markets, contract)!
  scanSeq += 1
  const result = scanResultFromPick(pick, volatilityLabelOf(pick.symbol, NAMES[pick.symbol]), 1_700_000_000_000, `scan-${scanSeq}`)
  store.completeScan(result)
  return result
}

async function untilStopped(engine: AutoTradeEngine): Promise<string> {
  for (let i = 0; i < 5000; i += 1) {
    const s = engine.getSnapshot().session
    if (s?.status === 'stopped') return s.stopReason ?? ''
    await new Promise((resolve) => setTimeout(resolve, 0))
  }
  throw new Error('Auto Trade did not stop')
}

describe('Scanner → Load Prediction → Auto Trade', () => {
  let store: PredictionStore
  let mode: AutoAccount
  let demo: ReturnType<typeof mockProvider>
  let real: ReturnType<typeof mockProvider>
  let engine: AutoTradeEngine
  let keySeq = 0

  function makeEngine(outcomes: Array<'won' | 'lost'> = []) {
    demo = mockProvider('DEMO', outcomes)
    real = mockProvider('REAL', outcomes)
    engine = createAutoTradeEngine({
      executors: { demo: demo.executor, real: real.executor },
      currentPrediction: () => store.getLoaded(),
      currentMode: () => mode,
      sleep: async () => undefined,
      now: () => 1_700_000_000_000,
      quote: () => 1234.56,
      ensureFeed: () => undefined,
      lastTickAt: () => 1_700_000_000_000,
      newKey: () => `key-${String((keySeq += 1)).padStart(8, '0')}`,
      maxRetries: 2,
    })
  }

  function startRun(account: AutoAccount, patch: Partial<AutoTradeSettings> = {}) {
    return engine.start(settingsFor(account, { maxTrades: 6, targetProfit: 10_000, ...patch }), account, {
      realConfirmed: account === 'REAL',
      prediction: store.getLoaded(),
    })
  }

  beforeEach(() => {
    store = createPredictionStore(() => 1_700_000_000_500)
    mode = 'DEMO'
    makeEngine()
  })

  it('T1: DEMO scan → load → Auto Trade executes exactly the loaded prediction', async () => {
    const result = scan(store, ODD_HEAVY)
    expect(predictionLabel(result)).toBe('ODD')
    expect(result.volatilityLabel).toBe('75')
    const loaded = store.load()!
    expect(loaded).toEqual({ ...result, loadedAt: 1_700_000_000_500 })
    expect(loadedPredictionText(loaded)).toBe('PREDICTION LOADED · ODD · Volatility 75 · READY TO TRADE')

    expect(startRun('DEMO').ok).toBe(true)
    await untilStopped(engine)
    expect(demo.placed).toHaveLength(6)
    for (const order of demo.placed) {
      expect(order.account).toBe('DEMO')
      expect(order.symbol).toBe(loaded.symbol)
      expect(order.selection).toEqual(selectionOf(loaded))
    }
    expect(real.spy).not.toHaveBeenCalled()
  })

  it('T2: REAL (mocked provider) gets exactly the loaded side and symbol; DEMO gets nothing', async () => {
    mode = 'REAL'
    scan(store, ODD_HEAVY)
    const loaded = store.load()!
    expect(startRun('REAL').ok).toBe(true)
    await untilStopped(engine)
    expect(real.placed.length).toBeGreaterThan(0)
    for (const order of real.placed) {
      expect(order.account).toBe('REAL')
      expect(order.symbol).toBe('R_75')
      expect(order.selection.contractOption).toBe('odd')
      expect(order.selection).toEqual(selectionOf(loaded))
    }
    expect(demo.spy).not.toHaveBeenCalled()
  })

  it('T3: no loaded prediction → no trade and the "load a prediction" message', async () => {
    expect(startRun('DEMO')).toEqual({ ok: false, error: LOAD_PREDICTION_FIRST })
    expect(LOAD_PREDICTION_FIRST).toBe('Load a prediction before starting Auto Trade.')
    scan(store, ODD_HEAVY)
    expect(startRun('DEMO')).toEqual({ ok: false, error: LOAD_PREDICTION_FIRST })
    mode = 'REAL'
    expect(startRun('REAL')).toEqual({ ok: false, error: LOAD_PREDICTION_FIRST })
    await new Promise((resolve) => setTimeout(resolve, 0))
    expect(engine.getSnapshot().session).toBeNull()
    expect(demo.spy).not.toHaveBeenCalled()
    expect(real.spy).not.toHaveBeenCalled()
  })

  it('T4: ODD stays ODD through wins and losses, with no randomness', async () => {
    makeEngine(['lost', 'won', 'lost', 'lost', 'won', 'won', 'lost', 'won'])
    scan(store, ODD_HEAVY)
    store.load()
    const random = vi.spyOn(Math, 'random').mockImplementation(() => {
      throw new Error('Math.random must not be used by Auto Trade')
    })
    try {
      expect(startRun('DEMO', { maxTrades: 8 }).ok).toBe(true)
      await untilStopped(engine)
    } finally {
      random.mockRestore()
    }
    expect(demo.placed).toHaveLength(8)
    expect(new Set(demo.placed.map((o) => o.selection.contractOption))).toEqual(new Set(['odd']))
    expect(new Set(demo.placed.map((o) => o.symbol))).toEqual(new Set(['R_75']))
  })

  it('T5: EVEN stays EVEN', async () => {
    makeEngine(['lost', 'lost', 'won', 'lost', 'won', 'won'])
    const result = scan(store, EVEN_HEAVY)
    expect(predictionLabel(result)).toBe('EVEN')
    expect(result.volatilityLabel).toBe('50 (1s)')
    store.load()
    expect(startRun('DEMO').ok).toBe(true)
    await untilStopped(engine)
    expect(demo.placed).toHaveLength(6)
    expect(demo.placed.every((o) => o.selection.contractOption === 'even' && o.symbol === '1HZ50V')).toBe(true)
  })

  it('T6: load ODD, rescan → EVEN clears it; blocked until EVEN is loaded, then only EVEN trades', async () => {
    scan(store, ODD_HEAVY)
    const odd = store.load()!
    expect(odd.side).toBe('odd')

    const even = scan(store, EVEN_HEAVY)
    expect(store.getLoaded()).toBeNull()
    expect(startRun('DEMO')).toEqual({ ok: false, error: LOAD_PREDICTION_FIRST })
    expect(demo.spy).not.toHaveBeenCalled()

    const loaded = store.load()!
    expect(loaded.id).toBe(even.id)
    expect(startRun('DEMO').ok).toBe(true)
    await untilStopped(engine)
    expect(demo.placed.length).toBeGreaterThan(0)
    expect(demo.placed.every((o) => o.selection.contractOption === 'even' && o.symbol === '1HZ50V')).toBe(true)
  })

  it('T6b: a scan while Auto Trade runs aborts the run before the next order', async () => {
    scan(store, ODD_HEAVY)
    store.load()
    let orders = 0
    const original = demo.executor.execute
    demo.executor.execute = async (order) => {
      orders += 1
      if (orders === 2) scan(store, EVEN_HEAVY)
      return original(order)
    }
    expect(startRun('DEMO', { maxTrades: 20 }).ok).toBe(true)
    expect(await untilStopped(engine)).toBe(PREDICTION_CHANGED_STOP)
    expect(orders).toBe(2)
    expect(demo.placed.every((o) => o.selection.contractOption === 'odd')).toBe(true)
  })

  it('T7: switching DEMO ↔ REAL keeps the loaded prediction unchanged, and a mid-run switch aborts the run', async () => {
    scan(store, ODD_HEAVY)
    const loaded = store.load()!
    mode = 'REAL'
    expect(store.getLoaded()).toBe(loaded)
    mode = 'DEMO'
    expect(store.getLoaded()).toBe(loaded)

    let orders = 0
    const original = demo.executor.execute
    demo.executor.execute = async (order) => {
      orders += 1
      if (orders === 1) mode = 'REAL'
      return original(order)
    }
    expect(startRun('DEMO', { maxTrades: 20 }).ok).toBe(true)
    expect(await untilStopped(engine)).toBe('Switched to REAL')
    expect(orders).toBe(1)
    expect(real.spy).not.toHaveBeenCalled()
    expect(store.getLoaded()).toBe(loaded)
  })

  it('T8: several scans leave exactly one result — the latest', () => {
    const first = scan(store, ODD_HEAVY)
    const second = scan(store, EVEN_HEAVY)
    const third = scan(store, ODD_HEAVY, 'MATCH_DIFFER')
    const state = store.getSnapshot()
    expect(Array.isArray(state.latest)).toBe(false)
    expect(state.latest).toEqual(third)
    expect(state.latest?.id).not.toBe(first.id)
    expect(state.latest?.id).not.toBe(second.id)
    expect(third.contract).toBe('MATCH_DIFFER')
    expect(third.digit).toEqual(expect.any(Number))
    expect(store.load()).toMatchObject({ id: third.id, side: third.side, digit: third.digit, symbol: third.symbol })
  })

  it('LOAD PREDICTION copies the result as is and never rescans', () => {
    const result = scan(store, ODD_HEAVY, 'OVER_UNDER')
    const before = store.getSnapshot().latest
    const loaded = store.load()!
    expect(store.getSnapshot().latest).toBe(before)
    expect(loaded).toMatchObject({ ...result })
    expect(loaded.barrier).toEqual(expect.any(Number))
    expect(Object.isFrozen(loaded)).toBe(true)
  })

  it('a manual ticket change clears the loaded prediction with a notice', () => {
    scan(store, ODD_HEAVY)
    store.load()
    store.invalidate('Prediction cleared — ticket changed')
    expect(store.getSnapshot()).toMatchObject({ loaded: null, notice: 'Prediction cleared — ticket changed' })
    expect(startRun('DEMO')).toEqual({ ok: false, error: LOAD_PREDICTION_FIRST })
  })
})

describe('T9: no account-mode banners', () => {
  const sources = { ticketSource, autoPanelSource, scannerSource, tradingPageSource, demoProviderSource, realProviderSource }
  const banned = [
    /REAL ACTIVE/,
    /can lose your stake/i,
    /REAL limits checked by the server/,
    /per trade\s*<\/p>/,
    /Real money —/,
    /DEMO TRADE OPENED/,
    /REAL trade opened/,
    /You are trading on/i,
    /Prediction loaded:/,
    /BOT PICK/,
    /Auto direction/,
  ]

  it.each(Object.entries(sources))('%s has none of the removed banner strings', (_name, source) => {
    for (const pattern of banned) expect(source).not.toMatch(pattern)
  })

  it('keeps the money-safety confirmations and the REAL MONEY status badge', () => {
    expect(ticketSource).toMatch(/Confirm REAL trade/)
    expect(ticketSource).toMatch(/REAL MONEY TRADE/)
    expect(autoPanelSource).toMatch(/Start REAL Auto Trade/)
    expect(tradingPageSource).toMatch(/'REAL MONEY'/)
  })
})

describe('Auto Trade cannot generate a prediction', () => {
  it('has no random, scanner or alternate-pick code paths', () => {
    for (const source of [autoTraderSource, autoTradeDomainSource, autoPanelSource]) {
      expect(source).not.toMatch(/Math\.random|cryptoRandomInt|pickRandom|randomSymbol|randomContract|randomTarget|pickAutoParams/)
      expect(source).not.toMatch(/digit-scanner|bestScanPick|rankVolatilities|strongestSetup/)
    }
  })
})

afterEach(() => vi.restoreAllMocks())
