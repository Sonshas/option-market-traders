import { getAccountProviders } from '@/providers/registry'
import type { AccountMode, CopyTrade, CopyTrader, ProviderResult } from '@/types'

/**
 * Mode-scoped copy-trading facade.
 * DEMO → simulated copy slots. REAL → NOT_CONNECTED / N/A performance.
 */
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

export const copyTradingService: CopyTradingProvider = {
  id: 'mode-scoped',

  async listTraders(kind = 'demo') {
    return getAccountProviders(kind).copyTrading.listTraders(kind)
  },

  async getTrader(id, kind = 'demo') {
    return getAccountProviders(kind).copyTrading.getTrader(id, kind)
  },

  async listCopies(kind = 'demo') {
    return getAccountProviders(kind).copyTrading.listCopies(kind)
  },

  async startCopy(input) {
    const kind = input.kind ?? 'demo'
    return getAccountProviders(kind).copyTrading.startCopy({ ...input, kind })
  },

  async stopCopy(copyTraderId, kind = 'demo') {
    return getAccountProviders(kind).copyTrading.stopCopy(copyTraderId, kind)
  },
}

export const copyTradingProvider: CopyTradingProvider = copyTradingService
