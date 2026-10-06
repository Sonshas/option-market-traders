import { BOT_CATALOG } from '@/lib/constants'
import {
  BOT_TRADE_DURATION_MS,
  botProgress,
  decideBotContract,
  evaluateBotStop,
} from '@/domain/bot-strategies'
import { digitsFromTicks } from '@/domain/digit-stats'
import { nowIso } from '@/lib/ids'
import { loadDemoState, mutateDemoState, pushDemoNotification } from '@/lib/demo-store'
import { getBufferedTicks, getLiveTickSource } from '@/providers/market-data/tick-buffer'
import { demoTradingProvider } from '@/providers/trading/demo-trading-provider'
import type { BotRun } from '@/types'

/**
 * DEMO-only bot runner. Each running bot places one DEMO trade at a time on genuine live
 * digits, waits for it to settle on a real exit tick, then re-evaluates its limits.
 * Never touches REAL wallets, Supabase, or any execution backend.
 */

const placing = new Set<string>()
const historyRequested = new Set<string>()
let timer: ReturnType<typeof setInterval> | null = null

function stopRun(runId: string, reason: string, now: number): void {
  mutateDemoState((state) => {
    let changed = false
    const botRuns = state.botRuns.map((run) => {
      if (run.id !== runId || run.status !== 'running') return run
      changed = true
      const stamp = nowIso(now)
      return { ...run, status: 'stopped' as const, stoppedAt: stamp, updatedAt: stamp, stopReason: reason }
    })
    if (!changed) return state
    const run = botRuns.find((item) => item.id === runId)
    const bot = BOT_CATALOG.find((item) => item.id === run?.botId)
    return pushDemoNotification(
      { ...state, botRuns },
      'trading',
      'DEMO bot stopped',
      `${bot?.name ?? 'DEMO bot'}: ${reason}. Virtual funds only.`,
      now,
    )
  })
}

function syncProgress(run: BotRun, now: number): ReturnType<typeof botProgress> {
  const trades = loadDemoState().trades.filter((trade) => trade.botRunId === run.id)
  const progress = botProgress(trades)
  if (
    run.tradesPlaced !== progress.tradesPlaced ||
    run.realizedPnl !== progress.realizedPnl ||
    run.wins !== progress.wins ||
    run.losses !== progress.losses ||
    run.lossStreak !== progress.lossStreak
  ) {
    mutateDemoState((state) => ({
      ...state,
      botRuns: state.botRuns.map((item) =>
        item.id === run.id
          ? {
              ...item,
              tradesPlaced: progress.tradesPlaced,
              realizedPnl: progress.realizedPnl,
              wins: progress.wins,
              losses: progress.losses,
              lossStreak: progress.lossStreak,
              updatedAt: nowIso(now),
            }
          : item,
      ),
    }))
  }
  return progress
}

/** One scheduling pass over running DEMO bots (exported for tests). */
export async function runDemoBotStep(now = Date.now()): Promise<void> {
  const running = loadDemoState().botRuns.filter((run) => run.status === 'running' && run.accountMode === 'demo')
  const source = getLiveTickSource()
  for (const run of running) {
    if (placing.has(run.id)) continue
    const bot = BOT_CATALOG.find((item) => item.id === run.botId)
    if (!bot) {
      stopRun(run.id, 'Unknown bot', now)
      continue
    }
    const progress = syncProgress(run, now)
    if (progress.openTrades > 0) continue

    const reason = evaluateBotStop(progress, {
      maxRuns: run.maxRuns,
      takeProfit: run.takeProfit,
      stopLoss: run.stopLoss,
      lossStreakLimit: run.lossStreakLimit,
    })
    if (reason) {
      stopRun(run.id, reason, now)
      continue
    }

    source?.ensureSubscribed(bot.marketSymbol)
    if (source && !historyRequested.has(bot.marketSymbol)) {
      historyRequested.add(bot.marketSymbol)
      void source.loadRecent(bot.marketSymbol, 100).catch(() => historyRequested.delete(bot.marketSymbol))
    }
    const decision = decideBotContract(bot.id, digitsFromTicks(getBufferedTicks(bot.marketSymbol)))
    if (!decision) continue

    placing.add(run.id)
    try {
      const result = await demoTradingProvider.placeTrade({
        symbol: bot.marketSymbol,
        ...decision,
        stake: run.stake,
        durationMs: BOT_TRADE_DURATION_MS,
        kind: 'demo',
        accountMode: 'demo',
        botRunId: run.id,
      })
      if (!result.connected && 'code' in result && result.code === 'INSUFFICIENT_FUNDS') {
        stopRun(run.id, 'Insufficient DEMO balance', now)
      }
    } finally {
      placing.delete(run.id)
    }
  }
}

export function ensureDemoBotRunner(): void {
  if (timer || typeof setInterval === 'undefined') return
  timer = setInterval(() => {
    void runDemoBotStep(Date.now())
  }, 1000)
}

export function stopDemoBotRunner(): void {
  if (timer) {
    clearInterval(timer)
    timer = null
  }
}
