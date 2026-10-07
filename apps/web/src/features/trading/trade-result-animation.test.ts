import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { payoutFor, settleDigitContract } from '@/domain/digit-contracts'
import {
  createTradeResultAnimator,
  RESULT_MIN_MS,
  SETTLE_HOLD_MS,
  settledDigitOf,
  type TradeResultAnimator,
} from '@/features/trading/trade-result-animation'
import type { AccountMode, ContractOption, ContractType, Trade } from '@/types'

const T0 = Date.UTC(2026, 9, 4, 9, 0, 0)
let seq = 0

function openTrade(input: {
  contractType: ContractType
  contractOption: ContractOption
  selectedDigit?: number | null
  barrier?: number | null
  kind?: AccountMode
  symbol?: string
  createdAt?: number
}): Trade {
  seq += 1
  const kind = input.kind ?? 'demo'
  const createdAt = new Date(input.createdAt ?? Date.now()).toISOString()
  return {
    id: `t${seq}`,
    userId: 'u1',
    accountId: 'a1',
    accountMode: kind,
    createdAt,
    updatedAt: createdAt,
    walletId: 'w1',
    symbol: input.symbol ?? 'R_100',
    market: input.symbol ?? 'R_100',
    contractType: input.contractType,
    contractOption: input.contractOption,
    selectedDigit: input.selectedDigit ?? null,
    barrier: input.barrier ?? null,
    stake: 10,
    durationMs: 0,
    duration: 0,
    payoutRate: 0.0555,
    status: 'open',
    result: 'open',
    entryPrice: 1234.5,
    exitPrice: null,
    payout: null,
    profitLoss: null,
    expiresAt: null,
    resolvedAt: null,
    isSimulated: kind === 'demo',
    walletKind: kind,
    exitDigit: null,
    durationTicks: 5,
  }
}

/** Settles with the shared contract rule, exactly as the DEMO engine / server would. */
function settle(trade: Trade, exitDigit: number): Trade {
  const status = settleDigitContract({ ...trade, exitPrice: 1234 + exitDigit / 100, exitDigit })
  const payout = payoutFor(trade.stake, trade.payoutRate ?? 0, status)
  return { ...trade, status, result: status, exitDigit, exitPrice: 1234 + exitDigit / 100, payout, profitLoss: payout - trade.stake }
}

function refund(trade: Trade): Trade {
  return { ...trade, status: 'cancelled', result: 'cancelled', payout: trade.stake, profitLoss: 0 }
}

function animator(kind: AccountMode = 'demo', warn = vi.fn()): TradeResultAnimator {
  const a = createTradeResultAnimator({ warn, crossCheck: true })
  a.setAccountMode(kind)
  return a
}

beforeEach(() => {
  vi.useFakeTimers()
  vi.setSystemTime(T0)
})
afterEach(() => {
  vi.useRealTimers()
})

describe('trade result animation', () => {
  const evenCases: Array<[number, 'won' | 'lost', 'WIN' | 'LOSS']> = [
    [0, 'won', 'WIN'],
    [2, 'won', 'WIN'],
    [8, 'won', 'WIN'],
    [1, 'lost', 'LOSS'],
    [7, 'lost', 'LOSS'],
    [9, 'lost', 'LOSS'],
  ]
  it.each(evenCases)('EVEN natural rule: digit %i shows %s', (digit, status, result) => {
    const a = animator()
    const trade = openTrade({ contractType: 'EVEN_ODD', contractOption: 'even' })
    a.syncTrades([trade])
    a.syncTrades([settle(trade, digit)])
    vi.advanceTimersByTime(SETTLE_HOLD_MS)
    expect(a.getState()).toMatchObject({ status, result, settledDigit: digit, cursorDigit: digit })
  })

  it('ODD selection is preserved while settlement follows natural rules', () => {
    const a = animator()
    const trade = openTrade({ contractType: 'EVEN_ODD', contractOption: 'odd' })
    a.syncTrades([trade])
    a.syncTrades([settle(trade, 0)])
    vi.advanceTimersByTime(SETTLE_HOLD_MS)
    expect(a.getState().status).toBe('lost')
    expect(a.getState().selection).toEqual({ contract: 'EVEN_ODD', side: 'odd' })
  })

  it('follows live digits while running and never shows a result before settlement', () => {
    const a = animator()
    a.observeDigit('R_100', 4)
    const trade = openTrade({ contractType: 'EVEN_ODD', contractOption: 'even' })
    a.syncTrades([trade])
    expect(a.getState()).toMatchObject({ status: 'running', cursorDigit: 4, result: null, settledDigit: null })
    a.observeDigit('R_100', 7)
    a.observeDigit('R_50', 1)
    expect(a.getState().cursorDigit).toBe(7)
    vi.advanceTimersByTime(60_000)
    expect(a.getState()).toMatchObject({ status: 'running', result: null })
  })

  it('reveals the result on the final digit and keeps the cursor there', () => {
    const a = animator()
    const trade = openTrade({ contractType: 'EVEN_ODD', contractOption: 'even' })
    a.syncTrades([trade])
    a.syncTrades([settle(trade, 2)])
    vi.advanceTimersByTime(SETTLE_HOLD_MS)
    expect(a.getState()).toMatchObject({ status: 'won', result: 'WIN', settledDigit: 2, cursorDigit: 2 })
    a.observeDigit('R_100', 5)
    vi.advanceTimersByTime(RESULT_MIN_MS)
    expect(a.getState()).toMatchObject({ status: 'won', cursorDigit: 2 })
  })

  it.each([
    ['MATCH 3', { contractType: 'MATCH_DIFFER', contractOption: 'match', selectedDigit: 3 }, 6, 'lost'],
    ['DIFFER 3', { contractType: 'MATCH_DIFFER', contractOption: 'differ', selectedDigit: 3 }, 6, 'won'],
    ['OVER 5', { contractType: 'OVER_UNDER', contractOption: 'over', barrier: 5 }, 9, 'won'],
    ['UNDER 5', { contractType: 'OVER_UNDER', contractOption: 'under', barrier: 5 }, 5, 'lost'],
  ] as const)('cursor ends on the settled digit for %s', (_label, selection, digit, status) => {
    const a = animator()
    a.observeDigit('R_100', 0)
    const trade = openTrade(selection)
    a.syncTrades([trade])
    a.syncTrades([settle(trade, digit)])
    vi.advanceTimersByTime(SETTLE_HOLD_MS)
    expect(a.getState()).toMatchObject({ status, cursorDigit: digit, settledDigit: digit })
  })

  it('uses the exit price at the market pip size when the exit digit is missing', () => {
    expect(settledDigitOf({ exitDigit: null, exitPrice: 1234.57 }, 0.01)).toBe(7)
    expect(settledDigitOf({ exitDigit: null, exitPrice: 1234.5 }, 0.01)).toBe(0)
    expect(settledDigitOf({ exitDigit: 3, exitPrice: 1234.57 }, 0.01)).toBe(3)
  })

  it('shows REFUNDED for cancelled trades, with no win/loss', () => {
    const a = animator()
    const trade = openTrade({ contractType: 'EVEN_ODD', contractOption: 'even' })
    a.syncTrades([trade])
    a.syncTrades([refund(trade)])
    expect(a.getState()).toMatchObject({ status: 'refunded', result: null, settledDigit: null })
    vi.advanceTimersByTime(SETTLE_HOLD_MS)
    expect(a.getState().result).toBeNull()
  })

  it('a new trade resets the animation; a trade arriving during the hold is queued', () => {
    const a = animator()
    const first = openTrade({ contractType: 'EVEN_ODD', contractOption: 'even' })
    a.syncTrades([first])
    vi.advanceTimersByTime(1_000)
    const second = openTrade({ contractType: 'EVEN_ODD', contractOption: 'odd' })
    a.syncTrades([second, first])
    expect(a.getState()).toMatchObject({ tradeId: second.id, status: 'running', result: null })

    a.syncTrades([settle(second, 3), first])
    vi.advanceTimersByTime(1_000)
    const third = openTrade({ contractType: 'EVEN_ODD', contractOption: 'even' })
    a.syncTrades([third, settle(second, 3), first])
    expect(a.getState()).toMatchObject({ tradeId: second.id, status: 'won', result: 'WIN', cursorDigit: 3 })

    vi.advanceTimersByTime(SETTLE_HOLD_MS + RESULT_MIN_MS - 1_000 - 1)
    expect(a.getState()).toMatchObject({ tradeId: second.id, status: 'won' })
    vi.advanceTimersByTime(1)
    expect(a.getState()).toMatchObject({ tradeId: third.id, status: 'running', result: null, settledDigit: null })
  })

  it('reset (Demo ↔ Practice switch) drops a running trade and follows the next one', () => {
    const a = animator()
    const running = openTrade({ contractType: 'EVEN_ODD', contractOption: 'even' })
    a.syncTrades([running])
    expect(a.getState().status).toBe('running')
    a.reset()
    expect(a.getState().status).toBe('idle')
    const next = openTrade({ contractType: 'EVEN_ODD', contractOption: 'odd' })
    a.syncTrades([next])
    a.syncTrades([settle(next, 7)])
    vi.advanceTimersByTime(SETTLE_HOLD_MS)
    expect(a.getState()).toMatchObject({ tradeId: next.id, status: 'won', cursorDigit: 7 })
  })

  it('ignores trades settled before the page opened', () => {
    const a = animator()
    const old = settle(openTrade({ contractType: 'EVEN_ODD', contractOption: 'even', createdAt: T0 - 60_000 }), 2)
    a.syncTrades([old])
    expect(a.getState().status).toBe('idle')
  })

  it('reports — never alters — a status that disagrees with the outcome policy', () => {
    const warn = vi.fn()
    const a = animator('demo', warn)
    const trade = openTrade({ contractType: 'EVEN_ODD', contractOption: 'even' })
    a.syncTrades([trade])
    a.syncTrades([{ ...settle(trade, 2), status: 'lost', result: 'lost' }])
    vi.advanceTimersByTime(SETTLE_HOLD_MS)
    expect(a.getState()).toMatchObject({ status: 'lost', result: 'LOSS' })
    expect(warn).toHaveBeenCalledOnce()
  })

  it.each([
    { contractType: 'EVEN_ODD', contractOption: 'even' },
    { contractType: 'EVEN_ODD', contractOption: 'odd' },
    { contractType: 'MATCH_DIFFER', contractOption: 'match', selectedDigit: 4 },
    { contractType: 'MATCH_DIFFER', contractOption: 'differ', selectedDigit: 4 },
    { contractType: 'OVER_UNDER', contractOption: 'over', barrier: 6 },
    { contractType: 'OVER_UNDER', contractOption: 'under', barrier: 3 },
  ] as const)('$contractOption: the cursor stops on the settled digit and the label matches it', (selection) => {
    for (let digit = 0; digit <= 9; digit += 1) {
      const a = animator()
      a.observeDigit('R_100', (digit + 5) % 10)
      const trade = openTrade(selection)
      a.syncTrades([trade])
      const settled = settle(trade, digit)
      a.syncTrades([settled])
      a.observeDigit('R_100', (digit + 3) % 10)
      vi.advanceTimersByTime(SETTLE_HOLD_MS)
      expect(a.getState()).toMatchObject({
        status: settled.status,
        result: settled.status === 'won' ? 'WIN' : 'LOSS',
        settledDigit: digit,
        cursorDigit: digit,
      })
    }
  })

  it('animates a REAL trade from a mocked REAL provider the same way', async () => {
    let row = openTrade({ contractType: 'OVER_UNDER', contractOption: 'under', barrier: 4, kind: 'real' })
    const provider = {
      listOpen: vi.fn(async () => ({ data: row.status === 'open' ? [row] : [] })),
      listHistory: vi.fn(async () => ({ data: row.status === 'open' ? [] : [row] })),
    }
    const load = async () => [...(await provider.listOpen()).data, ...(await provider.listHistory()).data]
    const a = animator('real')
    a.observeDigit('R_100', 8)

    a.syncTrades([...(await load()), openTrade({ contractType: 'EVEN_ODD', contractOption: 'even', kind: 'demo' })])
    expect(a.getState()).toMatchObject({ tradeId: row.id, status: 'running', cursorDigit: 8 })

    row = settle(row, 1)
    a.syncTrades(await load())
    expect(a.getState()).toMatchObject({ status: 'settling', cursorDigit: 1, result: null })
    vi.advanceTimersByTime(SETTLE_HOLD_MS)
    expect(a.getState()).toMatchObject({ status: 'won', result: 'WIN', settledDigit: 1, selection: { side: 'under', barrier: 4 } })
  })
})
