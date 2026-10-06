import { Link, Navigate, Outlet, useLocation } from 'react-router-dom'
import { Logo } from '@/components/brand/Logo'
import { Skeleton } from '@/components/ui'
import { useAuthSession } from '@/hooks/useAuth'
import { resolvePostAuthPath } from '@/lib/auth-redirect'

function AuthShell({ allowSignedIn = false }: { allowSignedIn?: boolean }) {
  const { isSignedIn, loading } = useAuthSession()
  const location = useLocation()

  if (loading) {
    return (
      <div className="flex min-h-svh items-center justify-center bg-ink p-6">
        <Skeleton className="h-24 w-full max-w-md" />
      </div>
    )
  }

  if (isSignedIn && !allowSignedIn) {
    return <Navigate to={resolvePostAuthPath(location.search, location.state)} replace />
  }

  return (
    <div className="min-h-svh bg-ink sbb-glow">
      <div className="mx-auto flex min-h-svh max-w-md flex-col justify-center px-4 py-10">
        <div className="mb-6 flex items-center justify-between">
          <Logo />
          <Link to="/" className="text-sm text-mist hover:text-paper">
            Home
          </Link>
        </div>
        <Outlet />
      </div>
    </div>
  )
}

export function AuthLayout() {
  return <AuthShell />
}

/** Confirmation and password-reset links may create a session before the form is submitted. */
export function AuthCallbackLayout() {
  return <AuthShell allowSignedIn />
}
