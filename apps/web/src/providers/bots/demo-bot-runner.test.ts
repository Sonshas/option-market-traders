import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { loadDemoState, resetDemoState } from '@/lib/demo-store'
import { demoBotProvider } from '@/providers/bots/providers'
import { runDemoBotStep, stopDemoBotRunner } from '@/providers/bots/demo-bot-runner'
import { settleDemoTrades } from '@/providers/trading/demo-trading-provider'
import { clearTickBufferForTests, recordTicks } from '@/providers/market-data/tick-buffer'
import type { Tick } from '@/types'

function tick(price: number, timestamp: number): Tick {
  return {
    symbol: 'R_100',
    price,
    timestamp,
    pipSize: 0.01,
    lastDigit: Math.round(price / 0.01) % 10,
    isSimulated: false,
    feedLabel: 'test',
  }
}

beforeEach(() => {
  resetDemoState()
  clearTickBufferForTests()
})

afterEach(() => stopDemoBotRunner())

describe('DEMO bot runner', () => {
  it('waits for live digits, trades one at a time, and stops at max runs', async () => {
    const start = await demoBotProvider.start({
      botId: 'digit-gate',
      stake: 2,
      takeProfit: null,
      stopLoss: null,
      maxRuns: 1,
      lossStreakLimit: 5,
      kind: 'demo',
    })
    expect(start.data?.tradesPlaced).toBe(0)
    const runId = start.data!.id

    await runDemoBotStep()
    expect(loadDemoState().trades).toHaveLength(0)

    const t0 = Date.now()
    recordTicks(
      'R_100',
      [100.01, 100.02, 100.03, 100.04, 100.05].map((price, i) => tick(price, t0 - 5000 + i * 1000)),
    )
    await runDemoBotStep()
    const trades = loadDemoState().trades.filter((t) => t.botRunId === runId)
    expect(trades).toHaveLength(1)
    expect(trades[0]).toMatchObject({ contractType: 'MATCH_DIFFER', contractOption: 'differ', selectedDigit: 5, stake: 2 })

    // Open trade blocks further placement.
    await runDemoBotStep()
    expect(loadDemoState().trades.filter((t) => t.botRunId === runId)).toHaveLength(1)

    recordTicks('R_100', [tick(100.07, t0 + 20_000)])
    settleDemoTrades(t0 + 21_000)
    await runDemoBotStep()
    const run = loadDemoState().botRuns.find((r) => r.id === runId)!
    expect(run.status).toBe('stopped')
    expect(run.tradesPlaced).toBe(1)
    expect(run.wins).toBe(1)
    expect(run.stopReason).toMatch(/Max runs/)
  })
})
