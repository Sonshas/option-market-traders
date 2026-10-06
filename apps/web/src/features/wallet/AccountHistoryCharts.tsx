import { useMemo, useState } from 'react'
import { SeriesChart } from '@/components/chart/SeriesChart'
import { Card, EmptyState, Skeleton, Stat, Tabs } from '@/components/ui'
import { useTrades } from '@/hooks/useTrades'
import { useDemoLedger } from '@/hooks/useWallet'
import {
  balanceSeriesFromLedger,
  cumulativePnlSeries,
  summarizeTrades,
} from '@/domain/chart-data'
import { formatMoney } from '@/lib/format'
import { DEMO_STARTING_BALANCE } from '@/providers/config'
import type { AccountMode } from '@/types'

/**
 * Balance and realized P&L history from the account's own records only:
 * DEMO → local trades + ledger; REAL → Supabase trade rows (read-only, RLS).
 */
export function AccountHistoryCharts({ kind, compact = false }: { kind: AccountMode; compact?: boolean }) {
  const isDemo = kind === 'demo'
  const { history, loading } = useTrades(kind)
  const ledger = useDemoLedger()
  const [view, setView] = useState(isDemo ? 'balance' : 'pnl')
  const summary = useMemo(() => summarizeTrades(history), [history])
  const pnlPoints = useMemo(() => cumulativePnlSeries(history), [history])
  const balancePoints = useMemo(
    () => (isDemo ? balanceSeriesFromLedger(ledger, DEMO_STARTING_BALANCE) : []),
    [isDemo, ledger],
  )
  const activeView = isDemo ? view : 'pnl'
  const points = activeView === 'balance' ? balancePoints : pnlPoints

  return (
    <Card>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <h2 className="font-display font-semibold">{isDemo ? 'DEMO performance' : 'Performance'}</h2>
          {isDemo ? <p className="text-xs text-mist">From your DEMO trades. Virtual funds only.</p> : null}
        </div>
        {isDemo ? (
          <Tabs
            value={activeView}
            onChange={setView}
            items={[
              { id: 'balance', label: 'Balance' },
              { id: 'pnl', label: 'Cumulative P/L' },
            ]}
          />
        ) : null}
      </div>

      {!compact ? (
        <div className="mt-3 grid grid-cols-2 gap-2 lg:grid-cols-4">
          <Stat label="Settled trades" value={String(summary.total)} hint={`${summary.wins}W · ${summary.losses}L · ${summary.ties}T`} />
          <Stat
            label="Win rate (yours)"
            value={summary.winRate == null ? '—' : `${summary.winRate.toFixed(1)}%`}
            hint="Past results, not a forecast"
          />
          <Stat
            label="Net P/L"
            value={formatMoney(summary.total ? summary.netPnl : null)}
            tone={isDemo ? 'demo' : 'live'}
            hint={isDemo ? 'DEMO virtual funds' : undefined}
          />
          <Stat label="Total staked" value={formatMoney(summary.total ? summary.totalStaked : null)} />
        </div>
      ) : null}

      <div className="mt-3">
        {loading && history.length === 0 ? (
          <Skeleton className="h-52" />
        ) : points.length < 2 ? (
          <EmptyState
            title={activeView === 'balance' ? 'No balance history yet' : 'No settled trades yet'}
            body={isDemo ? 'Place a DEMO trade or a DEMO deposit — the chart builds from your own records.' : undefined}
          />
        ) : (
          <SeriesChart
            points={points}
            variant={activeView === 'balance' ? 'area' : 'baseline'}
            height={compact ? 180 : 240}
            ariaLabel={activeView === 'balance' ? 'Balance history chart' : 'Cumulative profit and loss chart'}
          />
        )}
      </div>
    </Card>
  )
}
