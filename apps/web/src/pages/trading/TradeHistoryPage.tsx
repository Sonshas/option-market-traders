import { useMemo, useState } from 'react'
import { Badge, Button, Card, DataTable, EmptyState, PageHeader, Select, Skeleton, Stat } from '@/components/ui'
import { TradeTables } from '@/features/trading/TradeTables'
import { useAccountMode } from '@/hooks/useAccountMode'
import { useTrades } from '@/hooks/useTrades'
import { accountModeLabel } from '@/domain/account'
import { summarizeTrades } from '@/domain/chart-data'
import { CONTRACT_TYPES, formatContractTicket, lastDigitOfPrice } from '@/domain/contracts'
import {
  DEFAULT_TRADE_FILTERS,
  distinctSymbols,
  filterTrades,
  tradesToCsv,
  type TradeFilters,
} from '@/domain/trade-filters'
import { formatMoney, formatPrice } from '@/lib/format'
import type { Trade } from '@/types'

function exitCell(trade: Trade): string {
  if (trade.status === 'cancelled') return 'No exit tick'
  const digit =
    trade.exitDigit ?? (trade.exitPrice != null ? lastDigitOfPrice(trade.exitPrice) : null)
  return trade.exitPrice != null ? `${formatPrice(trade.exitPrice)} · ${digit ?? '—'}` : '—'
}

function downloadCsv(filename: string, csv: string) {
  const blob = new Blob([csv], { type: 'text/csv;charset=utf-8' })
  const url = URL.createObjectURL(blob)
  const link = document.createElement('a')
  link.href = url
  link.download = filename
  link.click()
  URL.revokeObjectURL(url)
}

export function TradeHistoryPage() {
  const { kind } = useAccountMode()
  const isDemo = kind === 'demo'
  const { history, loading } = useTrades(kind)
  const [filters, setFilters] = useState<TradeFilters>(DEFAULT_TRADE_FILTERS)
  const filtered = useMemo(() => filterTrades(history, filters), [history, filters])
  const summary = useMemo(() => summarizeTrades(filtered), [filtered])
  const symbols = useMemo(() => distinctSymbols(history), [history])

  const rows = filtered.map((trade) => [
    `${trade.symbol}${trade.botRunId ? ' · BOT' : ''}`,
    formatContractTicket(trade.contractType, trade.contractOption, {
      digit: trade.selectedDigit,
      barrier: trade.barrier,
    }),
    formatMoney(trade.stake),
    formatPrice(trade.entryPrice),
    exitCell(trade),
    trade.status === 'cancelled' ? 'REFUNDED' : trade.status.toUpperCase(),
    formatMoney(trade.profitLoss),
    new Date(trade.resolvedAt ?? trade.updatedAt).toLocaleString(),
  ])

  return (
    <div>
      <PageHeader
        title={isDemo ? 'DEMO Trade History' : 'Trade history'}
        subtitle={isDemo ? 'Completed DEMO trades. Virtual funds — not real trading results.' : undefined}
        actions={<Badge tone={isDemo ? 'demo' : 'live'}>{accountModeLabel(kind)}</Badge>}
      />

      <div className="grid grid-cols-2 gap-2 lg:grid-cols-4">
        <Stat label="Trades" value={String(summary.total)} hint={`${summary.wins}W · ${summary.losses}L · ${summary.ties}T`} />
        <Stat
          label="Win rate (filtered)"
          value={summary.winRate == null ? '—' : `${summary.winRate.toFixed(1)}%`}
          hint="Your past results only"
        />
        <Stat label="Net P/L" value={formatMoney(summary.total ? summary.netPnl : null)} tone={isDemo ? 'demo' : 'live'} />
        <Stat label="Total staked" value={formatMoney(summary.total ? summary.totalStaked : null)} />
      </div>

      <Card className="mt-4">
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <Select
            label="Outcome"
            value={filters.outcome}
            onChange={(e) => setFilters((f) => ({ ...f, outcome: e.target.value as TradeFilters['outcome'] }))}
          >
            <option value="all">All outcomes</option>
            <option value="won">Won</option>
            <option value="lost">Lost</option>
            <option value="tie">Tie</option>
            <option value="cancelled">Refunded</option>
          </Select>
          <Select
            label="Contract"
            value={filters.contractType}
            onChange={(e) =>
              setFilters((f) => ({ ...f, contractType: e.target.value as TradeFilters['contractType'] }))
            }
          >
            <option value="all">All contracts</option>
            {CONTRACT_TYPES.map((type) => (
              <option key={type.id} value={type.id}>
                {type.label}
              </option>
            ))}
          </Select>
          <Select
            label="Market"
            value={filters.symbol}
            onChange={(e) => setFilters((f) => ({ ...f, symbol: e.target.value }))}
          >
            <option value="all">All markets</option>
            {symbols.map((symbol) => (
              <option key={symbol} value={symbol}>
                {symbol}
              </option>
            ))}
          </Select>
          <div className="flex items-end gap-2">
            <Button variant="secondary" className="flex-1" onClick={() => setFilters(DEFAULT_TRADE_FILTERS)}>
              Reset
            </Button>
            <Button
              className="flex-1"
              disabled={filtered.length === 0}
              onClick={() => downloadCsv(`${kind}-trades.csv`, tradesToCsv(filtered))}
            >
              Export CSV
            </Button>
          </div>
        </div>

        <div className="mt-4">
          {loading && history.length === 0 ? (
            <Skeleton className="h-40" />
          ) : (
            <DataTable
              columns={['Market', 'Contract', 'Stake', 'Entry', 'Exit · digit', 'Result', 'P/L', 'Closed']}
              rows={rows}
              empty={
                <EmptyState
                  title={history.length === 0 ? (isDemo ? 'No DEMO trade history' : 'No trades yet') : 'No trades match these filters'}
                  body={
                    history.length === 0
                      ? isDemo
                        ? 'Completed DEMO trades appear here after settling on a live exit tick.'
                        : undefined
                      : 'Change or reset the filters to see more trades.'
                  }
                />
              }
            />
          )}
        </div>
      </Card>

      <Card className="sbb-panel mt-4">
        <TradeTables kind={kind} initialTab="open" />
      </Card>
    </div>
  )
}
