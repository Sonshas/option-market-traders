import { useEffect, useState, type FormEvent } from 'react'
import { Link, useLocation, useNavigate } from 'react-router-dom'
import { Alert, Button, Card, Input } from '@/components/ui'
import { useAccountMode } from '@/hooks/useAccountMode'
import { useAuthSession } from '@/hooks/useAuth'
import { NO_EMAIL_LINK_MESSAGE } from '@/lib/auth-link'
import { TRADE_ROUTE, resolvePostAuthPath } from '@/lib/auth-redirect'
import { authService } from '@/services/auth'
import { isValidEmail } from '@/lib/format'

const COUNTRIES = [
  'Australia',
  'Canada',
  'Germany',
  'India',
  'Kenya',
  'Nigeria',
  'South Africa',
  'United Kingdom',
  'United States',
  'Other',
]

export function LoginForm() {
  const navigate = useNavigate()
  const location = useLocation()
  const { setKind } = useAccountMode()
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [errors, setErrors] = useState<Record<string, string>>({})
  const [loading, setLoading] = useState(false)
  const [message, setMessage] = useState<string | null>(null)
  const [ok, setOk] = useState(false)

  async function onSubmit(event: FormEvent) {
    event.preventDefault()
    const next: Record<string, string> = {}
    if (!isValidEmail(email)) next.email = 'Enter a valid email.'
    if (password.length < 8) next.password = 'Password must be at least 8 characters.'
    setErrors(next)
    if (Object.keys(next).length) return
    setLoading(true)
    setOk(false)
    setMessage(null)
    const result = await authService.signIn({ email, password })
    setMessage(result.message)
    setOk(result.connected && Boolean(result.data))
    setLoading(false)
    if (result.connected && result.data) {
      setKind('demo')
      navigate(resolvePostAuthPath(location.search, location.state), { replace: true })
    }
  }

  return (
    <Card>
      <h1 className="font-display text-2xl font-semibold">Log in</h1>
      <p className="mt-1 text-sm text-mist">Welcome back. Sign in to open your DEMO and REAL workspaces.</p>
      <form className="mt-5 space-y-3" onSubmit={onSubmit} noValidate>
        <Input
          label="Email"
          type="email"
          autoComplete="email"
          value={email}
          onChange={(e) => {
            setEmail(e.target.value)
            setErrors((prev) => ({ ...prev, email: '' }))
            setMessage(null)
          }}
          error={errors.email}
        />
        <Input
          label="Password"
          type="password"
          autoComplete="current-password"
          value={password}
          onChange={(e) => {
            setPassword(e.target.value)
            setErrors((prev) => ({ ...prev, password: '' }))
            setMessage(null)
          }}
          error={errors.password}
        />
        <div className="flex justify-between text-sm">
          <Link to="/forgot-password" className="text-signal hover:underline">
            Forgot password
          </Link>
          <Link to="/two-factor" className="text-mist hover:text-paper">
            2FA screen
          </Link>
        </div>
        {message ? <Alert tone={ok ? 'signal' : 'warn'}>{message}</Alert> : null}
        <Button type="submit" className="w-full" disabled={loading}>
          {loading ? 'Signing in…' : 'Log in'}
        </Button>
      </form>
      <p className="mt-4 text-sm text-mist">
        No account?{' '}
        <Link to="/register" className="text-signal hover:underline">
          Create account
        </Link>
      </p>
    </Card>
  )
}

export function SignupForm() {
  const navigate = useNavigate()
  const { setKind } = useAccountMode()
  const [name, setName] = useState('')
  const [email, setEmail] = useState('')
  const [phone, setPhone] = useState('')
  const [country, setCountry] = useState('United States')
  const [password, setPassword] = useState('')
  const [confirm, setConfirm] = useState('')
  const [accepted, setAccepted] = useState(false)
  const [errors, setErrors] = useState<Record<string, string>>({})
  const [loading, setLoading] = useState(false)
  const [message, setMessage] = useState<string | null>(null)
  const [ok, setOk] = useState(false)

  async function onSubmit(event: FormEvent) {
    event.preventDefault()
    const next: Record<string, string> = {}
    if (name.trim().length < 2) next.name = 'Enter your display name.'
    if (!isValidEmail(email)) next.email = 'Enter a valid email.'
    if (phone.trim().length < 6) next.phone = 'Enter a phone number.'
    if (!country.trim()) next.country = 'Select a country.'
    if (password.length < 8) next.password = 'Use at least 8 characters.'
    if (confirm !== password) next.confirm = 'Passwords do not match.'
    if (!accepted) next.terms = 'Accept Terms and Privacy to continue.'
    setErrors(next)
    if (Object.keys(next).length) return
    setLoading(true)
    setOk(false)
    setMessage(null)
    const result = await authService.signUp({ name, email, password, phone, country })
    setMessage(result.message)
    setOk(result.connected && Boolean(result.data))
    setLoading(false)
    if (result.connected && result.data) {
      setKind('demo')
      navigate(TRADE_ROUTE, { replace: true })
      return
    }
    if (!result.connected && result.message.toLowerCase().includes('verify')) {
      navigate('/verify-email', { replace: true, state: { email } })
    }
  }

  return (
    <Card>
      <h1 className="font-display text-2xl font-semibold">Create account</h1>
      <p className="mt-1 text-sm text-mist">
        Get a DEMO account with virtual funds to practice, plus a REAL account.
      </p>
      <form className="mt-5 space-y-3" onSubmit={onSubmit} noValidate>
        <Input
          label="Full name"
          value={name}
          onChange={(e) => {
            setName(e.target.value)
            setErrors((prev) => ({ ...prev, name: '' }))
            setMessage(null)
          }}
          error={errors.name}
        />
        <Input
          label="Email"
          type="email"
          autoComplete="email"
          value={email}
          onChange={(e) => {
            setEmail(e.target.value)
            setErrors((prev) => ({ ...prev, email: '' }))
            setMessage(null)
          }}
          error={errors.email}
        />
        <Input
          label="Phone"
          type="tel"
          autoComplete="tel"
          value={phone}
          onChange={(e) => {
            setPhone(e.target.value)
            setErrors((prev) => ({ ...prev, phone: '' }))
            setMessage(null)
          }}
          error={errors.phone}
        />
        <label className="block space-y-1.5">
          <span className="text-sm font-medium text-paper">Country</span>
          <select
            className="h-11 w-full rounded-xl border border-line bg-ink-2 px-3 text-sm text-paper"
            value={country}
            onChange={(e) => {
              setCountry(e.target.value)
              setErrors((prev) => ({ ...prev, country: '' }))
              setMessage(null)
            }}
          >
            {COUNTRIES.map((item) => (
              <option key={item} value={item}>
                {item}
              </option>
            ))}
          </select>
          {errors.country ? <span className="text-xs text-put">{errors.country}</span> : null}
        </label>
        <Input
          label="Password"
          type="password"
          autoComplete="new-password"
          value={password}
          onChange={(e) => {
            setPassword(e.target.value)
            setErrors((prev) => ({ ...prev, password: '' }))
            setMessage(null)
          }}
          error={errors.password}
        />
        <Input
          label="Confirm password"
          type="password"
          autoComplete="new-password"
          value={confirm}
          onChange={(e) => {
            setConfirm(e.target.value)
            setErrors((prev) => ({ ...prev, confirm: '' }))
            setMessage(null)
          }}
          error={errors.confirm}
        />
        <label className="flex items-start gap-2 text-sm text-mist">
          <input
            type="checkbox"
            className="mt-1"
            checked={accepted}
            onChange={(e) => {
              setAccepted(e.target.checked)
              setErrors((prev) => ({ ...prev, terms: '' }))
              setMessage(null)
            }}
          />
          <span>
            I agree to the{' '}
            <Link to="/legal/terms" className="text-signal hover:underline">
              Terms
            </Link>{' '}
            and{' '}
            <Link to="/legal/privacy" className="text-signal hover:underline">
              Privacy
            </Link>{' '}
            notices.
          </span>
        </label>
        {errors.terms ? <p className="text-xs text-put">{errors.terms}</p> : null}
        {message ? <Alert tone={ok ? 'signal' : 'warn'}>{message}</Alert> : null}
        <Button type="submit" className="w-full" disabled={loading}>
          {loading ? 'Creating account…' : 'Create account'}
        </Button>
      </form>
      <p className="mt-4 text-sm text-mist">
        Already have an account?{' '}
        <Link to="/login" className="text-signal hover:underline">
          Log in
        </Link>
      </p>
    </Card>
  )
}

export function ForgotPasswordForm() {
  const [email, setEmail] = useState('')
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(false)
  const [message, setMessage] = useState<string | null>(null)
  const [ok, setOk] = useState(false)

  async function onSubmit(event: FormEvent) {
    event.preventDefault()
    if (!isValidEmail(email)) {
      setError('Enter a valid email.')
      return
    }
    setError('')
    setLoading(true)
    setOk(false)
    setMessage(null)
    const result = await authService.requestPasswordReset(email)
    setMessage(result.message)
    setOk(result.connected)
    setLoading(false)
  }

  return (
    <Card>
      <h1 className="font-display text-2xl font-semibold">Reset password</h1>
      <p className="mt-1 text-sm text-mist">
        We'll email you a reset link. Open it on this site to choose a new password.
      </p>
      <form className="mt-5 space-y-3" onSubmit={onSubmit} noValidate>
        <Input
          label="Email"
          type="email"
          value={email}
          onChange={(e) => {
            setEmail(e.target.value)
            setError('')
            setMessage(null)
          }}
          error={error}
        />
        {message ? <Alert tone={ok ? 'signal' : 'warn'}>{message}</Alert> : null}
        <Button type="submit" className="w-full" disabled={loading}>
          {loading ? 'Sending…' : 'Send reset link'}
        </Button>
      </form>
      <Link to="/login" className="mt-4 inline-block text-sm text-signal hover:underline">
        Back to login
      </Link>
      <p className="mt-3 text-sm text-mist">
        Need an account?{' '}
        <Link to="/register" className="text-signal hover:underline">
          Create account
        </Link>
      </p>
    </Card>
  )
}

export function ResetPasswordForm() {
  const location = useLocation()
  const { isSignedIn, loading: sessionLoading } = useAuthSession()
  const recoveryReady =
    Boolean(location.state) &&
    typeof location.state === 'object' &&
    'recoveryReady' in location.state &&
    Boolean((location.state as { recoveryReady?: boolean }).recoveryReady)
  const [password, setPassword] = useState('')
  const [confirm, setConfirm] = useState('')
  const [error, setError] = useState('')
  const [phase, setPhase] = useState<'checking' | 'ready' | 'missing' | 'done'>('checking')
  const [notice, setNotice] = useState<string | null>(null)
  const [noticeOk, setNoticeOk] = useState(false)
  const [saving, setSaving] = useState(false)

  useEffect(() => {
    let cancelled = false
    void authService.consumeEmailLink().then((result) => {
      if (cancelled) return
      if (result.message === NO_EMAIL_LINK_MESSAGE) {
        setPhase(recoveryReady ? 'ready' : 'missing')
        return
      }
      if (!result.connected || !result.data) {
        setNotice(result.message)
        setNoticeOk(false)
        setPhase('missing')
        return
      }
      if (result.data.purpose === 'recovery' || result.data.hasSession) {
        setNotice(null)
        setPhase('ready')
        return
      }
      setNotice(result.message)
      setNoticeOk(true)
      setPhase('missing')
    })
    return () => {
      cancelled = true
    }
  }, [recoveryReady])

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
    setSaving(true)
    setNotice(null)
    const result = await authService.updatePassword(password)
    setNotice(result.message)
    setNoticeOk(result.connected)
    setSaving(false)
    if (result.connected) {
      setPassword('')
      setConfirm('')
      setPhase('done')
    }
  }

  const showForm = phase === 'ready' || (phase === 'missing' && !notice && !sessionLoading && isSignedIn)

  return (
    <Card>
      <h1 className="font-display text-2xl font-semibold">Choose a new password</h1>
      <p className="mt-1 text-sm text-mist">Use at least 8 characters. This replaces the password on your account.</p>
      {phase === 'checking' || (phase === 'missing' && !notice && sessionLoading) ? (
        <p className="mt-5 text-sm text-mist">Checking your reset link…</p>
      ) : null}
      {notice ? <Alert tone={noticeOk ? 'signal' : 'warn'} className="mt-5">{notice}</Alert> : null}
      {showForm ? (
        <form className="mt-5 space-y-3" onSubmit={onSubmit} noValidate>
          <Input
            label="New password"
            type="password"
            autoComplete="new-password"
            value={password}
            onChange={(e) => {
              setPassword(e.target.value)
              setError('')
              setNotice(null)
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
              setNotice(null)
            }}
          />
          <Button type="submit" className="w-full" disabled={saving}>
            {saving ? 'Saving…' : 'Save new password'}
          </Button>
        </form>
      ) : null}
      {phase === 'done' ? (
        <div className="mt-5">
          <Link to={TRADE_ROUTE}>
            <Button type="button" className="w-full">
              Continue
            </Button>
          </Link>
        </div>
      ) : null}
      {phase === 'missing' && !showForm ? (
        <div className="mt-5 space-y-3">
          {notice ? null : (
            <p className="text-sm text-mist">This reset link is missing or has expired. Request a new one.</p>
          )}
          <Link to="/forgot-password" className="block">
            <Button type="button" className="w-full">
              Request a new link
            </Button>
          </Link>
        </div>
      ) : null}
      <Link to="/login" className="mt-4 inline-block text-sm text-signal hover:underline">
        Back to login
      </Link>
    </Card>
  )
}

export function ConfirmEmailPanel() {
  const navigate = useNavigate()
  const [message, setMessage] = useState<string | null>(null)
  const [ok, setOk] = useState(false)
  const [checking, setChecking] = useState(true)
  const [hasSession, setHasSession] = useState(false)

  useEffect(() => {
    let cancelled = false
    void authService.consumeEmailLink().then((result) => {
      if (cancelled) return
      if (result.data?.purpose === 'recovery') {
        navigate('/reset-password', { replace: true, state: { recoveryReady: true } })
        return
      }
      setChecking(false)
      if (result.message === NO_EMAIL_LINK_MESSAGE) {
        setOk(false)
        setMessage('Open the confirmation link from your email.')
        return
      }
      setMessage(result.message)
      setOk(result.connected)
      setHasSession(Boolean(result.data?.hasSession))
    })
    return () => {
      cancelled = true
    }
  }, [navigate])

  return (
    <Card>
      <h1 className="font-display text-2xl font-semibold">Confirm email</h1>
      <p className="mt-1 text-sm text-mist">
        This page finishes email confirmation and password recovery links.
      </p>
      {checking ? <p className="mt-5 text-sm text-mist">Checking your link…</p> : null}
      {message ? <Alert tone={ok ? 'signal' : 'warn'} className="mt-5">{message}</Alert> : null}
      {!checking ? (
        <div className="mt-5 space-y-3">
          {ok && hasSession ? (
            <Link to={TRADE_ROUTE} className="block">
              <Button type="button" className="w-full">
                Continue
              </Button>
            </Link>
          ) : (
            <Link to="/login" className="block">
              <Button type="button" className="w-full">
                Log in
              </Button>
            </Link>
          )}
          {!ok ? (
            <Link to="/verify-email" className="block text-center text-sm text-signal hover:underline">
              Resend confirmation email
            </Link>
          ) : null}
        </div>
      ) : null}
    </Card>
  )
}

export function VerifyEmailPanel() {
  const location = useLocation()
  const stateEmail =
    location.state && typeof location.state === 'object' && 'email' in location.state
      ? String((location.state as { email?: string }).email ?? '')
      : ''
  const [email, setEmail] = useState(stateEmail)
  const [loading, setLoading] = useState(false)
  const [message, setMessage] = useState<string | null>(null)
  const [ok, setOk] = useState(false)

  useEffect(() => {
    if (stateEmail) setEmail(stateEmail)
  }, [stateEmail])

  async function resend() {
    setLoading(true)
    setOk(false)
    setMessage(null)
    const result = await authService.resendVerification(email)
    setMessage(result.message)
    setOk(result.connected)
    setLoading(false)
  }

  return (
    <Card>
      <h1 className="font-display text-2xl font-semibold">Verify email</h1>
      <p className="mt-1 text-sm text-mist">
        If email confirmation is enabled on the project, confirm the link in your inbox, then log in.
      </p>
      <div className="mt-5 space-y-3">
        <Input
          label="Email to verify"
          type="email"
          value={email}
          onChange={(e) => {
            setEmail(e.target.value)
            setMessage(null)
          }}
        />
        {message ? <Alert tone={ok ? 'signal' : 'warn'}>{message}</Alert> : null}
        <Button type="button" className="w-full" onClick={() => void resend()} disabled={loading}>
          {loading ? 'Sending…' : 'Resend verification'}
        </Button>
        <Link to="/login" className="block text-center text-sm text-signal hover:underline">
          Return to login
        </Link>
      </div>
    </Card>
  )
}

export function TwoFactorForm() {
  const [code, setCode] = useState('')
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(false)
  const [message, setMessage] = useState<string | null>(null)

  async function onSubmit(event: FormEvent) {
    event.preventDefault()
    if (!/^\d{6}$/.test(code)) {
      setError('Enter the 6-digit code.')
      return
    }
    setError('')
    setLoading(true)
    setMessage(null)
    const result = await authService.verifyTwoFactor(code)
    setMessage(result.message)
    setLoading(false)
  }

  return (
    <Card>
      <h1 className="font-display text-2xl font-semibold">Two-factor</h1>
      <p className="mt-1 text-sm text-mist">2FA-ready screen. Project TOTP is not enabled yet.</p>
      <form className="mt-5 space-y-3" onSubmit={onSubmit} noValidate>
        <Input
          label="Authenticator code"
          inputMode="numeric"
          maxLength={6}
          value={code}
          onChange={(e) => {
            setCode(e.target.value.replace(/\D/g, ''))
            setError('')
            setMessage(null)
          }}
          error={error}
          hint="Six digits from your authenticator app, once TOTP is enabled."
        />
        {message ? <Alert tone="warn">{message}</Alert> : null}
        <Button type="submit" className="w-full" disabled={loading}>
          {loading ? 'Checking…' : 'Verify code'}
        </Button>
      </form>
    </Card>
  )
}
