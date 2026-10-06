import { useEffect, useMemo, useState } from 'react'
import { cn } from '@/lib/cn'
import { formatContractTicket } from '@/domain/contracts'
import { ticksRemaining } from '@/domain/ticket'
import { useTrades } from '@/hooks/useTrades'
import { useWalletHistory } from '@/hooks/useWallet'
import { formatMoney } from '@/lib/format'
import { getBufferedTicks, subscribeTickBuffer } from '@/providers/market-data/tick-buffer'
import type { AccountMode, Trade } from '@/types'

type TabId = 'open' | 'closed' | 'tx'

/** Re-renders whenever a genuine tick arrives for any of `symbols` (tick countdowns). */
function useTickVersion(symbols: string[]): number {
  const [version, setVersion] = useState(0)
  const key = [...new Set(symbols)].sort().join('|')
  useEffect(() => {
    if (!key) return
    const offs = key.split('|').map((symbol) => subscribeTickBuffer(symbol, () => setVersion((v) => v + 1)))
    return () => offs.forEach((off) => off())
  }, [key])
  return version
}

function countdown(trade: Trade, now: number): string {
  const left = ticksRemaining(
    trade,
    getBufferedTicks(trade.symbol).map((tick) => tick.timestamp),
  )
  if (left != null) return left > 0 ? `${left} tick${left === 1 ? '' : 's'} left` : 'Settling…'
  if (!trade.expiresAt) return '—'
  const ms = new Date(trade.expiresAt).getTime() - now
  return ms > 0 ? `${Math.ceil(ms / 1000)}s left` : 'Settling…'
}

function resultLabel(trade: Trade): string {
  if (trade.status === 'cancelled') return 'REFUNDED'
  const digit = trade.exitDigit != null ? ` · digit ${trade.exitDigit}` : ''
  return `${trade.status.toUpperCase()}${digit}`
}

function TradeCard({ trade, now }: { trade: Trade; now: number }) {
  const open = trade.status === 'open'
  const pl = trade.profitLoss
  return (
    <li className="rounded-lg border border-line bg-ink-2 px-2.5 py-2 text-xs" data-testid="ticket-trade">
      <div className="flex items-center justify-between gap-2">
        <span className="truncate font-semibold text-paper">{trade.market || trade.symbol}</span>
        <span className="shrink-0 font-mono text-paper">{formatMoney(trade.stake)}</span>
      </div>
      <div className="mt-0.5 flex items-center justify-between gap-2 text-mist">
        <span className="truncate">
          {formatContractTicket(trade.contractType, trade.contractOption, {
            digit: trade.selectedDigit,
            barrier: trade.barrier,
          })}
          {trade.durationTicks != null ? ` · ${trade.durationTicks}t` : ''}
        </span>
        {open ? (
          <span className="shrink-0 font-mono text-amber" data-testid="ticket-countdown">
            {countdown(trade, now)}
          </span>
        ) : (
          <span
            className={cn(
              'shrink-0 font-mono',
              trade.status === 'won' ? 'text-call' : trade.status === 'lost' ? 'text-put' : 'text-mist',
            )}
          >
            {resultLabel(trade)} · {pl != null ? `${pl >= 0 ? '+' : '−'}${formatMoney(Math.abs(pl))}` : '—'}
          </span>
        )}
      </div>
    </li>
  )
}

/** Compact Open / Closed / Transactions box inside the trade ticket. */
export function TicketTrades({ kind }: { kind: AccountMode }) {
  const [tab, setTab] = useState<TabId>('open')
  const { open, history } = useTrades(kind)
  const { transactions } = useWalletHistory(kind)
  useTickVersion(open.map((trade) => trade.symbol))
  const [now, setNow] = useState(() => Date.now())
  useEffect(() => {
    if (open.length === 0) return
    const timer = window.setInterval(() => setNow(Date.now()), 1000)
    return () => window.clearInterval(timer)
  }, [open.length])
  const closed = useMemo(() => history.slice(0, 50), [history])
  const isDemo = kind === 'demo'

  const tabs: Array<{ id: TabId; label: string }> = [
    { id: 'open', label: `Open (${open.length})` },
    { id: 'closed', label: `Closed (${history.length})` },
    { id: 'tx', label: 'Transactions' },
  ]

  return (
    <div className="rounded-xl border border-line" data-testid="ticket-trades">
      <div className="flex border-b border-line" role="tablist" aria-label={isDemo ? 'DEMO trades' : 'REAL trades'}>
        {tabs.map((item) => (
          <button
            key={item.id}
            type="button"
            role="tab"
            aria-selected={tab === item.id}
            onClick={() => setTab(item.id)}
            className={cn(
              'flex-1 px-2 py-2 text-[11px] font-semibold',
              tab === item.id ? 'border-b-2 border-signal text-paper' : 'text-mist hover:text-paper',
            )}
          >
            {item.label}
          </button>
        ))}
      </div>
      <div className="sbb-scroll max-h-60 overflow-y-auto p-2" role="tabpanel">
        {tab === 'open' ? (
          open.length === 0 ? (
            <p className="py-4 text-center text-xs text-mist">No open {isDemo ? 'DEMO ' : ''}trades</p>
          ) : (
            <ul className="space-y-1.5">
              {open.map((trade) => (
                <TradeCard key={trade.id} trade={trade} now={now} />
              ))}
            </ul>
          )
        ) : null}
        {tab === 'closed' ? (
          closed.length === 0 ? (
            <p className="py-4 text-center text-xs text-mist">No closed {isDemo ? 'DEMO ' : ''}trades yet</p>
          ) : (
            <ul className="space-y-1.5">
              {closed.map((trade) => (
                <TradeCard key={trade.id} trade={trade} now={now} />
              ))}
            </ul>
          )
        ) : null}
        {tab === 'tx' ? (
          transactions.length === 0 ? (
            <p className="py-4 text-center text-xs text-mist">No {isDemo ? 'DEMO ' : ''}transactions yet</p>
          ) : (
            <ul className="space-y-1.5">
              {transactions.slice(0, 50).map((tx) => (
                <li key={tx.id} className="flex items-center justify-between gap-2 rounded-lg border border-line bg-ink-2 px-2.5 py-1.5 text-xs">
                  <span className="truncate text-mist">{tx.type.replace(/_/g, ' ')}</span>
                  <span className={cn('font-mono', tx.amount >= 0 ? 'text-call' : 'text-paper')}>{formatMoney(tx.amount)}</span>
                  <span className="shrink-0 font-mono text-[10px] text-mist">{tx.createdAt.slice(11, 19)}</span>
                </li>
              ))}
            </ul>
          )
        ) : null}
      </div>
    </div>
  )
}
