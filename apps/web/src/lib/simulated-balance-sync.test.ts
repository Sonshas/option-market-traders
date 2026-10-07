import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { loadDemoState, resetDemoState } from '@/lib/demo-store'
import { setPracticeBook, type PracticeBook } from '@/lib/practice-book'
import {
  isSimulatedSyncActive,
  receiveSimulatedSnapshot,
  recordSimulatedChange,
  startSimulatedSync,
  stopSimulatedSync,
  type SimulatedChange,
  type SimulatedSnapshot,
  type SimulatedTransport,
} from '@/lib/simulated-balance-sync'
import { getSimulatedWinRate, resetSimulatedWinRate, setSimulatedWinRate } from '@/lib/sim-win-rate'
import { DEMO_STARTING_BALANCE } from '@/providers/config'
import { demoTradingProvider, settleDemoTrades, stopDemoSettlementLoop } from '@/providers/trading/demo-trading-provider'
import { clearTickBufferForTests, recordTicks } from '@/providers/market-data/tick-buffer'
import type { Tick } from '@/types'

function fakeServer(initial: Partial<Record<PracticeBook, number>> = {}) {
  const rows: Record<PracticeBook, SimulatedSnapshot> = {
    demo: { book: 'demo', balance: initial.demo ?? DEMO_STARTING_BALANCE, version: 1 },
    practice: { book: 'practice', balance: initial.practice ?? DEMO_STARTING_BALANCE, version: 1 },
  }
  const calls: SimulatedChange[] = []
  let reject = false
  const transport: SimulatedTransport = {
    async apply(change) {
      calls.push(change)
      if (reject) throw new Error('insufficient_simulated_balance')
      const row = rows[change.book]
      const delta = change.kind === 'stake' || change.kind === 'withdraw' ? -change.amount : change.amount
      rows[change.book] = { ...row, balance: Math.round((row.balance + delta) * 100) / 100, version: row.version + 1, updatedBy: 'user' }
      return rows[change.book]
    },
    async fetchAll() {
      return [rows.demo, rows.practice]
    },
  }
  return {
    transport,
    calls,
    rows,
    rejectNext(value: boolean) {
      reject = value
    },
    adminSet(book: PracticeBook, balance: number): SimulatedSnapshot {
      rows[book] = { book, balance, version: rows[book].version + 1, updatedBy: 'admin' }
      return rows[book]
    },
  }
}

function tick(price: number, timestamp: number): Tick {
  return { symbol: 'R_75', price, timestamp, pipSize: 0.01, lastDigit: Math.round(price / 0.01) % 10, isSimulated: false, feedLabel: 'test feed' }
}

let clock = Date.now()

async function tradeEven(exitPrice: number) {
  const t0 = (clock += 10_000)
  recordTicks('R_75', [tick(1234.56, t0)])
  const placed = await demoTradingProvider.placeTrade({
    symbol: 'R_75',
    contractType: 'EVEN_ODD',
    contractOption: 'even',
    stake: 10,
    durationMs: 2_000,
    kind: 'demo',
    accountMode: 'demo',
  })
  expect(placed.data).not.toBeNull()
  recordTicks('R_75', [tick(exitPrice, t0 + 2_000)])
  const settled = settleDemoTrades(t0 + 5_000)
  return { trade: placed.data!, result: settled[0]?.result }
}

const flush = () => new Promise((resolve) => setTimeout(resolve, 0))

beforeEach(() => {
  clearTickBufferForTests()
  setPracticeBook('practice')
  resetDemoState()
  setPracticeBook('demo')
  resetDemoState()
})

afterEach(() => {
  stopSimulatedSync()
  resetSimulatedWinRate()
  stopDemoSettlementLoop()
  setPracticeBook('demo')
  clearTickBufferForTests()
})

describe('simulated balance sync', () => {
  it('does nothing while signed out (no transport)', async () => {
    expect(isSimulatedSyncActive()).toBe(false)
    await recordSimulatedChange('topup', 50)
    receiveSimulatedSnapshot({ book: 'demo', balance: 1, version: 99, updatedBy: 'admin' })
    expect(loadDemoState().wallet.availableBalance).toBe(DEMO_STARTING_BALANCE)
  })

  it('loads both books from the server on start', async () => {
    const server = fakeServer({ demo: 5000, practice: 777 })
    await startSimulatedSync(server.transport)
    expect(loadDemoState().wallet.availableBalance).toBe(5000)
    setPracticeBook('practice')
    expect(loadDemoState().wallet.availableBalance).toBe(777)
  })

  it('applies admin edits live and ignores stale snapshots', async () => {
    const server = fakeServer()
    await startSimulatedSync(server.transport)
    receiveSimulatedSnapshot(server.adminSet('demo', 250))
    expect(loadDemoState().wallet.availableBalance).toBe(250)
    receiveSimulatedSnapshot({ book: 'demo', balance: 9999, version: 1, updatedBy: 'user' })
    expect(loadDemoState().wallet.availableBalance).toBe(250)
  })

  it('sends stake and settle for a trade, keyed by the trade id', async () => {
    setSimulatedWinRate(1)
    const server = fakeServer()
    await startSimulatedSync(server.transport)
    const { trade, result } = await tradeEven(1234.52)
    await flush()
    expect(result).toBe('won')
    expect(server.calls.map((c) => [c.book, c.kind, c.amount, c.ref])).toEqual([
      ['demo', 'stake', 10, trade.id],
      ['demo', 'settle', 19, trade.id],
    ])
    expect(server.rows.demo.balance).toBe(DEMO_STARTING_BALANCE + 9)
    expect(loadDemoState().wallet.availableBalance).toBe(DEMO_STARTING_BALANCE + 9)
  })

  it('repairs the local balance from the server when a change is refused', async () => {
    const server = fakeServer()
    await startSimulatedSync(server.transport)
    server.rejectNext(true)
    const fetchAll = vi.spyOn(server.transport, 'fetchAll')
    await tradeEven(1234.53)
    await flush()
    await flush()
    expect(fetchAll).toHaveBeenCalled()
    expect(loadDemoState().wallet.availableBalance).toBe(DEMO_STARTING_BALANCE)
  })

  it('holds back own echoes while changes are in flight but applies admin edits at once', async () => {
    const server = fakeServer()
    let release: () => void = () => undefined
    const gate = new Promise<void>((resolve) => (release = resolve))
    const slow: SimulatedTransport = {
      async apply(change) {
        await gate
        return server.transport.apply(change)
      },
      fetchAll: server.transport.fetchAll,
    }
    await startSimulatedSync(slow)
    const done = recordSimulatedChange('topup', 100)
    receiveSimulatedSnapshot({ book: 'demo', balance: 1, version: 5, updatedBy: 'user' })
    expect(loadDemoState().wallet.availableBalance).toBe(DEMO_STARTING_BALANCE)
    receiveSimulatedSnapshot({ book: 'demo', balance: 300, version: 6, updatedBy: 'admin' })
    expect(loadDemoState().wallet.availableBalance).toBe(300)
    release()
    await done
    // The reply (version 2) is older than the admin edit (version 6), so the admin value stays.
    expect(loadDemoState().wallet.availableBalance).toBe(300)
  })
})

describe('simulated win rate in settlement', () => {
  it('defaults to 95% and ignores invalid values', () => {
    expect(getSimulatedWinRate()).toBe(0.95)
    setSimulatedWinRate(1.5)
    expect(getSimulatedWinRate()).toBe(0.95)
    setSimulatedWinRate('0.3')
    expect(getSimulatedWinRate()).toBe(0.3)
  })

  it('a 0% rate makes a naturally winning trade lose', async () => {
    setSimulatedWinRate(0)
    const { result } = await tradeEven(1234.52)
    expect(result).toBe('lost')
  })

  it('a 100% rate makes a naturally losing trade win', async () => {
    setSimulatedWinRate(1)
    const { result } = await tradeEven(1234.53)
    expect(result).toBe('won')
  })
})
