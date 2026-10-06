import type { ContractType, Trade } from '@/types'

export type TradeOutcomeFilter = 'all' | 'won' | 'lost' | 'tie' | 'cancelled'

export type TradeFilters = {
  outcome: TradeOutcomeFilter
  contractType: ContractType | 'all'
  symbol: string | 'all'
}

export const DEFAULT_TRADE_FILTERS: TradeFilters = { outcome: 'all', contractType: 'all', symbol: 'all' }

export function filterTrades(trades: Trade[], filters: TradeFilters): Trade[] {
  return trades.filter(
    (trade) =>
      (filters.outcome === 'all' || trade.status === filters.outcome) &&
      (filters.contractType === 'all' || trade.contractType === filters.contractType) &&
      (filters.symbol === 'all' || trade.symbol === filters.symbol),
  )
}

export function distinctSymbols(trades: Trade[]): string[] {
  return [...new Set(trades.map((trade) => trade.symbol))].sort()
}

function csvCell(value: string | number | null | undefined): string {
  if (value == null) return ''
  const text = String(value)
  return /[",\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text
}

export function tradesToCsv(trades: Trade[]): string {
  const header = [
    'id',
    'account_mode',
    'symbol',
    'contract_type',
    'contract_option',
    'digit',
    'barrier',
    'stake',
    'entry_price',
    'exit_price',
    'exit_digit',
    'status',
    'payout',
    'profit_loss',
    'opened_at',
    'closed_at',
  ]
  const rows = trades.map((trade) =>
    [
      trade.id,
      trade.accountMode,
      trade.symbol,
      trade.contractType,
      trade.contractOption,
      trade.selectedDigit,
      trade.barrier,
      trade.stake,
      trade.entryPrice,
      trade.exitPrice,
      trade.exitDigit ?? null,
      trade.status,
      trade.payout,
      trade.profitLoss,
      trade.createdAt,
      trade.resolvedAt,
    ]
      .map(csvCell)
      .join(','),
  )
  return [header.join(','), ...rows].join('\n')
}
