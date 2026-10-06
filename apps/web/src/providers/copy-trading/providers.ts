import { COPY_TRADER_PLACEHOLDERS } from '@/lib/constants'
import {
  DEMO_ACCOUNT_ID,
  DEMO_USER_ID,
  REAL_UNAVAILABLE_COPY,
} from '@/domain/account'
import { createId, nowIso } from '@/lib/ids'
import { loadDemoState, mutateDemoState, pushDemoNotification } from '@/lib/demo-store'
import { okDemo, notConnected } from '@/providers/results'
import type { AccountMode, CopyTrade, CopyTrader, ProviderResult } from '@/types'

export interface CopyTradingProvider {
  readonly id: string
  listTraders(kind?: AccountMode): Promise<ProviderResult<CopyTrader[]>>
  getTrader(id: string, kind?: AccountMode): Promise<ProviderResult<CopyTrader | null>>
  listCopies(kind?: AccountMode): Promise<ProviderResult<CopyTrade[]>>
  startCopy(input: {
    copyTraderId: string
    allocation: number
    maxDailyLoss: number
    kind?: AccountMode
  }): Promise<ProviderResult<CopyTrade | null>>
  stopCopy(copyTraderId: string, kind?: AccountMode): Promise<ProviderResult<CopyTrade | null>>
}

export const demoCopyTradingProvider: CopyTradingProvider = {
  id: 'demo-local',

  async listTraders(kind = 'demo') {
    if (kind !== 'demo') {
      return notConnected([], 'DemoCopyTradingProvider refuses real-mode lists.', 'CROSS_MODE_FORBIDDEN')
    }
    return okDemo(
      COPY_TRADER_PLACEHOLDERS,
      'DEMO copy board. Simulated slots only. Performance is N/A — not a live track record and not a guaranteed win rate.',
    )
  },

  async getTrader(id, kind = 'demo') {
    if (kind !== 'demo') {
      return notConnected(null, 'DemoCopyTradingProvider refuses real-mode reads.', 'CROSS_MODE_FORBIDDEN')
    }
    const trader = COPY_TRADER_PLACEHOLDERS.find((item) => item.id === id) ?? null
    return okDemo(trader, trader ? 'DEMO simulated copy slot. Not a verified live trader.' : 'DEMO copy slot not found.')
  },

  async listCopies(kind = 'demo') {
    if (kind !== 'demo') {
      return notConnected([], 'DemoCopyTradingProvider refuses real-mode lists.', 'CROSS_MODE_FORBIDDEN')
    }
    return okDemo(loadDemoState().copyTrades, 'DEMO copy relationships. Simulated only.')
  },

  async startCopy(input) {
    if (input.kind && input.kind !== 'demo') {
      return notConnected(null, 'DemoCopyTradingProvider refuses real-mode copies.', 'CROSS_MODE_FORBIDDEN')
    }
    const now = Date.now()
    const createdAt = nowIso(now)
    const copy: CopyTrade = {
      id: createId('cpy'),
      userId: DEMO_USER_ID,
      accountId: DEMO_ACCOUNT_ID,
      accountMode: 'demo',
      copyTraderId: input.copyTraderId,
      allocation: input.allocation,
      maxDailyLoss: input.maxDailyLoss,
      status: 'active',
      isSimulated: true,
      createdAt,
      updatedAt: createdAt,
    }
    mutateDemoState((state) => {
      const next = { ...state, copyTrades: [copy, ...state.copyTrades] }
      return pushDemoNotification(
        next,
        'trading',
        'DEMO copy started',
        'Simulated DEMO copy relationship. This does not mirror live traders or invent real performance.',
        now,
      )
    })
    return okDemo(copy, 'DEMO copy started. Simulated allocation only.')
  },

  async stopCopy(copyTraderId, kind = 'demo') {
    if (kind !== 'demo') {
      return notConnected(null, 'DemoCopyTradingProvider refuses real-mode stops.', 'CROSS_MODE_FORBIDDEN')
    }
    const now = Date.now()
    const updatedAt = nowIso(now)
    let stopped: CopyTrade | null = null
    mutateDemoState((state) => {
      const nextCopies = state.copyTrades.map((item) => {
        if (item.copyTraderId === copyTraderId && item.status === 'active') {
          stopped = { ...item, status: 'inactive', updatedAt }
          return stopped
        }
        return item
      })
      return { ...state, copyTrades: nextCopies }
    })
    return okDemo(stopped, stopped ? 'DEMO copy stopped.' : 'No active DEMO copy to stop.')
  },
}

/**
 * Real copy trading uses verified backend data only.
 * Performance is never fabricated. When unavailable the UI shows N/A.
 */
export const realCopyTradingProvider: CopyTradingProvider = {
  id: 'real-backend',

  async listTraders() {
    return notConnected([], REAL_UNAVAILABLE_COPY, 'REAL_COPY_UNAVAILABLE')
  },

  async getTrader() {
    return notConnected(null, REAL_UNAVAILABLE_COPY, 'REAL_COPY_UNAVAILABLE')
  },

  async listCopies() {
    return notConnected([], REAL_UNAVAILABLE_COPY, 'REAL_COPY_UNAVAILABLE')
  },

  async startCopy() {
    return notConnected(null, REAL_UNAVAILABLE_COPY, 'REAL_COPY_UNAVAILABLE')
  },

  async stopCopy() {
    return notConnected(null, REAL_UNAVAILABLE_COPY, 'REAL_COPY_UNAVAILABLE')
  },
}
