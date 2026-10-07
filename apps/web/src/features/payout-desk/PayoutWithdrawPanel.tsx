import { useCallback, useEffect, useState, type ReactNode } from 'react'
import type { Session } from '@supabase/supabase-js'
import { Skeleton } from '@/components/ui'
import { cn } from '@/lib/cn'
import { reportBackendIssue } from '@/services/system-issues'
import { AuthScreen, SetupScreen } from './components/AuthScreen'
import { Banner } from './components/chrome'
import { MemberDesk } from './components/MemberDesk'
import type { ActionResult, DeskState } from './domain/types'
import { loadDesk, requestWithdrawal } from './lib/api'
import { supabase, supabaseConfigured } from './lib/supabase'

/** REAL-account M-Pesa withdrawal. No fees. */
export function PayoutWithdrawPanel({ onClose, className }: { onClose: () => void; className?: string }) {
  const [session, setSession] = useState<Session | null>(null)
  const [ready, setReady] = useState(false)
  const [desk, setDesk] = useState<DeskState | null>(null)
  const [notice, setNotice] = useState<ActionResult | null>(null)
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    if (!supabase) {
      reportBackendIssue('payout_desk', 'config', 'Withdraw opened but the payout desk is not configured in this build')
      setReady(true)
      return
    }
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
      setDesk(await loadDesk())
      setError('')
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Withdrawals could not be opened.')
    }
  }, [session])

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
        message: caught instanceof Error ? caught.message : 'That step could not be completed. Please try again.',
      })
    } finally {
      setBusy(false)
    }
  }

  function signOut() {
    void supabase?.auth.signOut()
    setDesk(null)
    setNotice(null)
  }

  let body: ReactNode
  if (!supabaseConfigured) {
    body = <SetupScreen />
  } else if (!ready || (session && !desk && !error)) {
    body = (
      <div className="grid gap-3" aria-busy="true">
        <Skeleton className="h-16 w-full" />
        <Skeleton className="h-12 w-full" />
        <Skeleton className="h-12 w-full" />
      </div>
    )
  } else if (!session) {
    body = <AuthScreen notice="" />
  } else {
    body = (
      <div className="grid gap-3">
        {notice ? <Banner tone={notice.level === 'info' ? 'info' : notice.level}>{notice.message}</Banner> : null}
        {error ? <Banner tone="error">{error}</Banner> : null}
        {desk ? (
          <MemberDesk
            desk={desk}
            busy={busy}
            onWithdraw={(amount, phone) => void run(() => requestWithdrawal(amount, phone))}
          />
        ) : null}
      </div>
    )
  }

  return (
    <div
      className={cn(
        'overflow-hidden rounded-2xl border border-line bg-surface text-paper',
        className ?? 'mt-4',
      )}
      data-testid="payout-withdraw-panel"
    >
      <header className="flex items-center gap-3 border-b border-line bg-ink-2/60 px-4 py-3.5 sm:px-5">
        <span className="grid h-9 w-9 shrink-0 place-items-center rounded-xl bg-live/15 text-live" aria-hidden="true">
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <path d="M3 7h15a3 3 0 0 1 3 3v7a3 3 0 0 1-3 3H6a3 3 0 0 1-3-3V7Z" />
            <path d="M3 7V6a2 2 0 0 1 2-2h11" />
            <circle cx="16.5" cy="13.5" r="1.25" fill="currentColor" />
          </svg>
        </span>
        <div className="min-w-0 flex-1">
          <h2 className="font-display text-base font-semibold leading-tight">Withdraw</h2>
          <p className="text-xs text-mist">REAL account · M-Pesa</p>
        </div>
        <button
          type="button"
          onClick={onClose}
          aria-label="Close"
          className="grid h-9 w-9 place-items-center rounded-lg text-mist transition-colors hover:bg-surface-2 hover:text-paper focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-mist"
        >
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden="true">
            <path d="M6 6l12 12M18 6L6 18" />
          </svg>
        </button>
      </header>

      <div className="p-4 sm:p-5">{body}</div>

      {session && supabaseConfigured ? (
        <footer className="flex items-center justify-between border-t border-line px-4 py-2.5 text-xs text-mist sm:px-5">
          <span>Payouts are sent to M-Pesa after approval.</span>
          <button type="button" className="font-medium hover:text-paper" onClick={signOut}>
            Sign out
          </button>
        </footer>
      ) : null}
    </div>
  )
}
