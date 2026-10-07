import { Link, useLocation } from 'react-router-dom'
import { useSystemHealth } from './useSystemHealth'

/** Admin-wide alert while database checks fail or reported issues are open. */
export function SystemIssuesBanner() {
  const { pathname } = useLocation()
  const onSystemPage = pathname.startsWith('/admin/system')
  const { health, error, failingProbes, problemCount } = useSystemHealth(onSystemPage ? 0 : 60_000)

  if (onSystemPage || problemCount === 0) return null

  const open = health?.open.length ?? 0
  const parts = [
    failingProbes.length ? `${failingProbes.length} database check${failingProbes.length === 1 ? '' : 's'} failing` : null,
    open ? `${open} open issue${open === 1 ? '' : 's'}` : null,
    error && !health ? 'System health could not be checked' : null,
  ].filter(Boolean)

  return (
    <div className="border-b border-danger/40 bg-danger/10 px-4 py-2.5" role="alert" data-testid="system-issues-banner">
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-sm">
        <span className="inline-flex items-center gap-2 font-semibold text-paper">
          <span className="h-2 w-2 animate-pulse rounded-full bg-danger" aria-hidden="true" />
          Database issues detected
        </span>
        <span className="text-mist">{parts.join(' · ')}. Users see a neutral “temporarily unavailable” message.</span>
        <Link to="/admin/system" className="ml-auto font-semibold text-danger hover:text-paper">
          View details →
        </Link>
      </div>
    </div>
  )
}
