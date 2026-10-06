import { useState, type FormEvent } from 'react'
import { Link } from 'react-router-dom'
import { Alert, Badge, Button, Card, Input, PageHeader } from '@/components/ui'
import { useAuthSession } from '@/hooks/useAuth'
import { authService } from '@/services/auth'

export function SecurityPage() {
  const { user, isSignedIn } = useAuthSession()
  const [password, setPassword] = useState('')
  const [confirm, setConfirm] = useState('')
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(false)
  const [message, setMessage] = useState<string | null>(null)
  const [ok, setOk] = useState(false)

  async function onSubmit(event: FormEvent) {
    event.preventDefault()
    if (password.length < 8) {
      setError('Password must be at least 8 characters.')
      return
    }
    if (password !== confirm) {
      setError('Passwords do not match.')
      return
    }
    setError('')
    setLoading(true)
    setOk(false)
    const result = await authService.updatePassword(password)
    setMessage(result.message)
    setOk(result.connected)
    setLoading(false)
    if (result.connected) {
      setPassword('')
      setConfirm('')
    }
  }

  return (
    <div>
      <PageHeader title="Security" />
      <div className="grid gap-3 lg:grid-cols-2">
        <Card>
          <h2 className="font-display font-semibold">Password</h2>
          {isSignedIn ? (
            <form className="mt-3 space-y-3" onSubmit={onSubmit} noValidate>
              <Input
                label="New password"
                type="password"
                autoComplete="new-password"
                value={password}
                onChange={(e) => {
                  setPassword(e.target.value)
                  setError('')
                  setMessage(null)
                }}
                error={error || undefined}
              />
              <Input
                label="Confirm password"
                type="password"
                autoComplete="new-password"
                value={confirm}
                onChange={(e) => {
                  setConfirm(e.target.value)
                  setError('')
                  setMessage(null)
                }}
              />
              {message ? <Alert tone={ok ? 'signal' : 'warn'}>{message}</Alert> : null}
              <Button type="submit" disabled={loading}>
                {loading ? 'Updating…' : 'Update password'}
              </Button>
            </form>
          ) : (
            <>
              <p className="mt-2 text-sm text-mist">Sign in to change your password, or request a reset email.</p>
              <div className="mt-3 flex flex-wrap gap-2">
                <Link to="/login">
                  <Button type="button">Log in</Button>
                </Link>
                <Link to="/forgot-password">
                  <Button type="button" variant="secondary">
                    Forgot password
                  </Button>
                </Link>
              </div>
            </>
          )}
        </Card>
        <Card>
          <h2 className="font-display font-semibold">Two-factor</h2>
          <p className="mt-2 text-sm text-mist">Authenticator app sign-in is not available yet.</p>
          <Badge tone="mist" className="mt-3">
            Coming soon
          </Badge>
        </Card>
        <Card className="lg:col-span-2">
          <h2 className="font-display font-semibold">Sessions</h2>
          <p className="mt-2 text-sm text-mist">
            {isSignedIn ? `Signed in as ${user?.email ?? 'this account'} on this browser.` : 'Not signed in.'}
          </p>
        </Card>
      </div>
    </div>
  )
}
