import { useEffect, useState } from 'react'
import { Link, useParams } from 'react-router-dom'
import { ConfirmDialog } from '@/components/ConfirmDialog'
import { Badge, Button, Card, Input, PageHeader, Skeleton } from '@/components/ui'
import { useAccountMode } from '@/hooks/useAccountMode'
import { REAL_COMING_SOON } from '@/domain/account'
import { copyTradingService } from '@/services/copy-trading'
import type { CopyTrader } from '@/types'

export function CopyTraderProfilePage() {
  const { traderId } = useParams()
  const { kind } = useAccountMode()
  const [trader, setTrader] = useState<CopyTrader | null>(null)
  const [loading, setLoading] = useState(true)
  const [allocation, setAllocation] = useState('10')
  const [maxDailyLoss, setMaxDailyLoss] = useState('5')
  const [open, setOpen] = useState(false)
  const [busy, setBusy] = useState(false)
  const [result, setResult] = useState<string | null>(null)
  const isDemo = kind === 'demo'

  useEffect(() => {
    let cancelled = false
    if (!traderId) return
    void copyTradingService.getTrader(traderId, kind).then((next) => {
      if (!cancelled) {
        setTrader(next.data)
        setLoading(false)
      }
    })
    return () => {
      cancelled = true
    }
  }, [traderId, kind])

  async function confirm() {
    if (!trader || !isDemo) return
    setBusy(true)
    const next = await copyTradingService.startCopy({
      copyTraderId: trader.id,
      allocation: Number(allocation),
      maxDailyLoss: Number(maxDailyLoss),
      kind: 'demo',
    })
    setResult(next.message)
    setBusy(false)
  }

  if (loading) return <Skeleton className="h-64" />
  if (!trader) {
    return (
      <div>
        <PageHeader title="Trader not found" subtitle={isDemo ? 'This DEMO trader does not exist.' : 'Real copy trading is coming soon.'} />
        <Link to="/app/copy" className="text-sm text-signal hover:underline">
          Back to copy trading
        </Link>
      </div>
    )
  }

  return (
    <div>
      <PageHeader
        title={trader.displayName}
        subtitle={`${trader.handle} · DEMO profile — not a verified live trader`}
        actions={<Badge tone="demo">DEMO</Badge>}
      />
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <Card>
          <p className="text-xs uppercase text-mist">30-day P&amp;L</p>
          <p className="mt-1 font-mono text-sm text-warn">{trader.historicalPnl}</p>
        </Card>
        <Card>
          <p className="text-xs uppercase text-mist">ROI</p>
          <p className="mt-1 font-mono text-sm text-warn">{trader.historicalRoi}</p>
        </Card>
        <Card>
          <p className="text-xs uppercase text-mist">Win rate</p>
          <p className="mt-1 font-mono text-sm text-warn">{trader.historicalWinRate}</p>
        </Card>
        <Card>
          <p className="text-xs uppercase text-mist">Trade count</p>
          <p className="mt-1 font-mono text-xl">{trader.tradeCount}</p>
        </Card>
      </div>
      <Card className="mt-4">
        <p className="text-sm text-mist">{trader.style}</p>
        <p className="mt-2 text-sm text-mist">Risk: {trader.riskLevel}. DEMO performance is N/A — not a guaranteed win rate.</p>
        {isDemo ? (
          <>
            <div className="mt-4 grid gap-3 sm:grid-cols-2">
              <Input label="Allocation %" type="number" value={allocation} onChange={(e) => setAllocation(e.target.value)} />
              <Input
                label="Max daily loss %"
                type="number"
                value={maxDailyLoss}
                onChange={(e) => setMaxDailyLoss(e.target.value)}
              />
            </div>
            <Button
              className="mt-4"
              onClick={() => {
                setResult(null)
                setOpen(true)
              }}
            >
              Copy DEMO trader
            </Button>
          </>
        ) : (
          <Button className="mt-4" disabled>
            Copy trader · {REAL_COMING_SOON}
          </Button>
        )}
      </Card>
      <ConfirmDialog
        open={open && isDemo}
        title="Start DEMO copy"
        body="DEMO simulated copy only. This does not mirror real trades or invent performance."
        confirmLabel="Start DEMO copy"
        loading={busy}
        resultMessage={result}
        onClose={() => setOpen(false)}
        onConfirm={() => void confirm()}
      />
    </div>
  )
}
