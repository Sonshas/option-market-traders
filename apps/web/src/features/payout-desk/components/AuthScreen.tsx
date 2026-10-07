import { useState, type FormEvent } from 'react'
import { plainAuthMessage } from '@/lib/auth-link'
import { supabase } from '../lib/supabase'
import { Banner, btn } from './chrome'

/** Shown when withdrawals cannot be opened right now. Never reveals setup or backend details. */
export function SetupScreen() {
  return (
    <section className="py-2" data-testid="payout-unavailable">
      <h3 className="text-base font-semibold">Withdrawals are temporarily unavailable</h3>
      <p className="mt-2 text-sm text-mist">
        We can&apos;t open withdrawals right now. Please try again later or contact support if this continues.
      </p>
    </section>
  )
}

export function AuthScreen({ notice }: { notice: string }) {
  const [mode, setMode] = useState<'sign-in' | 'create'>('sign-in')
  const [fullName, setFullName] = useState('')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [message, setMessage] = useState(notice)
  const [tone, setTone] = useState<'info' | 'warning' | 'error'>('info')
  const [busy, setBusy] = useState(false)

  async function submit(event: FormEvent) {
    event.preventDefault()
    if (!supabase) return
    setBusy(true)
    setMessage('')
    if (mode === 'create') {
      const { error } = await supabase.auth.signUp({
        email: email.trim(),
        password,
        options: { data: { full_name: fullName.trim() } },
      })
      setBusy(false)
      if (error) {
        setTone('error')
        setMessage(plainAuthMessage(error.message))
        return
      }
      setTone('info')
      setMessage('Account created. If email confirmation is on, open the link, then sign in.')
      return
    }
    const { error } = await supabase.auth.signInWithPassword({ email: email.trim(), password })
    setBusy(false)
    if (error) {
      setTone('error')
      setMessage(plainAuthMessage(error.message))
    }
  }

  return (
    <form className="grid" onSubmit={(event) => void submit(event)} data-testid="payout-auth">
      <h3 className="text-base font-semibold">{mode === 'create' ? 'Create your payout account' : 'Sign in to withdraw'}</h3>
      <p className="mt-1 text-xs text-mist">
        {mode === 'create' ? 'One-time setup to receive M-Pesa payouts.' : 'Use your payout account to continue.'}
      </p>
      {mode === 'create' ? (
        <Field id="name" label="Full name" value={fullName} onChange={setFullName} autoComplete="name" />
      ) : null}
      <Field id="email" label="Email" value={email} onChange={setEmail} autoComplete="email" type="email" />
      <Field id="password" label="Password" value={password} onChange={setPassword} autoComplete={mode === 'create' ? 'new-password' : 'current-password'} type="password" />
      {message ? <div className="mt-4"><Banner tone={tone}>{message}</Banner></div> : null}
      <button className={`${btn} mt-5 w-full py-3`} type="submit" disabled={busy}>
        {busy ? 'Please wait…' : mode === 'create' ? 'Create account' : 'Sign in'}
      </button>
      <button
        type="button"
        className="mt-3 text-sm text-signal-soft hover:text-paper"
        onClick={() => {
          setMode(mode === 'create' ? 'sign-in' : 'create')
          setMessage('')
        }}
      >
        {mode === 'create' ? 'Have an account? Sign in' : 'New here? Create an account'}
      </button>
    </form>
  )
}

function Field({
  id,
  label,
  value,
  onChange,
  type = 'text',
  autoComplete,
}: {
  id: string
  label: string
  value: string
  onChange: (value: string) => void
  type?: string
  autoComplete: string
}) {
  return (
    <label className="mt-4 block text-sm font-medium" htmlFor={id}>
      {label}
      <input
        id={id}
        type={type}
        autoComplete={autoComplete}
        required
        className="mt-1.5 w-full rounded-xl border border-line-strong bg-ink-2 px-3 py-3 text-paper outline-none focus:border-signal"
        value={value}
        onChange={(event) => onChange(event.target.value)}
      />
    </label>
  )
}
