import type { ReactNode } from 'react'
import { Navigate, useLocation } from 'react-router-dom'
import { Skeleton } from '@/components/ui'
import { useAuthSession } from '@/hooks/useAuth'

/** Gates /app routes behind a Supabase Auth session. */
export function RequireAuth({ children }: { children: ReactNode }) {
  const { isSignedIn, loading } = useAuthSession()
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

  return children
}
