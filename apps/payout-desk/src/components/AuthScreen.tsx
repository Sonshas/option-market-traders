import { useState, type FormEvent } from 'react'
import { supabase } from '../lib/supabase'
import { Banner, Brand, btn } from './chrome'

export function SetupScreen() {
  return (
    <main className="mx-auto grid min-h-screen max-w-6xl content-center gap-8 px-4 py-10 lg:grid-cols-2 lg:px-8">
      <section>
        <Brand />
        <h1 className="mt-8 max-w-xl text-4xl font-semibold tracking-tight">M-Pesa payouts, no fees.</h1>
        <p className="mt-4 max-w-xl text-mist">Supabase holds the wallet balance. Withdrawals go straight to the payout queue.</p>
        <ol className="mt-6 grid max-w-xl gap-3 text-sm text-mist">
          <li>Create a Supabase project.</li>
          <li>
            Run the migration in the SQL editor.
            <span className="mt-1 block break-all font-mono text-xs text-paper">supabase/migrations/20261004140000_payout_desk.sql</span>
          </li>
          <li>
            Put the project URL and anon key in <span className="font-mono text-paper">.env.local</span>.
          </li>
          <li>Restart the dev server.</li>
        </ol>
      </section>
    </main>
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
        setMessage(error.message)
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
      setMessage(error.message)
    }
  }

  return (
    <main className="mx-auto grid min-h-screen max-w-6xl items-center gap-10 px-4 py-8 lg:grid-cols-2 lg:px-8">
      <section>
        <Brand />
        <h1 className="mt-8 text-4xl font-semibold tracking-tight">Withdraw to M-Pesa. No fees.</h1>
        <p className="mt-4 max-w-xl text-mist">A withdrawal debits the wallet immediately and goes to the payout queue. The full amount is paid out.</p>
      </section>
      <form className="rounded-3xl border border-line bg-surface p-5" onSubmit={(event) => void submit(event)}>
        <h2 className="text-lg font-semibold">{mode === 'create' ? 'Create account' : 'Sign in'}</h2>
        {mode === 'create' ? (
          <Field id="name" label="Full name" value={fullName} onChange={setFullName} autoComplete="name" />
        ) : null}
        <Field id="email" label="Email" value={email} onChange={setEmail} autoComplete="email" type="email" />
        <Field id="password" label="Password" value={password} onChange={setPassword} autoComplete={mode === 'create' ? 'new-password' : 'current-password'} type="password" />
        {message ? <div className="mt-4"><Banner tone={tone}>{message}</Banner></div> : null}
        <button className={`${btn} mt-4 w-full`} type="submit" disabled={busy}>
          {mode === 'create' ? 'Create account' : 'Sign in'}
        </button>
        <button
          type="button"
          className="mt-3 text-sm text-signal-soft"
          onClick={() => {
            setMode(mode === 'create' ? 'sign-in' : 'create')
            setMessage('')
          }}
        >
          {mode === 'create' ? 'Have an account? Sign in' : 'New here? Create an account'}
        </button>
      </form>
    </main>
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
        className="mt-2 w-full rounded-2xl border border-line-strong bg-ink-2 px-3 py-3 text-paper outline-none"
        value={value}
        onChange={(event) => onChange(event.target.value)}
      />
    </label>
  )
}
