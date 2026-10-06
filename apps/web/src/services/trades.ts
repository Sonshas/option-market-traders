import { getAccountProviders } from '@/providers/registry'
import type {
  AccountMode,
  ContractOption,
  ContractQuote,
  ContractType,
  PlaceTradeInput,
  ProviderResult,
  Trade,
  TradeResult,
} from '@/types'

/**
 * Mode-scoped trading facade.
 * DEMO → local simulated engine. REAL → NOT_CONNECTED (never uses demo data).
 */
export interface TradingProvider {
  readonly id: string
  listOpen(kind: AccountMode): Promise<ProviderResult<Trade[]>>
  listHistory(kind: AccountMode): Promise<ProviderResult<Trade[]>>
  listResults(kind: AccountMode): Promise<ProviderResult<TradeResult[]>>
  getQuote(input: {
    stake: number
    durationMs: number
    symbol: string
    contractType?: ContractType
    contractOption?: ContractOption
    kind?: AccountMode
  }): Promise<ProviderResult<ContractQuote>>
  place(input: PlaceTradeInput): Promise<ProviderResult<Trade | null>>
  settleDue(now?: number): Promise<ProviderResult<Trade[]>>
}

function trading(kind: AccountMode) {
  return getAccountProviders(kind).trading
}

export const tradeService: TradingProvider = {
  id: 'mode-scoped',

  async listOpen(kind) {
    return trading(kind).listOpen(kind)
  },

  async listHistory(kind) {
    return trading(kind).listHistory(kind)
  },

  async listResults(kind) {
    return trading(kind).listResults(kind)
  },

  async getQuote(input) {
    const kind = input.kind ?? 'demo'
    return trading(kind).getQuote({ ...input, kind })
  },

  async place(input) {
    const kind = input.accountMode ?? input.kind
    return trading(kind).placeTrade({ ...input, kind, accountMode: kind })
  },

  async settleDue(now) {
    return trading('demo').settleDue(now)
  },
}

export const tradingProvider: TradingProvider = tradeService
