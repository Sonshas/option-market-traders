import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('@/domain/outcome/demo-win-rate', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/domain/outcome/demo-win-rate')>()),
  demoExitDigit: (_contract: unknown, natural: number) => natural,
}))
import { accountModeLabel } from '@/domain/account'
import { loadDemoState, resetDemoState, subscribeDemoStore } from '@/lib/demo-store'
import { PRACTICE_STORAGE_KEY, setPracticeBook, type PracticeBook } from '@/lib/practice-book'
import { DEMO_STARTING_BALANCE } from '@/providers/config'
import { demoExecutor } from '@/providers/bots/auto-trade-executors'
import {
  demoTradingProvider,
  settleDemoTrades,
  stopDemoSettlementLoop,
} from '@/providers/trading/demo-trading-provider'
import { clearTickBufferForTests, recordTicks } from '@/providers/market-data/tick-buffer'
import type { Tick } from '@/types'

function tick(price: number, timestamp: number): Tick {
  return {
    symbol: 'R_75',
    price,
    timestamp,
    pipSize: 0.01,
    lastDigit: Math.round(price / 0.01) % 10,
    isSimulated: false,
    feedLabel: 'test feed',
  }
}

/** Places a $10 EVEN trade and settles it on an even (win) or odd (loss) exit digit. */
let clock = Date.now()

async function tradeEven(outcome: 'won' | 'lost') {
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
  const afterOpen = loadDemoState().wallet
  recordTicks('R_75', [tick(outcome === 'won' ? 1234.52 : 1234.53, t0 + 2_000)])
  const settled = settleDemoTrades(t0 + 5_000)
  expect(settled[0]?.result).toBe(outcome)
  return { afterOpen, afterSettle: loadDemoState().wallet }
}

function resetBook(book: PracticeBook) {
  setPracticeBook(book)
  resetDemoState()
}

beforeEach(() => {
  clearTickBufferForTests()
  resetBook('practice')
  resetBook('demo')
})

afterEach(() => {
  stopDemoSettlementLoop()
  setPracticeBook('demo')
  clearTickBufferForTests()
})

describe('practice book', () => {
  it('switches to a separate account and label', () => {
    expect(loadDemoState().wallet.availableBalance).toBe(DEMO_STARTING_BALANCE)
    setPracticeBook('practice')
    expect(loadDemoState().wallet.isSimulated).toBe(true)
    expect(accountModeLabel('demo')).toBe('PRACTICE ACCOUNT')
    setPracticeBook('demo')
    expect(accountModeLabel('demo')).toBe('DEMO ACCOUNT')
  })

  it('starts practice with the same visible balance as a fresh demo account', () => {
    setPracticeBook('practice')
    const wallet = loadDemoState().wallet
    expect(wallet.availableBalance).toBe(DEMO_STARTING_BALANCE)
    expect(wallet.balance).toBe(DEMO_STARTING_BALANCE)
    expect(wallet.lockedBalance).toBe(0)
  })

  it.each<PracticeBook>(['demo', 'practice'])('%s: a winning trade deducts the stake, then credits stake + payout', async (book) => {
    setPracticeBook(book)
    const { afterOpen, afterSettle } = await tradeEven('won')
    expect(afterOpen.availableBalance).toBe(DEMO_STARTING_BALANCE - 10)
    expect(afterOpen.lockedBalance).toBe(10)
    expect(afterSettle.availableBalance).toBe(DEMO_STARTING_BALANCE + 9)
    expect(afterSettle.lockedBalance).toBe(0)
    expect(afterSettle.balance).toBe(DEMO_STARTING_BALANCE + 9)
  })

  it.each<PracticeBook>(['demo', 'practice'])('%s: a losing trade keeps the stake deducted', async (book) => {
    setPracticeBook(book)
    const { afterOpen, afterSettle } = await tradeEven('lost')
    expect(afterOpen.availableBalance).toBe(DEMO_STARTING_BALANCE - 10)
    expect(afterSettle.availableBalance).toBe(DEMO_STARTING_BALANCE - 10)
    expect(afterSettle.lockedBalance).toBe(0)
    expect(afterSettle.balance).toBe(DEMO_STARTING_BALANCE - 10)
  })

  it('keeps demo and practice balances and trades separate', async () => {
    setPracticeBook('practice')
    await tradeEven('won')
    await tradeEven('lost')
    expect(loadDemoState().wallet.availableBalance).toBe(DEMO_STARTING_BALANCE - 1)
    expect(loadDemoState().trades).toHaveLength(2)

    setPracticeBook('demo')
    expect(loadDemoState().wallet.availableBalance).toBe(DEMO_STARTING_BALANCE)
    expect(loadDemoState().trades).toHaveLength(0)
    await tradeEven('lost')
    expect(loadDemoState().wallet.availableBalance).toBe(DEMO_STARTING_BALANCE - 10)

    setPracticeBook('practice')
    expect(loadDemoState().wallet.availableBalance).toBe(DEMO_STARTING_BALANCE - 1)
    expect(loadDemoState().trades).toHaveLength(2)
  })

  it('notifies store listeners on stake lock, settlement and book switch', async () => {
    setPracticeBook('practice')
    const seen: number[] = []
    const unsubscribe = subscribeDemoStore(() => seen.push(loadDemoState().wallet.availableBalance ?? -1))
    await tradeEven('won')
    expect(seen).toContain(DEMO_STARTING_BALANCE - 10)
    expect(seen.at(-1)).toBe(DEMO_STARTING_BALANCE + 9)
    setPracticeBook('demo')
    expect(seen.at(-1)).toBe(DEMO_STARTING_BALANCE)
    unsubscribe()
  })

  it('refuses a practice stake larger than the practice balance', async () => {
    setPracticeBook('practice')
    recordTicks('R_75', [tick(1234.56, Date.now())])
    const result = await demoTradingProvider.placeTrade({
      symbol: 'R_75',
      contractType: 'EVEN_ODD',
      contractOption: 'even',
      stake: DEMO_STARTING_BALANCE + 1,
      durationMs: 2_000,
      kind: 'demo',
      accountMode: 'demo',
    })
    expect(result.data).toBeNull()
    expect(result.message).toMatch(/insufficient/i)
    expect(loadDemoState().wallet.availableBalance).toBe(DEMO_STARTING_BALANCE)
  })

  it('gives Auto Trade the active book balance so a practice run stops when it runs out', async () => {
    setPracticeBook('practice')
    await tradeEven('lost')
    expect(await demoExecutor.getBalance()).toBe(DEMO_STARTING_BALANCE - 10)
    setPracticeBook('demo')
    expect(await demoExecutor.getBalance()).toBe(DEMO_STARTING_BALANCE)
  })

  it('replaces a legacy hidden practice wallet with the starting balance', () => {
    const store = new Map<string, string>()
    vi.stubGlobal('localStorage', {
      getItem: (key: string) => store.get(key) ?? null,
      setItem: (key: string, value: string) => void store.set(key, value),
      removeItem: (key: string) => void store.delete(key),
    })
    try {
      setPracticeBook('practice')
      const legacy = loadDemoState()
      const nominal = 1_000_000_000
      store.set(
        PRACTICE_STORAGE_KEY,
        JSON.stringify({ ...legacy, wallet: { ...legacy.wallet, balance: nominal, availableBalance: nominal, lockedBalance: 0 } }),
      )
      setPracticeBook('demo')
      setPracticeBook('practice')
      expect(loadDemoState().wallet.availableBalance).toBe(DEMO_STARTING_BALANCE)
    } finally {
      setPracticeBook('demo')
      vi.unstubAllGlobals()
    }
  })
})
