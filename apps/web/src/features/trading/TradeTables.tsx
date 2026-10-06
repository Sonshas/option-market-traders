import { useMemo, useState } from 'react'
import { DataTable, EmptyState, Skeleton, Tabs, Badge } from '@/components/ui'
import { formatContractTicket, lastDigitOfPrice } from '@/domain/contracts'
import { useWalletHistory } from '@/hooks/useWallet'
import { useTrades } from '@/hooks/useTrades'
import { formatMoney, formatPrice } from '@/lib/format'
import { ticksRemaining } from '@/domain/ticket'
import { getBufferedTicks } from '@/providers/market-data/tick-buffer'
import type { AccountMode, Trade, Transaction } from '@/types'

function remainingLabel(trade: Trade, now: number): string {
  const left = ticksRemaining(
    trade,
    getBufferedTicks(trade.symbol).map((tick) => tick.timestamp),
  )
  if (left != null) return left > 0 ? `${left} tick${left === 1 ? '' : 's'}` : 'Settling…'
  if (!trade.expiresAt) return '—'
  const ms = new Date(trade.expiresAt).getTime() - now
  if (ms <= 0) return 'Settling…'
  const sec = Math.ceil(ms / 1000)
  return `${sec}s`
}

function contractCell(trade: Trade): string {
  return formatContractTicket(trade.contractType, trade.contractOption, {
    digit: trade.selectedDigit,
    barrier: trade.barrier,
  })
}

function resultCell(trade: Trade): string {
  const status = trade.result || trade.status
  if (status === 'cancelled') return `REFUNDED (no exit tick) · P/L ${formatMoney(trade.profitLoss)}`
  const exitDigit =
    trade.exitDigit != null
      ? trade.exitDigit
      : trade.exitPrice != null && Number.isFinite(trade.exitPrice)
        ? lastDigitOfPrice(trade.exitPrice)
        : null
  const digit = exitDigit != null ? ` · digit ${exitDigit}` : ''
  return `${status.toUpperCase()}${digit} · P/L ${formatMoney(trade.profitLoss)}`
}

function tradeRows(trades: Trade[], mode: 'open' | 'history', now: number) {
  return trades.map((trade) => {
    if (mode === 'open') {
      return [
        `${trade.market || trade.symbol}${trade.isSimulated ? ' · DEMO' : ''}`,
        contractCell(trade),
        formatMoney(trade.stake),
        remainingLabel(trade, now),
        trade.status.toUpperCase(),
      ]
    }
    return [
      `${trade.market || trade.symbol}${trade.isSimulated ? ' · DEMO' : ''}`,
      contractCell(trade),
      formatMoney(trade.stake),
      resultCell(trade),
      (trade.resolvedAt ?? trade.updatedAt).slice(11, 19),
    ]
  })
}

function txRows(transactions: Transaction[]) {
  return transactions.map((tx) => [
    `${tx.type}${tx.isSimulated ? ' · DEMO' : ''}`,
    formatMoney(tx.amount),
    tx.status,
    tx.reference ?? '—',
    tx.createdAt.slice(11, 19),
  ])
}

export function TradeTables({
  kind,
  initialTab = 'open',
}: {
  kind: AccountMode
  initialTab?: 'open' | 'history' | 'tx'
}) {
  const [tab, setTab] = useState(initialTab)
  const { open, history, loading } = useTrades(kind)
  const { transactions, loading: txLoading } = useWalletHistory(kind)
  const now = Date.now()
  const isDemo = kind === 'demo'
  const firstLoad = (loading || txLoading) && open.length === 0 && history.length === 0 && transactions.length === 0

  const openRows = useMemo(() => tradeRows(open, 'open', now), [open, now])
  const historyRows = useMemo(() => tradeRows(history, 'history', now), [history, now])
  const transactionRows = useMemo(() => txRows(transactions), [transactions])

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between gap-2">
        <Tabs
          value={tab}
          onChange={(id) => setTab(id as typeof tab)}
          items={[
            { id: 'open', label: `${isDemo ? 'DEMO ' : ''}Open trades (${open.length})` },
            { id: 'history', label: isDemo ? 'DEMO Trade History' : 'Trade history' },
            { id: 'tx', label: isDemo ? 'DEMO Transactions' : 'Transactions' },
          ]}
        />
        <Badge tone={isDemo ? 'demo' : 'live'}>{isDemo ? 'DEMO' : 'REAL'}</Badge>
      </div>
      {firstLoad ? (
        <Skeleton className="h-28" />
      ) : (
        <>
          <div hidden={tab !== 'open'} role="tabpanel">
            <DataTable
              columns={['Market', 'Contract', 'Stake', 'Countdown', 'Status']}
              rows={openRows}
              empty={
                <EmptyState
                  title={isDemo ? 'No open DEMO trades' : 'No open trades'}
                  body={
                    isDemo
                      ? 'Place a DEMO EVEN/ODD, MATCH/DIFFER, or OVER/UNDER contract to see an open position with countdown.'
                      : undefined
                  }
                />
              }
            />
            {isDemo && open[0] ? (
              <p className="mt-2 text-xs text-mist">
                Entry {formatPrice(open[0].entryPrice)} (live tick) · settles on the first real tick after the
                countdown · DEMO virtual funds
              </p>
            ) : null}
            {!isDemo && open[0] ? (
              <p className="mt-2 text-xs text-mist">
                Entry {formatPrice(open[0].entryPrice)} (live tick) · settles on the first live tick after the
                countdown · REAL money
              </p>
            ) : null}
          </div>
          <div hidden={tab !== 'history'} role="tabpanel">
            <DataTable
              columns={['Market', 'Contract', 'Stake', 'Result', 'Closed']}
              rows={historyRows}
              empty={
                <EmptyState
                  title={isDemo ? 'No DEMO trade history' : 'No trades yet'}
                  body={isDemo ? 'Completed DEMO trades move here after settling on a live exit tick.' : undefined}
                />
              }
            />
          </div>
          <div hidden={tab !== 'tx'} role="tabpanel">
            <DataTable
              columns={['Type', 'Amount', 'Status', 'Reference', 'Time']}
              rows={transactionRows}
              empty={
                <EmptyState
                  title={isDemo ? 'No DEMO transactions' : 'No transactions yet'}
                  body={isDemo ? 'DEMO stakes, payouts, deposits, and withdrawals appear here.' : undefined}
                />
              }
            />
          </div>
        </>
      )}
    </div>
  )
}
