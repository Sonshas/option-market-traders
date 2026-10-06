import { useEffect, useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { Alert, Button, Card, Input, PageHeader } from '@/components/ui'
import { displayOrUnavailable } from '@/domain/account'
import { useAuthSession } from '@/hooks/useAuth'
import { useAccountMode } from '@/hooks/useAccountMode'
import { authService, type AuthProfileExtras } from '@/services/auth'

export function ProfilePage() {
  const { user, isSignedIn } = useAuthSession()
  const { mode, setKind } = useAccountMode()
  const navigate = useNavigate()
  const [extras, setExtras] = useState<AuthProfileExtras>({})
  const [message, setMessage] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  useEffect(() => {
    if (!isSignedIn) {
      setExtras({})
      return
    }
    let cancelled = false
    void authService.getProfileExtras().then((next) => {
      if (!cancelled) setExtras(next)
    })
    return () => {
      cancelled = true
    }
  }, [isSignedIn, user?.id])

  async function logout() {
    setBusy(true)
    const result = await authService.signOut()
    setKind('demo')
    setMessage(result.message)
    setBusy(false)
    navigate('/login', { replace: true })
  }

  return (
    <div>
      <PageHeader title="Profile" />
      <Card className="max-w-xl space-y-3">
        <Input
          label="Display name"
          value={displayOrUnavailable(extras.displayName ?? user?.name)}
          readOnly
        />
        <Input label="Email" type="email" value={displayOrUnavailable(user?.email)} readOnly />
        <Input label="Phone" value={displayOrUnavailable(extras.phone)} readOnly />
        <Input label="Country" value={displayOrUnavailable(extras.country)} readOnly />
        <Input label="KYC status" value={displayOrUnavailable(user?.kycStatus?.replace(/_/g, ' '))} readOnly />
        <Input label="Active account mode" value={mode.toUpperCase()} readOnly />
        <Input label="Timezone" value={extras.timezone?.trim() || 'UTC'} readOnly />
        {isSignedIn ? (
          <Button type="button" variant="secondary" disabled={busy} onClick={() => void logout()}>
            {busy ? 'Signing out…' : 'Log out'}
          </Button>
        ) : (
          <div className="flex flex-wrap gap-2">
            <Link to="/login">
              <Button type="button">Log in</Button>
            </Link>
            <Link to="/register">
              <Button type="button" variant="secondary">
                Create account
              </Button>
            </Link>
          </div>
        )}
        {message ? <Alert tone="signal">{message}</Alert> : null}
      </Card>
    </div>
  )
}
