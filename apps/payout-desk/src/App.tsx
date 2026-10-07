import { useCallback, useEffect, useState } from 'react'
import type { Session } from '@supabase/supabase-js'
import { AdminDesk } from './components/AdminDesk'
import { AuthScreen, SetupScreen } from './components/AuthScreen'
import { Banner, Brand, btnQuiet } from './components/chrome'
import { MemberDesk } from './components/MemberDesk'
import type { ActionResult, AdminState, DeskState } from './domain/types'
import { usd } from './format'
import { adminStep, loadAdmin, loadDesk, requestWithdrawal } from './lib/api'
import { supabase, supabaseConfigured } from './lib/supabase'

export function App() {
  const [session, setSession] = useState<Session | null>(null)
  const [ready, setReady] = useState(false)
  const [desk, setDesk] = useState<DeskState | null>(null)
  const [queue, setQueue] = useState<AdminState | null>(null)
  const [view, setView] = useState<'member' | 'admin'>('member')
  const [notice, setNotice] = useState<ActionResult | null>(null)
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    if (!supabase) return
    void supabase.auth.getSession().then(({ data }) => {
      setSession(data.session)
      setReady(true)
    })
    const { data } = supabase.auth.onAuthStateChange((_event, next) => {
      setSession(next)
      setReady(true)
    })
    return () => data.subscription.unsubscribe()
  }, [])

  const refresh = useCallback(async () => {
    if (!session) return
    try {
      const next = await loadDesk()
      setDesk(next)
      setError('')
      if (view === 'admin') {
        if (next.role !== 'admin') {
          setQueue(null)
          return
        }
        setQueue(await loadAdmin())
      }
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'The payout desk could not be opened.')
    }
  }, [session, view])

  useEffect(() => {
    void refresh()
  }, [refresh])

  async function run(action: () => Promise<ActionResult>) {
    setBusy(true)
    try {
      const result = await action()
      setNotice(result)
      await refresh()
    } catch (caught) {
      setNotice({
        ok: false,
        level: 'error',
        operation: 'payout_client',
        message: caught instanceof Error ? caught.message : 'The payout desk could not complete that step.',
      })
    } finally {
      setBusy(false)
    }
  }

  if (!supabaseConfigured) return <SetupScreen />
  if (!ready) {
    return <main className="grid min-h-screen place-items-center text-mist">Opening the payout desk…</main>
  }
  if (!session) return <AuthScreen notice="" />

  return (
    <main className="mx-auto min-h-screen max-w-6xl px-4 py-6 lg:px-8">
      <header className="flex flex-wrap items-center justify-between gap-4">
        <Brand />
        <div className="flex flex-wrap items-center gap-2">
          <button type="button" className={view === 'member' ? btnQuiet : 'px-4 py-2 text-sm text-mist'} onClick={() => setView('member')}>Member</button>
          <button type="button" className={view === 'admin' ? btnQuiet : 'px-4 py-2 text-sm text-mist'} onClick={() => setView('admin')}>Admin</button>
          <button
            type="button"
            className="px-4 py-2 text-sm text-mist"
            onClick={() => {
              void supabase?.auth.signOut()
              setDesk(null)
              setQueue(null)
              setNotice(null)
            }}
          >
            Sign out
          </button>
        </div>
      </header>

      {desk ? (
        <p className="mt-6 font-mono text-sm text-mist">
          Real account <span className="text-paper">{usd(desk.balanceUsd)}</span>
          <span className="mx-2 text-line-strong">·</span>
          M-Pesa only
          <span className="mx-2 text-line-strong">·</span>
          {desk.email}
        </p>
      ) : null}

      <div className="mt-4 grid gap-4">
        {notice ? <Banner tone={notice.level === 'info' ? 'info' : notice.level}>{notice.message}</Banner> : null}
        {error ? <Banner tone="error">{error}</Banner> : null}
        {view === 'admin' ? (
          desk?.role === 'admin' && queue ? (
            <AdminDesk
              queue={queue}
              busy={busy}
              onStep={(step, id) => void run(() => adminStep(step, id))}
            />
          ) : desk?.role === 'admin' ? (
            <p className="text-sm text-mist">Opening the payout queue…</p>
          ) : (
            <Banner tone="warning">{error || 'This account is not an admin.'}</Banner>
          )
        ) : desk ? (
          <MemberDesk
            desk={desk}
            busy={busy}
            onWithdraw={(amount, phone) => void run(() => requestWithdrawal(amount, phone))}
          />
        ) : (
          <p className="text-sm text-mist">Opening the payout desk…</p>
        )}
      </div>
    </main>
  )
}
