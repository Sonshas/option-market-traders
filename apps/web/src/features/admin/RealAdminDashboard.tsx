import { useCallback, useEffect, useState } from 'react'
import { Alert, Badge, Button, PageHeader, Skeleton, Stat } from '@/components/ui'
import { useAuthSession } from '@/hooks/useAuth'
import { formatMoney } from '@/lib/format'
import {
  adminDashboardService,
  type AdminDashboard,
  type DashboardDepositRow,
  type DashboardUserRow,
} from '@/services/admin-dashboard'

function kes(value: number | null): string {
  if (value == null) return '—'
  const whole = Math.abs(value - Math.round(value)) < 0.001
  return `KES ${value.toLocaleString('en-US', {
    minimumFractionDigits: whole ? 0 : 2,
    maximumFractionDigits: whole ? 0 : 2,
  })}`
}

function when(iso: string | null): string {
  if (!iso) return '—'
  const d = new Date(iso)
  return Number.isNaN(d.getTime()) ? '—' : d.toLocaleString('en-KE', { dateStyle: 'medium', timeStyle: 'short' })
}

function statusTone(status: string): 'warn' | 'signal' | 'call' | 'danger' | 'mist' {
  if (status === 'COMPLETED') return 'call'
  if (status === 'FAILED') return 'danger'
  if (status === 'CANCELLED') return 'mist'
  if (status === 'PROCESSING') return 'signal'
  return 'warn'
}

function roleTone(role: string): 'signal' | 'warn' | 'mist' {
  if (role === 'admin' || role === 'superadmin' || role === 'finance') return 'signal'
  if (role === 'support' || role === 'compliance') return 'warn'
  return 'mist'
}

function payer(row: DashboardDepositRow): string {
  return row.userEmail ?? 'No email on file'
}

export function RealAdminDashboard() {
  const { isSignedIn } = useAuthSession()
  const [data, setData] = useState<AdminDashboard | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)

  const load = useCallback(async () => {
    if (!isSignedIn) return
    setLoading(true)
    const result = await adminDashboardService.load()
    setLoading(false)
    if (result.ok) {
      setData(result.data)
      setError(null)
    } else {
      setData(null)
      setError(result.error === 'Forbidden' ? 'This page is limited to admin, superadmin, and finance accounts.' : result.error)
    }
  }, [isSignedIn])

  useEffect(() => {
    void load()
  }, [load])

  return (
    <div className="space-y-8" data-testid="admin-dashboard">
      <PageHeader
        title="Dashboard"
        subtitle="People who joined, and M-Pesa deposits that were actually credited. Pending, failed, and cancelled payments are listed separately and are not part of the total."
        actions={
          isSignedIn ? (
            <Button type="button" variant="secondary" onClick={() => void load()} disabled={loading}>
              {loading ? 'Refreshing…' : 'Refresh'}
            </Button>
          ) : null
        }
      />

      {!isSignedIn ? (
        <Alert tone="mist">Sign in with a staff account to see users and money collected.</Alert>
      ) : null}
      {error ? <Alert tone="danger">{error}</Alert> : null}

      {isSignedIn && loading && !data ? <Skeleton className="h-28" /> : null}

      {data ? (
        <>
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4" data-testid="admin-collected-total">
            <Stat label="Collected (KES)" value={kes(data.totals.collectedKes)} hint="Completed M-Pesa only" tone="live" />
            <Stat label="Collected (USD)" value={data.totals.collectedUsd == null ? '—' : formatMoney(data.totals.collectedUsd)} hint="Completed M-Pesa only" tone="live" />
            <Stat label="Completed deposits" value={String(data.totals.collectedCount)} hint="Credited to wallets" />
            <Stat label="Users" value={String(data.totals.userCount)} hint="Newest first" />
          </div>

          <section className="space-y-3" data-testid="admin-dashboard-users">
            <h2 className="font-display text-lg font-semibold text-paper">Users who joined</h2>
            {data.users.length === 0 ? (
              <p className="text-sm text-mist">No users yet.</p>
            ) : (
              <UserTable rows={data.users} />
            )}
          </section>

          <section className="space-y-3" data-testid="admin-dashboard-collected">
            <h2 className="font-display text-lg font-semibold text-paper">Money collected</h2>
            <p className="text-sm text-mist">
              {data.totals.collectedCount === 0
                ? 'No completed M-Pesa deposits yet. The total above is zero.'
                : `${data.totals.collectedCount} completed deposit${data.totals.collectedCount === 1 ? '' : 's'} · ${kes(data.totals.collectedKes)} · ${data.totals.collectedUsd == null ? '—' : formatMoney(data.totals.collectedUsd)}`}
            </p>
            {data.collected.length === 0 ? (
              <p className="text-sm text-mist">No credited M-Pesa deposits.</p>
            ) : (
              <DepositTable rows={data.collected} timeLabel="Credited" />
            )}
          </section>

          <section className="space-y-3" data-testid="admin-dashboard-other">
            <h2 className="font-display text-lg font-semibold text-paper">Not collected</h2>
            <p className="text-sm text-mist">Pending, failed, and cancelled M-Pesa attempts. These amounts are not in the collected total.</p>
            {data.other.length === 0 ? (
              <p className="text-sm text-mist">No pending, failed, or cancelled M-Pesa deposits.</p>
            ) : (
              <DepositTable rows={data.other} timeLabel="Started" />
            )}
          </section>
        </>
      ) : null}
    </div>
  )
}

function UserTable({ rows }: { rows: DashboardUserRow[] }) {
  return (
    <div className="overflow-x-auto rounded-xl border border-line">
      <table className="w-full min-w-[520px] text-left text-sm">
        <thead className="border-b border-line bg-ink-2/80 text-[11px] font-semibold uppercase tracking-wider text-mist">
          <tr>
            <th className="px-3 py-2 font-semibold">Email</th>
            <th className="px-3 py-2 font-semibold">Signed up</th>
            <th className="px-3 py-2 font-semibold">Role</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => (
            <tr key={row.id} className="border-b border-line/80 last:border-0" data-testid="admin-user-row">
              <td className="px-3 py-2 text-paper">{row.email ?? 'No email on file'}</td>
              <td className="px-3 py-2 text-mist">{when(row.signedUpAt)}</td>
              <td className="px-3 py-2">
                <Badge tone={roleTone(row.role)}>{row.role}</Badge>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

function DepositTable({ rows, timeLabel }: { rows: DashboardDepositRow[]; timeLabel: string }) {
  return (
    <div className="overflow-x-auto rounded-xl border border-line">
      <table className="w-full min-w-[720px] text-left text-sm">
        <thead className="border-b border-line bg-ink-2/80 text-[11px] font-semibold uppercase tracking-wider text-mist">
          <tr>
            <th className="px-3 py-2 font-semibold">Who paid</th>
            <th className="px-3 py-2 font-semibold">KES</th>
            <th className="px-3 py-2 font-semibold">USD</th>
            <th className="px-3 py-2 font-semibold">Status</th>
            <th className="px-3 py-2 font-semibold">Receipt</th>
            <th className="px-3 py-2 font-semibold">{timeLabel}</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => (
            <tr key={row.id} className="border-b border-line/80 last:border-0" data-testid="admin-deposit-row">
              <td className="px-3 py-2 text-paper">{payer(row)}</td>
              <td className="px-3 py-2 font-mono text-paper">{kes(row.amountKes)}</td>
              <td className="px-3 py-2 font-mono text-paper">{row.amountUsd == null ? '—' : formatMoney(row.amountUsd)}</td>
              <td className="px-3 py-2">
                <Badge tone={statusTone(row.status)}>{row.status}</Badge>
                {row.provider ? <p className="mt-1 text-[11px] text-mist">{row.provider}</p> : null}
              </td>
              <td className="px-3 py-2 font-mono text-paper">{row.receipt ?? '—'}</td>
              <td className="px-3 py-2 text-mist">{when(timeLabel === 'Credited' ? row.creditedAt ?? row.createdAt : row.createdAt)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}
