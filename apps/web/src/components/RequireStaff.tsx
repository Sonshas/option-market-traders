import type { ReactNode } from 'react'
import { Navigate, useLocation } from 'react-router-dom'
import { Skeleton } from '@/components/ui'
import { useAuthSession } from '@/hooks/useAuth'
import { TRADE_ROUTE } from '@/lib/auth-redirect'

export const STAFF_ROLES: ReadonlySet<string> = new Set(['admin', 'support', 'finance', 'compliance', 'superadmin'])

/** Gates /admin routes to staff. Server functions still enforce roles on every call. */
export function RequireStaff({ children }: { children: ReactNode }) {
  const { user, isSignedIn, loading } = useAuthSession()
  const location = useLocation()

  if (loading) {
    return (
      <div className="flex min-h-svh items-center justify-center bg-ink p-6">
        <Skeleton className="h-24 w-full max-w-md" />
      </div>
    )
  }

  if (!isSignedIn) {
    return <Navigate to="/login" replace state={{ from: `${location.pathname}${location.search}` }} />
  }

  if (!user || !STAFF_ROLES.has(user.role)) {
    return <Navigate to={TRADE_ROUTE} replace />
  }

  return children
}
