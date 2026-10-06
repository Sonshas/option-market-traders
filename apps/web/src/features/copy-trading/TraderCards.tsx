import { useState } from 'react'
import { Link } from 'react-router-dom'
import { ConfirmDialog } from '@/components/ConfirmDialog'
import { Badge, Button, Card, DataTable, EmptyState, Input, PageHeader, Skeleton } from '@/components/ui'
import { useAccountMode } from '@/hooks/useAccountMode'
import { useCopyTraders } from '@/hooks/useBots'
import { accountModeLabel } from '@/domain/account'
import { copyTradingProvider } from '@/services/copy-trading'
import type { CopyTrader } from '@/types'

const riskTone = {
  low: 'call' as const,
  medium: 'amber' as const,
  high: 'put' as const,
}

export function TraderCards() {
  const { kind } = useAccountMode()
  const { traders, copies, loading } = useCopyTraders()
  const [selected, setSelected] = useState<CopyTrader | null>(null)
  const [allocation, setAllocation] = useState('10')
  const [maxDailyLoss, setMaxDailyLoss] = useState('5')
  const [open, setOpen] = useState<'copy' | 'stop' | null>(null)
  const [busy, setBusy] = useState(false)
  const [result, setResult] = useState<string | null>(null)
  const [errors, setErrors] = useState<Record<string, string>>({})
  const isDemo = kind === 'demo'

  function validateCopy() {
    const next: Record<string, string> = {}
    if (!(Number(allocation) > 0 && Number(allocation) <= 100)) next.allocation = 'Allocation must be between 1 and 100.'
    if (!(Number(maxDailyLoss) > 0 && Number(maxDailyLoss) <= 100)) {
      next.maxDailyLoss = 'Max daily loss must be between 1 and 100.'
    }
    setErrors(next)
    return Object.keys(next).length === 0
  }

  async function confirm() {
    if (!selected || !isDemo) return
    if (open === 'copy' && !validateCopy()) return
    setBusy(true)
    const next =
      open === 'copy'
        ? await copyTradingProvider.startCopy({
            copyTraderId: selected.id,
            allocation: Number(allocation),
            maxDailyLoss: Number(maxDailyLoss),
            kind: 'demo',
          })
        : await copyTradingProvider.stopCopy(selected.id, 'demo')
    setResult(next.message)
    setBusy(false)
  }

  const copyRows = copies.map((copy) => [
    `DEMO ${copy.copyTraderId}`,
    `${copy.allocation ?? '—'}%`,
    copy.status.toUpperCase(),
    copy.isSimulated ? 'SIMULATED' : '—',
    copy.updatedAt.slice(11, 19),
  ])

  return (
    <div>
      <PageHeader
        title={isDemo ? 'DEMO Copy Trading' : 'REAL Copy Trading'}
        subtitle={
          isDemo
            ? 'Practice copying DEMO traders with virtual funds. Not a live track record and not a guaranteed win rate.'
            : undefined
        }
        actions={<Badge tone={isDemo ? 'demo' : 'live'}>{accountModeLabel(kind)}</Badge>}
      />
      {loading ? (
        <Skeleton className="h-64" />
      ) : !isDemo ? (
        <Card>
          <EmptyState title="Real copy trading is coming soon" />
        </Card>
      ) : (
        <Card className="overflow-hidden !p-0">
          <div className="hidden md:block">
            <table className="w-full text-left text-sm">
              <thead>
                <tr className="border-b border-line text-[11px] uppercase tracking-wider text-mist">
                  <th className="px-4 py-3 font-semibold">DEMO Trader</th>
                  <th className="px-4 py-3 font-semibold">30-day P&amp;L</th>
                  <th className="px-4 py-3 font-semibold">ROI</th>
                  <th className="px-4 py-3 font-semibold">Win rate</th>
                  <th className="px-4 py-3 font-semibold">Risk</th>
                  <th className="px-4 py-3 font-semibold">Trades</th>
                  <th className="px-4 py-3 font-semibold">Copy</th>
                </tr>
              </thead>
              <tbody>
                {traders.map((trader) => (
                  <tr key={trader.id} className="border-b border-line/70 last:border-0">
                    <td className="px-4 py-3">
                      <Link to={`/app/copy/${trader.id}`} className="font-semibold text-paper hover:text-signal">
                        {trader.displayName}
                      </Link>
                      <p className="text-xs text-mist">{trader.handle} · DEMO</p>
                    </td>
                    <td className="px-4 py-3 font-mono text-xs text-warn">{trader.historicalPnl}</td>
                    <td className="px-4 py-3 font-mono text-xs text-warn">{trader.historicalRoi}</td>
                    <td className="px-4 py-3 font-mono text-xs text-warn">{trader.historicalWinRate}</td>
                    <td className="px-4 py-3">
                      <Badge tone={riskTone[trader.riskLevel]}>{trader.riskLevel}</Badge>
                    </td>
                    <td className="px-4 py-3 font-mono text-xs text-mist">{trader.tradeCount}</td>
                    <td className="px-4 py-3">
                      <Button
                        size="sm"
                        onClick={() => {
                          setSelected(trader)
                          setResult(null)
                          setErrors({})
                          setOpen('copy')
                        }}
                      >
                        Copy DEMO
                      </Button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <div className="space-y-3 p-3 md:hidden">
            {traders.map((trader) => (
              <div key={trader.id} className="rounded-xl border border-line bg-ink-2 p-3">
                <div className="flex items-start justify-between gap-2">
                  <div>
                    <Link to={`/app/copy/${trader.id}`} className="font-display font-semibold hover:text-signal">
                      {trader.displayName}
                    </Link>
                    <p className="text-xs text-mist">{trader.handle} · DEMO</p>
                  </div>
                  <Badge tone={riskTone[trader.riskLevel]}>{trader.riskLevel}</Badge>
                </div>
                <dl className="mt-3 grid grid-cols-2 gap-2 text-xs">
                  <div>
                    <dt className="uppercase text-mist">30-day P&amp;L</dt>
                    <dd className="font-mono text-warn">{trader.historicalPnl}</dd>
                  </div>
                  <div>
                    <dt className="uppercase text-mist">ROI</dt>
                    <dd className="font-mono text-warn">{trader.historicalRoi}</dd>
                  </div>
                  <div>
                    <dt className="uppercase text-mist">Win rate</dt>
                    <dd className="font-mono text-warn">{trader.historicalWinRate}</dd>
                  </div>
                  <div>
                    <dt className="uppercase text-mist">Trades</dt>
                    <dd className="font-mono">{trader.tradeCount}</dd>
                  </div>
                </dl>
                <Button
                  size="sm"
                  className="mt-3 w-full"
                  onClick={() => {
                    setSelected(trader)
                    setResult(null)
                    setErrors({})
                    setOpen('copy')
                  }}
                >
                  Copy DEMO
                </Button>
              </div>
            ))}
          </div>
        </Card>
      )}

      {selected && isDemo ? (
        <Card className="mt-6">
          <h3 className="font-display font-semibold">DEMO Allocation · {selected.displayName}</h3>
          <p className="mt-1 text-sm text-mist">
            DEMO trader only. Not a verified live trader and not a guaranteed win rate.
          </p>
          <div className="mt-3 grid gap-3 sm:grid-cols-2">
            <Input
              label="Allocation %"
              type="number"
              value={allocation}
              onChange={(e) => setAllocation(e.target.value)}
              error={errors.allocation}
            />
            <Input
              label="Max daily loss %"
              type="number"
              value={maxDailyLoss}
              onChange={(e) => setMaxDailyLoss(e.target.value)}
              error={errors.maxDailyLoss}
            />
          </div>
          <Button
            className="mt-3"
            variant="secondary"
            size="sm"
            onClick={() => {
              setResult(null)
              setOpen('stop')
            }}
          >
            Stop DEMO copy
          </Button>
        </Card>
      ) : null}

      <Card className="mt-6">
        <h3 className="font-display font-semibold">{isDemo ? 'DEMO Active copies' : 'Active copies'}</h3>
        <DataTable
          columns={['Trader', 'Allocation', 'Status', 'Kind', 'Updated']}
          rows={isDemo ? copyRows : []}
          empty={
            <EmptyState
              title={isDemo ? 'Not copying anyone (DEMO)' : 'Not copying anyone yet'}
              body={isDemo ? 'Start copying a DEMO trader to record an allocation here.' : undefined}
            />
          }
        />
      </Card>

      <ConfirmDialog
        open={open !== null && isDemo}
        title={open === 'copy' ? 'Start DEMO copy' : 'Stop DEMO copy'}
        body="DEMO simulated copy relationship only. This does not mirror live traders or invent real performance."
        confirmLabel={open === 'copy' ? 'Start DEMO copy' : 'Stop DEMO copy'}
        loading={busy}
        resultMessage={result}
        onClose={() => setOpen(null)}
        onConfirm={() => void confirm()}
      />
    </div>
  )
}
