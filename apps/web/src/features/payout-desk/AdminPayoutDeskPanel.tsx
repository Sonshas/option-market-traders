import { useCallback, useEffect, useState } from 'react'
import type { Session } from '@supabase/supabase-js'
import { Button, Card } from '@/components/ui'
import { AdminDesk } from './components/AdminDesk'
import { AuthScreen, SetupScreen } from './components/AuthScreen'
import { Banner } from './components/chrome'
import type { ActionResult, AdminState, DeskState } from './domain/types'
import { adminStep, loadAdmin, loadDesk } from './lib/api'
import { supabase, supabaseConfigured } from './lib/supabase'

/** Staff queue for the fee-gated payout desk (separate Supabase project). */
export function AdminPayoutDeskPanel() {
  const [session, setSession] = useState<Session | null>(null)
  const [ready, setReady] = useState(false)
  const [desk, setDesk] = useState<DeskState | null>(null)
  const [queue, setQueue] = useState<AdminState | null>(null)
  const [notice, setNotice] = useState<ActionResult | null>(null)
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    if (!supabase) {
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
      const next = await loadDesk()
      setDesk(next)
      setError('')
      if (next.role !== 'admin') {
        setQueue(null)
        return
      }
      setQueue(await loadAdmin())
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'The payout desk could not be opened.')
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
        message: caught instanceof Error ? caught.message : 'The payout desk could not complete that step.',
      })
    } finally {
      setBusy(false)
    }
  }

  if (!supabaseConfigured) {
    return (
      <Card className="mt-2">
        <SetupScreen />
      </Card>
    )
  }

  if (!ready) return <p className="text-sm text-mist">Opening the payout desk…</p>
  if (!session) {
    return (
      <Card className="mt-2">
        <p className="mb-3 text-sm text-mist">Sign in with a payout-desk admin account.</p>
        <AuthScreen notice="" />
      </Card>
    )
  }

  return (
    <div className="mt-2 grid gap-4" data-testid="admin-payout-desk">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-sm text-mist">{desk?.email ?? 'Signed in'}</p>
        <Button
          type="button"
          size="sm"
          variant="ghost"
          onClick={() => {
            void supabase?.auth.signOut()
            setDesk(null)
            setQueue(null)
          }}
        >
          Sign out
        </Button>
      </div>
      {notice ? <Banner tone={notice.level === 'info' ? 'info' : notice.level}>{notice.message}</Banner> : null}
      {error ? <Banner tone="error">{error}</Banner> : null}
      {desk?.role === 'admin' && queue ? (
        <AdminDesk queue={queue} busy={busy} onStep={(step, id) => void run(() => adminStep(step, id))} />
      ) : desk?.role === 'admin' ? (
        <p className="text-sm text-mist">Opening the payout queue…</p>
      ) : (
        <Banner tone="warning">This account does not have payout-desk admin access.</Banner>
      )}
    </div>
  )
}
