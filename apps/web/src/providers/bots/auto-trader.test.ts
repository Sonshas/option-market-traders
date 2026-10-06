import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { AUTO_TRADE_DEFAULTS, type AutoAccount, type AutoTradeSettings } from '@/domain/auto-trade'
import { loadDemoState, resetDemoState } from '@/lib/demo-store'
import {
  REAL_CONNECTION_INACTIVE,
  demoExecutor,
  executeTrade,
  type AccountExecutor,
  type AutoOrder,
  type ExecutionResult,
} from '@/providers/bots/auto-trade-executors'
import { createAutoTradeEngine, type AutoTradeEngine } from '@/providers/bots/auto-trader'
import type { LoadedPrediction } from '@/domain/prediction'
import { demoTradingProvider, settleDemoTrades } from '@/providers/trading/demo-trading-provider'
import { clearTickBufferForTests, recordTicks } from '@/providers/market-data/tick-buffer'
import type { Tick, Trade } from '@/types'

const EVEN_R100: LoadedPrediction = {
  id: 'scan-even',
  contract: 'EVEN_ODD',
  side: 'even',
  symbol: 'R_100',
  volatilityLabel: '100',
  scannedAt: 1_700_000_000_000,
  sampleSize: 1000,
  loadedAt: 1_700_000_000_000,
}

function settingsFor(account: AutoAccount, patch: Partial<AutoTradeSettings> = {}): AutoTradeSettings {
  return {
    account,
    durationTicks: 1,
    baseStake: 1,
    maxTrades: 50,
    stopOnInsufficientBalance: true,
    ...AUTO_TRADE_DEFAULTS,
    maxLossStreak: 3,
    ...patch,
  }
}

type Outcome = 'won' | 'lost'

/** Fake account: opens each order, then reports it settled with the next scripted outcome. */
function fakeExecutor(
  account: AutoAccount,
  opts: { balance?: number | null; outcomes?: Outcome[]; reject?: ExecutionResult } = {},
) {
  const outcomes = [...(opts.outcomes ?? [])]
  const placed: AutoOrder[] = []
  const trades = new Map<string, Trade>()
  let balance = opts.balance === undefined ? 1000 : opts.balance
  const executor: AccountExecutor = {
    account,
    async getBalance() {
      return balance
    },
    async execute(order) {
      if (opts.reject) return opts.reject
      placed.push(order)
      const id = `t${placed.length}`
      const now = new Date(1_700_000_000_000 + placed.length * 10_000).toISOString()
      const trade = {
        id,
        symbol: order.symbol,
        market: order.symbol,
        ...order.selection,
        stake: order.stake,
        status: 'open',
        exitDigit: null,
        profitLoss: null,
        accountMode: account === 'REAL' ? 'real' : 'demo',
        isSimulated: account === 'DEMO',
        createdAt: now,
        updatedAt: now,
        resolvedAt: null,
      } as unknown as Trade
      trades.set(id, trade)
      balance = (balance ?? 0) - order.stake
      return { ok: true, trade }
    },
    async getTrade(id) {
      const trade = trades.get(id)!
      if (trade.status !== 'open') return trade
      const outcome = outcomes.shift() ?? 'lost'
      const profit = outcome === 'won' ? Math.round(trade.stake * 0.9 * 100) / 100 : -trade.stake
      if (outcome === 'won') balance = (balance ?? 0) + trade.stake + profit
      const settled = {
        ...trade,
        status: outcome,
        exitDigit: outcome === 'won' ? 2 : 1,
        profitLoss: profit,
        resolvedAt: trade.createdAt,
      } as Trade
      trades.set(id, settled)
      return settled
    },
  }
  return { executor, placed, spy: vi.spyOn(executor, 'execute') }
}

function engineWith(
  demo: AccountExecutor,
  real: AccountExecutor,
  patch: { lastTickAt?: (s: string) => number; mode?: AutoAccount; prediction?: LoadedPrediction | null } = {},
) {
  return createAutoTradeEngine({
    executors: { demo, real },
    currentPrediction: () => (patch.prediction === undefined ? EVEN_R100 : patch.prediction),
    currentMode: () => patch.mode ?? 'DEMO',
    sleep: async () => undefined,
    now: () => 1_700_000_000_000,
    quote: () => 1234.56,
    ensureFeed: () => undefined,
    lastTickAt: patch.lastTickAt ?? (() => 1_700_000_000_000),
    newKey: () => `key-${Math.random().toString(36).slice(2, 10)}`,
    maxRetries: 3,
  })
}

async function untilStopped(engine: AutoTradeEngine): Promise<string> {
  for (let i = 0; i < 5000; i += 1) {
    const s = engine.getSnapshot().session
    if (s?.status === 'stopped') return s.stopReason ?? ''
    await new Promise((resolve) => setTimeout(resolve, 0))
  }
  throw new Error('Auto Trade did not stop')
}

describe('executor mode guard', () => {
  const order = (account: AutoAccount): AutoOrder => ({
    account,
    symbol: 'R_100',
    selection: { contractType: 'EVEN_ODD', contractOption: 'even', selectedDigit: null, barrier: null },
    stake: 1,
    durationTicks: 1,
    runId: 'run',
    idempotencyKey: 'key-12345678',
  })

  it('routes DEMO orders only to the DEMO executor and REAL only to the REAL executor', async () => {
    const demo = fakeExecutor('DEMO')
    const real = fakeExecutor('REAL')
    expect((await executeTrade('DEMO', { demo: demo.executor, real: real.executor }, order('DEMO'))).ok).toBe(true)
    expect((await executeTrade('REAL', { demo: demo.executor, real: real.executor }, order('REAL'))).ok).toBe(true)
    expect(demo.placed).toHaveLength(1)
    expect(real.placed).toHaveLength(1)
  })

  it('blocks an order whose account does not match the selected mode', async () => {
    const demo = fakeExecutor('DEMO')
    const real = fakeExecutor('REAL')
    const result = await executeTrade('DEMO', { demo: demo.executor, real: real.executor }, order('REAL'))
    expect(result).toMatchObject({ ok: false, code: 'MODE_MISMATCH' })
    expect(demo.spy).not.toHaveBeenCalled()
    expect(real.spy).not.toHaveBeenCalled()
  })

  it('blocks when the executor in a slot belongs to the other account (never falls back)', async () => {
    const demo = fakeExecutor('DEMO')
    const real = fakeExecutor('REAL')
    const swapped = { demo: real.executor, real: demo.executor }
    expect(await executeTrade('REAL', swapped, order('REAL'))).toMatchObject({ ok: false, code: 'MODE_MISMATCH' })
    expect(await executeTrade('DEMO', swapped, order('DEMO'))).toMatchObject({ ok: false, code: 'MODE_MISMATCH' })
    expect(demo.spy).not.toHaveBeenCalled()
    expect(real.spy).not.toHaveBeenCalled()
  })
})

describe('Auto Trade start rules', () => {
  it('REAL needs the per-run real-money confirmation', () => {
    const engine = engineWith(fakeExecutor('DEMO').executor, fakeExecutor('REAL').executor, { mode: 'REAL' })
    expect(engine.start(settingsFor('REAL'), 'REAL', { prediction: EVEN_R100 })).toMatchObject({
      ok: false,
      error: expect.stringMatching(/real-money/),
    })
    expect(engine.getSnapshot().session).toBeNull()
  })

  it('refuses settings for the other account', () => {
    const engine = engineWith(fakeExecutor('DEMO').executor, fakeExecutor('REAL').executor, { mode: 'REAL' })
    expect(engine.start(settingsFor('DEMO'), 'REAL', { realConfirmed: true, prediction: EVEN_R100 }).ok).toBe(false)
    expect(engine.start(settingsFor('REAL'), 'DEMO', { prediction: EVEN_R100 }).ok).toBe(false)
  })

  it('refuses to start when the selected mode differs from the run mode', () => {
    const demo = fakeExecutor('DEMO')
    const engine = engineWith(demo.executor, fakeExecutor('REAL').executor, { mode: 'REAL' })
    expect(engine.start(settingsFor('DEMO'), 'DEMO', { prediction: EVEN_R100 })).toMatchObject({ ok: false })
    expect(demo.spy).not.toHaveBeenCalled()
  })

  it('stopIfNotMode ends a run when the account mode changes', async () => {
    const real = fakeExecutor('REAL', { outcomes: Array(40).fill('won') })
    const engine = engineWith(fakeExecutor('DEMO').executor, real.executor, { mode: 'REAL' })
    expect(
      engine.start(settingsFor('REAL', { targetProfit: 1000 }), 'REAL', { realConfirmed: true, prediction: EVEN_R100 }).ok,
    ).toBe(true)
    engine.stopIfNotMode('DEMO', 'Switched to DEMO')
    expect(await untilStopped(engine)).toBe('Switched to DEMO')
  })
})

describe.each(['DEMO', 'REAL'] as const)('%s Auto Trade stop rules (mocked executor)', (account) => {
  const opts = account === 'REAL' ? { realConfirmed: true, prediction: EVEN_R100 } : { prediction: EVEN_R100 }

  function setup(executorOpts: Parameters<typeof fakeExecutor>[1] = {}, engineOpts: Parameters<typeof engineWith>[2] = {}) {
    const own = fakeExecutor(account, executorOpts)
    const other = fakeExecutor(account === 'REAL' ? 'DEMO' : 'REAL')
    const withMode = { mode: account, ...engineOpts }
    const engine = account === 'REAL' ? engineWith(other.executor, own.executor, withMode) : engineWith(own.executor, other.executor, withMode)
    return { own, other, engine }
  }

  it('Martingale stakes, waits for each settlement, stops on the loss streak and never uses the other account', async () => {
    const { own, other, engine } = setup({ outcomes: ['lost', 'lost', 'lost'] })
    expect(engine.start(settingsFor(account), account, opts).ok).toBe(true)
    expect(await untilStopped(engine)).toMatch(/3 losses in a row/)
    expect(own.placed.map((o) => o.stake)).toEqual([1, 2, 4])
    expect(own.placed.every((o) => o.account === account)).toBe(true)
    expect(other.spy).not.toHaveBeenCalled()
    const snap = engine.getSnapshot()
    expect(snap.progress.realizedPnl).toBe(-7)
    expect(snap.session?.lastResult?.result).toBe('LOSS')
  })

  it('stops at the target profit', async () => {
    const { own, engine } = setup({ outcomes: Array(10).fill('won') })
    engine.start(settingsFor(account, { baseStake: 10, targetProfit: 20 }), account, opts)
    expect(await untilStopped(engine)).toMatch(/Target profit reached/)
    expect(own.placed).toHaveLength(3)
  })

  it('stops at the stop loss', async () => {
    const { engine } = setup({ outcomes: Array(10).fill('lost') })
    engine.start(settingsFor(account, { baseStake: 10, multiplier: 1, stopLoss: 30, maxLossStreak: 10 }), account, opts)
    expect(await untilStopped(engine)).toMatch(/Stop loss reached/)
  })

  it('stops after the number of trades', async () => {
    const { own, engine } = setup({ outcomes: ['won', 'lost', 'won', 'lost'] })
    engine.start(settingsFor(account, { maxTrades: 4, targetProfit: 100 }), account, opts)
    expect(await untilStopped(engine)).toMatch(/4 of 4 trades/)
    expect(own.placed).toHaveLength(4)
  })

  it('stops before a stake above the max stake', async () => {
    const { own, engine } = setup({ outcomes: Array(10).fill('lost') })
    engine.start(settingsFor(account, { maxStake: 5, maxLossStreak: 10 }), account, opts)
    expect(await untilStopped(engine)).toMatch(/above the max stake/)
    expect(own.placed.map((o) => o.stake)).toEqual([1, 2, 4])
  })

  it('stops on insufficient balance', async () => {
    const { own, engine } = setup({ balance: 2.5, outcomes: Array(10).fill('lost') })
    engine.start(settingsFor(account, { maxLossStreak: 10 }), account, opts)
    expect(await untilStopped(engine)).toMatch(/Balance too low/)
    expect(own.placed.map((o) => o.stake)).toEqual([1])
  })

  it('falls back to the base stake when stop-on-insufficient-balance is off', async () => {
    const { own, engine } = setup({ balance: 4, outcomes: ['lost', 'lost', 'lost'] })
    engine.start(settingsFor(account, { stopOnInsufficientBalance: false, maxTrades: 3 }), account, opts)
    await untilStopped(engine)
    expect(own.placed.map((o) => o.stake)).toEqual([1, 2, 1])
  })

  it('stops when the balance cannot be read', async () => {
    const { own, engine } = setup({ balance: null })
    engine.start(settingsFor(account), account, opts)
    expect(await untilStopped(engine)).toMatch(/balance unavailable/)
    expect(own.placed).toHaveLength(0)
  })

  it('stops with the server reason when an order is rejected', async () => {
    const { engine } = setup({
      reject: { ok: false, code: 'REJECTED', message: 'You already have 5 open REAL trades. Wait for one to settle.' },
    })
    engine.start(settingsFor(account), account, opts)
    expect(await untilStopped(engine)).toMatch(/5 open REAL trades/)
  })

  it('stops when the live feed has stalled and places nothing', async () => {
    const { own, engine } = setup({}, { lastTickAt: () => 0 })
    engine.start(settingsFor(account), account, opts)
    expect(await untilStopped(engine)).toMatch(/Live price feed stopped/)
    expect(own.placed).toHaveLength(0)
  })

  it('every order is exactly the loaded prediction (no other symbol, contract or side)', async () => {
    const { own, engine } = setup({ outcomes: Array(30).fill(0).map((_, i) => (i % 3 ? 'won' : 'lost')) })
    engine.start(settingsFor(account, { maxTrades: 30, targetProfit: 10_000 }), account, opts)
    await untilStopped(engine)
    expect(own.placed).toHaveLength(30)
    for (const order of own.placed) {
      expect(order.symbol).toBe('R_100')
      expect(order.selection).toEqual({ contractType: 'EVEN_ODD', contractOption: 'even', selectedDigit: null, barrier: null })
    }
  })
})

describe('REAL unavailable', () => {
  it('stops with the connection message and never touches DEMO', async () => {
    const demo = fakeExecutor('DEMO')
    const real = fakeExecutor('REAL', { reject: { ok: false, code: 'UNAVAILABLE', message: REAL_CONNECTION_INACTIVE } })
    const engine = engineWith(demo.executor, real.executor, { mode: 'REAL' })
    engine.start(settingsFor('REAL'), 'REAL', { realConfirmed: true, prediction: EVEN_R100 })
    expect(await untilStopped(engine)).toBe(REAL_CONNECTION_INACTIVE)
    expect(demo.spy).not.toHaveBeenCalled()
  })
})

function tick(price: number, timestamp: number): Tick {
  return { symbol: 'R_100', price, timestamp, pipSize: 0.01, lastDigit: Math.round(price / 0.01) % 10, isSimulated: false, feedLabel: 'test' }
}

describe('DEMO Auto Trade on the real DEMO provider', () => {
  beforeEach(() => {
    resetDemoState()
    clearTickBufferForTests()
  })
  afterEach(() => clearTickBufferForTests())

  it('settles on genuine ticks through settleDemoTrades and stops on the loss streak', async () => {
    let clock = Date.now()
    recordTicks('R_100', [100.01, 100.02, 100.03].map((p, i) => tick(p, clock - 3000 + i * 1000)))
    const engine = createAutoTradeEngine({
      executors: { demo: demoExecutor, real: fakeExecutor('REAL').executor },
      currentPrediction: () => EVEN_R100,
      currentMode: () => 'DEMO',
      sleep: async () => {
        // Each poll: one new odd-digit live tick arrives (EVEN loses).
        clock += 2000
        recordTicks('R_100', [tick(100.05, clock)])
        settleDemoTrades(clock + 100)
      },
      now: () => clock,
      ensureFeed: () => undefined,
      lastTickAt: () => clock,
      maxRetries: 3,
    })
    expect(engine.start(settingsFor('DEMO'), 'DEMO', { prediction: EVEN_R100 }).ok).toBe(true)
    expect(await untilStopped(engine)).toMatch(/3 losses in a row/)
    const trades = loadDemoState().trades
    expect(trades.map((t) => t.stake).sort()).toEqual([1, 2, 4])
    expect(trades.every((t) => t.status === 'lost' && t.exitDigit === 5)).toBe(true)
    expect(engine.getSnapshot().progress.realizedPnl).toBe(-7)
  })
})

describe('DEMO tick settlement', () => {
  beforeEach(() => {
    resetDemoState()
    clearTickBufferForTests()
  })

  it('settles on the Nth live tick after entry, not on time', async () => {
    const t0 = Date.now()
    recordTicks('R_100', [tick(100.01, t0 - 2000), tick(100.02, t0 - 1000)])
    const placed = await demoTradingProvider.placeTrade({
      symbol: 'R_100',
      contractType: 'EVEN_ODD',
      contractOption: 'odd',
      selectedDigit: null,
      barrier: null,
      stake: 10,
      durationMs: 0,
      durationTicks: 3,
      kind: 'demo',
      accountMode: 'demo',
    })
    expect(placed.connected).toBe(true)
    const trade = loadDemoState().trades[0]!
    expect(trade.durationTicks).toBe(3)
    expect(trade.tickAnchorMs).toBe(t0 - 1000)

    recordTicks('R_100', [tick(100.04, t0 + 1000), tick(100.06, t0 + 3000)])
    settleDemoTrades(t0 + 60_000)
    expect(loadDemoState().trades[0]!.status).toBe('open')

    recordTicks('R_100', [tick(100.07, t0 + 5000), tick(100.08, t0 + 7000)])
    settleDemoTrades(t0 + 60_000)
    const settled = loadDemoState().trades[0]!
    expect(settled.status).toBe('won')
    expect(settled.exitPrice).toBe(100.07)
    expect(settled.payout).toBe(19)
  })
})
