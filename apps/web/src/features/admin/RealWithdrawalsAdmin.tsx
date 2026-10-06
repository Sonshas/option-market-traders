import { useCallback, useEffect, useState } from 'react'
import { Alert, Badge, Button, Input, Select } from '@/components/ui'
import { localPhoneDisplay, withdrawalStatusLabel, type WithdrawalStatus } from '@/domain/withdrawals'
import { useAuthSession } from '@/hooks/useAuth'
import { formatMoney } from '@/lib/format'
import { withdrawalService, type AdminWithdrawalList, type AdminWithdrawalRow } from '@/services/withdrawals'

type Filter = 'OPEN' | 'ALL' | WithdrawalStatus

function kes(value: number | null): string {
  return value == null ? '—' : `KES ${Math.round(value).toLocaleString('en-US')}`
}

function when(iso: string | null): string {
  if (!iso) return '—'
  const d = new Date(iso)
  return Number.isNaN(d.getTime()) ? '—' : d.toLocaleString('en-KE', { dateStyle: 'medium', timeStyle: 'short' })
}

function tone(status: string): 'warn' | 'signal' | 'call' | 'danger' | 'mist' {
  if (status === 'COMPLETED') return 'call'
  if (status === 'FAILED') return 'danger'
  if (status === 'PROCESSING') return 'signal'
  if (status === 'CANCELLED') return 'mist'
  return 'warn'
}

/**
 * Staff view of REAL M-Pesa withdrawals. Every action calls the admin-withdrawals Edge Function, which checks the
 * caller's staff role and then runs the SECURITY DEFINER functions:
 *   Mark processing → you are about to pay;  Complete → money HAS been sent (M-Pesa receipt required);
 *   Fail → payout did not happen, the hold is refunded to the user (reason shown to them).
 */
export function RealWithdrawalsAdmin() {
  const { isSignedIn, user } = useAuthSession()
  const [filter, setFilter] = useState<Filter>('OPEN')
  const [list, setList] = useState<AdminWithdrawalList | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)
  const [busyId, setBusyId] = useState<string | null>(null)
  const [receipts, setReceipts] = useState<Record<string, string>>({})
  const [reasons, setReasons] = useState<Record<string, string>>({})
  const [notice, setNotice] = useState<string | null>(null)

  const load = useCallback(async () => {
    if (!isSignedIn) return
    setLoading(true)
    const result = await withdrawalService.adminList(filter)
    setLoading(false)
    if (result.ok) {
      setList(result.data)
      setError(null)
    } else {
      setError(result.error)
    }
  }, [filter, isSignedIn])

  useEffect(() => {
    void load()
  }, [load])

  // Live refresh while the page is open (rows change when users request or callbacks settle).
  useEffect(() => {
    if (!isSignedIn || !user?.id) return
    const timer = window.setInterval(() => void load(), 15_000)
    return () => window.clearInterval(timer)
  }, [isSignedIn, user?.id, load])

  async function act(row: AdminWithdrawalRow, action: 'processing' | 'complete' | 'fail') {
    const receipt = (receipts[row.id] ?? '').trim()
    const reason = (reasons[row.id] ?? '').trim()
    if (action === 'complete' && !receipt) {
      setError('Enter the M-Pesa receipt (transaction code) from the payment you made before completing.')
      return
    }
    if (action === 'fail' && !reason) {
      setError('Enter the reason the payout could not be made. It is shown to the user and the hold is refunded.')
      return
    }
    if (action === 'complete' && !window.confirm(`Confirm KES ${Math.round(row.netKes).toLocaleString()} was sent to ${localPhoneDisplay(row.msisdn)} (receipt ${receipt.toUpperCase()})?`)) return
    if (action === 'fail' && !window.confirm(`Mark ${row.reference ?? row.id} as FAILED and refund ${formatMoney(row.amountUsd)} to the user?`)) return
    setBusyId(row.id)
    setError(null)
    const result = await withdrawalService.adminAct(action, row.id, { receipt, reason })
    setBusyId(null)
    if (!result.ok) {
      setError(result.error)
      return
    }
    setNotice(
      action === 'complete'
        ? `${row.reference ?? row.id} marked COMPLETED with receipt ${receipt.toUpperCase()}.`
        : action === 'fail'
          ? `${row.reference ?? row.id} marked FAILED; ${formatMoney(row.amountUsd)} refunded to the user.`
          : `${row.reference ?? row.id} is now PROCESSING.`,
    )
    await load()
  }

  if (!isSignedIn) {
    return (
      <Alert tone="mist">Sign in with a staff account to see and pay REAL withdrawals.</Alert>
    )
  }

  const rows = list?.withdrawals ?? []
  return (
    <div className="space-y-3" data-testid="real-withdrawals-admin">
      <div className="flex flex-wrap items-end justify-between gap-2">
        <div className="flex flex-wrap items-end gap-2">
          <Select label="Show" value={filter} onChange={(e) => setFilter(e.target.value as Filter)}>
            <option value="OPEN">Open (PENDING + PROCESSING)</option>
            <option value="ALL">All</option>
            <option value="PENDING">PENDING</option>
            <option value="PROCESSING">PROCESSING</option>
            <option value="COMPLETED">COMPLETED</option>
            <option value="FAILED">FAILED</option>
          </Select>
          <Button type="button" variant="secondary" onClick={() => void load()} disabled={loading}>
            {loading ? 'Refreshing…' : 'Refresh'}
          </Button>
        </div>
        {list ? (
          <p className="text-xs text-mist">
            Payout mode: <span className="font-semibold text-paper">{list.mode === 'daraja_b2c' ? 'Daraja B2C (automatic)' : 'Manual (pay from the business M-Pesa, then enter the receipt)'}</span>
            {' · '}fee {kes(list.feeKes)} · {list.kesPerUsd} KES = $1
          </p>
        ) : null}
      </div>

      {error ? <Alert tone="danger">{error}</Alert> : null}
      {notice ? <Alert tone="signal">{notice}</Alert> : null}

      {list && rows.length === 0 ? (
        <p className="text-sm text-mist">No REAL withdrawals match this filter.</p>
      ) : null}

      <ul className="space-y-3">
        {rows.map((row) => {
          const open = row.status === 'PENDING' || row.status === 'PROCESSING'
          const busy = busyId === row.id
          return (
            <li key={row.id} className="rounded-xl border border-line bg-ink-2/60 p-3 text-sm" data-testid="admin-withdrawal-row">
              <div className="flex flex-wrap items-start justify-between gap-2">
                <div>
                  <p className="font-mono text-xs text-mist">{row.reference ?? row.id}</p>
                  <p className="font-semibold text-paper">{row.userName ?? 'Unnamed user'}</p>
                  <p className="text-xs text-mist">{row.userEmail ?? row.userId}</p>
                </div>
                <div className="text-right">
                  <Badge tone={tone(row.status)}>{row.status}</Badge>
                  <p className="mt-1 text-xs text-mist">{withdrawalStatusLabel(row.status)}</p>
                </div>
              </div>
              <dl className="mt-2 grid grid-cols-2 gap-x-4 gap-y-1 text-xs sm:grid-cols-4">
                <dt className="text-mist">Pay to M-Pesa</dt>
                <dd className="font-mono text-paper">{localPhoneDisplay(row.msisdn) || '—'}</dd>
                <dt className="text-mist">Send (net)</dt>
                <dd className="font-mono font-semibold text-live">{kes(row.netKes)}</dd>
                <dt className="text-mist">Held from wallet</dt>
                <dd className="font-mono">{formatMoney(row.amountUsd)} · {kes(row.amountKes)}</dd>
                <dt className="text-mist">Fee</dt>
                <dd className="font-mono">{kes(row.feeKes)}</dd>
                <dt className="text-mist">Requested</dt>
                <dd>{when(row.createdAt)}</dd>
                <dt className="text-mist">Processing</dt>
                <dd>{when(row.processingAt)}</dd>
                <dt className="text-mist">Completed</dt>
                <dd>{when(row.completedAt)}</dd>
                <dt className="text-mist">Failed</dt>
                <dd>{when(row.failedAt)}</dd>
                {row.receipt ? (
                  <>
                    <dt className="text-mist">M-Pesa receipt</dt>
                    <dd className="font-mono">{row.receipt}</dd>
                  </>
                ) : null}
                {row.failureReason ? (
                  <>
                    <dt className="text-mist">Failure reason</dt>
                    <dd className="text-danger">{row.failureReason}</dd>
                  </>
                ) : null}
                {row.provider ? (
                  <>
                    <dt className="text-mist">Provider</dt>
                    <dd>{row.provider}</dd>
                  </>
                ) : null}
                {row.adminNote ? (
                  <>
                    <dt className="text-mist">Note</dt>
                    <dd className="sm:col-span-3">{row.adminNote}</dd>
                  </>
                ) : null}
              </dl>

              {open ? (
                <div className="mt-3 grid gap-2 border-t border-line pt-3 sm:grid-cols-[1fr_auto]">
                  <div className="grid gap-2 sm:grid-cols-2">
                    <Input
                      label="M-Pesa receipt (after you have paid)"
                      placeholder="e.g. SG63XXXXXX"
                      value={receipts[row.id] ?? ''}
                      onChange={(e) => setReceipts((s) => ({ ...s, [row.id]: e.target.value.toUpperCase() }))}
                      disabled={busy}
                    />
                    <Input
                      label="Reason (only if the payout cannot be made)"
                      placeholder="e.g. Number not registered on M-Pesa"
                      value={reasons[row.id] ?? ''}
                      onChange={(e) => setReasons((s) => ({ ...s, [row.id]: e.target.value }))}
                      disabled={busy}
                    />
                  </div>
                  <div className="flex flex-wrap items-end gap-2">
                    {row.status === 'PENDING' ? (
                      <Button type="button" size="sm" variant="secondary" disabled={busy} onClick={() => void act(row, 'processing')}>
                        Mark processing
                      </Button>
                    ) : null}
                    <Button type="button" size="sm" disabled={busy || !(receipts[row.id] ?? '').trim()} onClick={() => void act(row, 'complete')}>
                      Complete (money sent)
                    </Button>
                    <Button type="button" size="sm" variant="danger" disabled={busy || !(reasons[row.id] ?? '').trim()} onClick={() => void act(row, 'fail')}>
                      Fail + refund
                    </Button>
                  </div>
                </div>
              ) : null}
            </li>
          )
        })}
      </ul>
    </div>
  )
}
