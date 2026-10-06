import { BOT_CATALOG } from '@/lib/constants'
import {
  DEMO_ACCOUNT_ID,
  DEMO_USER_ID,
  REAL_UNAVAILABLE_BOTS,
} from '@/domain/account'
import { createId, nowIso } from '@/lib/ids'
import { loadDemoState, mutateDemoState, pushDemoNotification } from '@/lib/demo-store'
import { okDemo, notConnected } from '@/providers/results'
import { BOT_STRATEGY_RULES } from '@/domain/bot-strategies'
import { ensureDemoBotRunner } from '@/providers/bots/demo-bot-runner'
import type { AccountMode, Bot, BotRun, DisconnectedResult, ProviderResult } from '@/types'

export interface BotStartInput {
  botId: string
  stake: number
  takeProfit: number | null
  stopLoss: number | null
  maxRuns: number
  lossStreakLimit: number
  kind?: AccountMode
}

export interface BotProvider {
  readonly id: string
  listBots(kind?: AccountMode): Promise<ProviderResult<Bot[]>>
  listRuns(kind?: AccountMode): Promise<ProviderResult<BotRun[]>>
  start(input: BotStartInput): Promise<ProviderResult<BotRun | null>>
  stop(botId: string, kind?: AccountMode): Promise<ProviderResult<BotRun | null>>
}

export const demoBotProvider: BotProvider = {
  id: 'demo-local',

  async listBots(kind = 'demo') {
    if (kind !== 'demo') {
      return notConnected([], 'DemoBotProvider refuses real-mode lists.', 'CROSS_MODE_FORBIDDEN')
    }
    const bots = BOT_CATALOG.map((bot) => ({
      ...bot,
      description: BOT_STRATEGY_RULES[bot.id] ?? bot.description,
      historicalPerformance: 'N/A — DEMO bots do not claim a win rate or guaranteed profit',
      accountMode: 'demo' as const,
      isSimulated: true,
    }))
    return okDemo(bots, 'DEMO bot catalog. Simulated automation only. No guaranteed results.')
  },

  async listRuns(kind = 'demo') {
    if (kind !== 'demo') {
      return notConnected([], 'DemoBotProvider refuses real-mode lists.', 'CROSS_MODE_FORBIDDEN')
    }
    return okDemo(loadDemoState().botRuns, 'DEMO bot runs. Simulated only.')
  },

  async start(input) {
    if (input.kind && input.kind !== 'demo') {
      return notConnected(null, 'DemoBotProvider refuses real-mode starts.', 'CROSS_MODE_FORBIDDEN')
    }
    const bot = BOT_CATALOG.find((item) => item.id === input.botId)
    if (!bot) {
      return {
        status: 'not_connected',
        connected: false,
        message: 'Unknown DEMO bot.',
        data: null,
        code: 'VALIDATION',
        accountMode: 'demo',
        isSimulated: true,
      } satisfies DisconnectedResult<null>
    }
    const now = Date.now()
    const createdAt = nowIso(now)
    const run: BotRun = {
      id: createId('bot'),
      userId: DEMO_USER_ID,
      accountId: DEMO_ACCOUNT_ID,
      accountMode: 'demo',
      botId: bot.id,
      status: 'running',
      stake: input.stake,
      takeProfit: input.takeProfit,
      stopLoss: input.stopLoss,
      maxRuns: input.maxRuns,
      lossStreakLimit: input.lossStreakLimit,
      startedAt: createdAt,
      stoppedAt: null,
      note: `DEMO bot on live ${bot.marketSymbol} digits. ${BOT_STRATEGY_RULES[bot.id] ?? ''} Results are not guaranteed.`,
      isSimulated: true,
      tradesPlaced: 0,
      realizedPnl: 0,
      wins: 0,
      losses: 0,
      lossStreak: 0,
      stopReason: null,
      createdAt,
      updatedAt: createdAt,
    }
    mutateDemoState((state) => {
      const next = {
        ...state,
        botRuns: [run, ...state.botRuns.map((item) => (item.botId === bot.id && item.status === 'running' ? { ...item, status: 'stopped' as const, stoppedAt: createdAt } : item))],
      }
      return pushDemoNotification(
        next,
        'trading',
        'DEMO bot started',
        `${bot.name} is running on live ${bot.marketSymbol} ticks with DEMO funds. No guaranteed profits.`,
        now,
      )
    })
    ensureDemoBotRunner()
    return okDemo(
      run,
      `DEMO bot started on live ${bot.marketSymbol} ticks. Virtual funds only — no guaranteed results.`,
    )
  },

  async stop(botId, kind = 'demo') {
    if (kind !== 'demo') {
      return notConnected(null, 'DemoBotProvider refuses real-mode stops.', 'CROSS_MODE_FORBIDDEN')
    }
    const now = Date.now()
    const updatedAt = nowIso(now)
    let stopped: BotRun | null = null
    mutateDemoState((state) => {
      const nextRuns = state.botRuns.map((run) => {
        if (run.botId === botId && run.status === 'running') {
          stopped = { ...run, status: 'stopped', stoppedAt: updatedAt, updatedAt, stopReason: 'Stopped manually' }
          return stopped
        }
        return run
      })
      let next = { ...state, botRuns: nextRuns }
      if (stopped) {
        next = pushDemoNotification(next, 'trading', 'DEMO bot stopped', 'Simulated DEMO bot stopped.', now)
      }
      return next
    })
    return okDemo(stopped, stopped ? 'DEMO bot stopped.' : 'No running DEMO bot to stop.')
  },
}

/**
 * Real bots run only on the server with risk controls and audit.
 * The browser cannot start a real bot or invent performance.
 */
export const realBotProvider: BotProvider = {
  id: 'real-backend',

  async listBots() {
    return notConnected(
      BOT_CATALOG.map((bot) => ({
        ...bot,
        historicalPerformance: 'N/A — real bot history is not connected',
        accountMode: 'real' as const,
        isSimulated: false,
      })),
      REAL_UNAVAILABLE_BOTS,
      'REAL_BOTS_UNAVAILABLE',
    )
  },

  async listRuns() {
    return notConnected([], REAL_UNAVAILABLE_BOTS, 'REAL_BOTS_UNAVAILABLE')
  },

  async start(_input) {
    return notConnected(null, REAL_UNAVAILABLE_BOTS, 'REAL_BOTS_UNAVAILABLE')
  },

  async stop(_botId) {
    return notConnected(null, REAL_UNAVAILABLE_BOTS, 'REAL_BOTS_UNAVAILABLE')
  },
}
