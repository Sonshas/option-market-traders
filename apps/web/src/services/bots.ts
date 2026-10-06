import { getAccountProviders } from '@/providers/registry'
import type { AccountMode, Bot, BotRun, ProviderResult } from '@/types'
import type { BotStartInput } from '@/providers/bots/providers'

/**
 * Mode-scoped bots facade.
 * DEMO → simulated start/stop. REAL → NOT_CONNECTED.
 */
export interface BotProvider {
  readonly id: string
  listBots(kind?: AccountMode): Promise<ProviderResult<Bot[]>>
  listRuns(kind?: AccountMode): Promise<ProviderResult<BotRun[]>>
  start(input: BotStartInput): Promise<ProviderResult<BotRun | null>>
  stop(botId: string, kind?: AccountMode): Promise<ProviderResult<BotRun | null>>
}

export const botService: BotProvider = {
  id: 'mode-scoped',

  async listBots(kind = 'demo') {
    return getAccountProviders(kind).bots.listBots(kind)
  },

  async listRuns(kind = 'demo') {
    return getAccountProviders(kind).bots.listRuns(kind)
  },

  async start(input) {
    const kind = input.kind ?? 'demo'
    return getAccountProviders(kind).bots.start({ ...input, kind })
  },

  async stop(botId, kind = 'demo') {
    return getAccountProviders(kind).bots.stop(botId, kind)
  },
}

export const botProvider: BotProvider = botService
