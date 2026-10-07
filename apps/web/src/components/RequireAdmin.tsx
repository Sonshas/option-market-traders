import { createContext, useContext, type ReactNode } from 'react'
import { Navigate, useLocation } from 'react-router-dom'
import { Alert, Card, Skeleton } from '@/components/ui'
import { useAdminAccess } from '@/hooks/useAdminAccess'
import { useAuthSession } from '@/hooks/useAuth'
import { TRADE_ROUTE } from '@/lib/auth-redirect'
import type { AdminAccessLevel } from '@/services/admin-panel'

export type AdminGuardDecision = 'loading' | 'login' | 'deny' | 'allow'

/** Pure /admin gate. Only a level returned by the server grants access; the client role or email never does. */
export function adminGuardDecision(input: {
  authLoading: boolean
  isSignedIn: boolean
  accessLoading: boolean
  level: AdminAccessLevel | null
}): AdminGuardDecision {
  if (input.authLoading) return 'loading'
  if (!input.isSignedIn) return 'login'
  if (input.accessLoading) return 'loading'
  return input.level === 'superadmin' || input.level === 'staff' ? 'allow' : 'deny'
}

const AdminAccessContext = createContext<AdminAccessLevel>('none')

export function useAdminAccessLevel(): AdminAccessLevel {
  return useContext(AdminAccessContext)
}

/**
 * Gates every /admin route. Children (and therefore every admin data request) render only after
 * the server confirmed access. The server re-checks on each admin read and write regardless.
 */
export function RequireAdmin({ children }: { children: ReactNode }) {
  const { user, isSignedIn, loading } = useAuthSession()
  const location = useLocation()
  const access = useAdminAccess(!loading && isSignedIn, user?.id ?? null)
  const decision = adminGuardDecision({ authLoading: loading, isSignedIn, accessLoading: access.loading, level: access.level })

  if (decision === 'loading') {
    return (
      <div className="flex min-h-svh items-center justify-center bg-ink p-6" data-testid="admin-guard-loading">
        <Skeleton className="h-24 w-full max-w-md" />
      </div>
    )
  }
  if (decision === 'login') {
    return <Navigate to="/login" replace state={{ from: `${location.pathname}${location.search}` }} />
  }
  if (decision === 'deny') {
    return <Navigate to={TRADE_ROUTE} replace state={{ adminDenied: true }} />
  }
  return <AdminAccessContext.Provider value={access.level ?? 'none'}>{children}</AdminAccessContext.Provider>
}

/** Superadmin-only pages inside /admin. Staff see a 403 card and no data is requested. */
export function RequireSuperadmin({ children }: { children: ReactNode }) {
  const level = useAdminAccessLevel()
  if (level !== 'superadmin') {
    return (
      <Card data-testid="admin-forbidden">
        <p className="font-display text-lg font-semibold text-paper">403 — Superadmin only</p>
        <Alert className="mt-3" tone="danger">
          This section is limited to the superadmin account. Your staff role can still use the other admin pages.
        </Alert>
      </Card>
    )
  }
  return children
}
