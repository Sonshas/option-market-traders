import { useState } from 'react'
import { Alert, Badge, Button, Card, PageHeader, Skeleton } from '@/components/ui'
import { cn } from '@/lib/cn'
import { systemIssuesService, type SystemIssue } from '@/services/system-issues'
import { useSystemHealth } from './useSystemHealth'

function ago(iso: string): string {
  const ms = Date.now() - Date.parse(iso)
  if (!Number.isFinite(ms)) return '—'
  const min = Math.round(ms / 60_000)
  if (min < 1) return 'just now'
  if (min < 60) return `${min} min ago`
  const hours = Math.round(min / 60)
  if (hours < 24) return `${hours} h ago`
  return `${Math.round(hours / 24)} d ago`
}

const SOURCE_LABEL: Record<SystemIssue['source'], string> = {
  web: 'User app',
  edge: 'Server function',
  probe: 'Health check',
}

export function SystemHealthPanel() {
  const { health, error, loading, refresh, failingProbes } = useSystemHealth(30_000)
  const [busy, setBusy] = useState<string | null>(null)
  const [actionError, setActionError] = useState('')

  async function resolve(id?: string) {
    setBusy(id ?? 'all')
    setActionError('')
    const result = await systemIssuesService.resolve(id)
    if (!result.ok) setActionError(result.error)
    await refresh()
    setBusy(null)
  }

  const open = health?.open ?? []
  const healthy = Boolean(health) && failingProbes.length === 0 && open.length === 0

  return (
    <div>
      <PageHeader
        title="System health"
        subtitle="Database checks and backend failures. Users never see these details — they get a neutral “temporarily unavailable” message."
        actions={
          <Button type="button" variant="secondary" size="sm" onClick={() => void refresh()} disabled={loading}>
            Re-check now
          </Button>
        }
      />

      {error ? (
        <Alert tone="danger" title="System health could not be loaded" className="mb-4">
          {error}
        </Alert>
      ) : null}
      {actionError ? (
        <Alert tone="danger" className="mb-4">
          {actionError}
        </Alert>
      ) : null}
      {health && !health.logAvailable ? (
        <Alert tone="danger" title="Issue log unavailable" className="mb-4">
          The system_issues table could not be read. Apply the latest database migration so failures can be recorded.
        </Alert>
      ) : null}

      {loading && !health ? (
        <div className="grid gap-3">
          <Skeleton className="h-20 w-full" />
          <Skeleton className="h-40 w-full" />
        </div>
      ) : null}

      {health ? (
        <>
          <Card
            className={cn(
              'mb-4 flex flex-wrap items-center gap-3',
              healthy ? 'border-call/40' : 'border-danger/50',
            )}
          >
            <span
              className={cn('h-3 w-3 rounded-full', healthy ? 'bg-call' : 'animate-pulse bg-danger')}
              aria-hidden="true"
            />
            <div className="min-w-0 flex-1">
              <p className="font-semibold text-paper">{healthy ? 'All systems operational' : 'Action needed'}</p>
              <p className="text-xs text-mist">
                {failingProbes.length} of {health.probes.length} table checks failing · {open.length} open issue
                {open.length === 1 ? '' : 's'} · checked {ago(health.checkedAt)}
              </p>
            </div>
          </Card>

          <Card className="mb-4">
            <h2 className="font-display font-semibold">Database checks</h2>
            <p className="mt-0.5 text-xs text-mist">Each table the app reads is queried with full server access.</p>
            <ul className="mt-3 grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
              {health.probes.map((probe) => (
                <li
                  key={probe.table}
                  className={cn(
                    'rounded-xl border px-3 py-2.5',
                    probe.ok ? 'border-line bg-surface-2' : 'border-danger/50 bg-danger/10',
                  )}
                >
                  <div className="flex items-center justify-between gap-2">
                    <span className="font-mono text-sm text-paper">{probe.table}</span>
                    <Badge tone={probe.ok ? 'call' : 'danger'}>{probe.ok ? `${probe.ms} ms` : probe.code ?? 'error'}</Badge>
                  </div>
                  {probe.message ? <p className="mt-1 break-words text-xs text-mist">{probe.message}</p> : null}
                </li>
              ))}
            </ul>
          </Card>

          <Card className="mb-4">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div>
                <h2 className="font-display font-semibold">Open issues</h2>
                <p className="mt-0.5 text-xs text-mist">Repeats of the same failure are grouped. Resolve once fixed; it reopens if it happens again.</p>
              </div>
              {open.length > 1 ? (
                <Button type="button" size="sm" variant="secondary" disabled={busy !== null} onClick={() => void resolve()}>
                  Resolve all
                </Button>
              ) : null}
            </div>
            {open.length === 0 ? (
              <p className="mt-4 text-sm text-mist">No open issues.</p>
            ) : (
              <ul className="mt-3 grid gap-2">
                {open.map((issue) => (
                  <IssueRow key={issue.id} issue={issue} busy={busy === issue.id} onResolve={() => void resolve(issue.id)} />
                ))}
              </ul>
            )}
          </Card>

          {health.resolved.length ? (
            <details className="rounded-2xl border border-line bg-surface/80 p-4">
              <summary className="cursor-pointer font-display font-semibold">
                Recently resolved <span className="text-sm font-normal text-mist">({health.resolved.length})</span>
              </summary>
              <ul className="mt-3 grid gap-2">
                {health.resolved.map((issue) => (
                  <IssueRow key={issue.id} issue={issue} />
                ))}
              </ul>
            </details>
          ) : null}
        </>
      ) : null}
    </div>
  )
}

function IssueRow({ issue, busy = false, onResolve }: { issue: SystemIssue; busy?: boolean; onResolve?: () => void }) {
  return (
    <li className={cn('rounded-xl border p-3', issue.resolvedAt ? 'border-line bg-surface-2/60' : 'border-danger/40 bg-danger/5')}>
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <span className="font-semibold text-paper">{issue.area}</span>
            <span className="font-mono text-xs text-mist">{issue.operation}</span>
            {issue.code ? <Badge tone="danger">{issue.code}</Badge> : null}
            <Badge tone="mist">{SOURCE_LABEL[issue.source]}</Badge>
          </div>
          <p className="mt-1 break-words font-mono text-xs text-paper">{issue.message}</p>
          <p className="mt-1 text-[11px] text-mist">
            {issue.occurrences}× · first {ago(issue.firstSeen)} · last {ago(issue.lastSeen)}
            {issue.route ? ` · ${issue.route}` : ''}
            {issue.resolvedAt ? ` · resolved ${ago(issue.resolvedAt)}` : ''}
          </p>
        </div>
        {onResolve ? (
          <Button type="button" size="sm" variant="secondary" disabled={busy} onClick={onResolve}>
            {busy ? 'Resolving…' : 'Resolve'}
          </Button>
        ) : null}
      </div>
    </li>
  )
}
