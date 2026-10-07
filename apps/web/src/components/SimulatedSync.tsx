import { useEffect } from 'react'
import { useAuthSession } from '@/hooks/useAuth'
import { e2eAuthBypassEnabled } from '@/services/auth'
import {
  receiveSimulatedSnapshot,
  refreshSimulatedBalances,
  startSimulatedSync,
  stopSimulatedSync,
} from '@/lib/simulated-balance-sync'
import { resetSimulatedWinRate, setSimulatedWinRate } from '@/lib/sim-win-rate'
import { fetchMyWinRate, subscribeSimulated, supabaseSimulatedTransport } from '@/services/simulated'

/** While signed in, mirrors the server Demo / Practice balances and win rate into the local engine. */
export function SimulatedSync() {
  const { user } = useAuthSession()
  const userId = user?.id ?? null

  useEffect(() => {
    if (!userId || e2eAuthBypassEnabled) return
    const transport = supabaseSimulatedTransport()
    if (!transport) return
    let cancelled = false
    const loadRate = () =>
      void fetchMyWinRate().then((rate) => {
        if (!cancelled && rate != null) setSimulatedWinRate(rate)
      })
    void startSimulatedSync(transport)
    loadRate()
    const unsubscribe = subscribeSimulated(userId, {
      onBalance: (snapshot) => receiveSimulatedSnapshot(snapshot),
      onWinRateChanged: loadRate,
    })
    const onWake = () => {
      if (document.visibilityState !== 'visible') return
      void refreshSimulatedBalances()
      loadRate()
    }
    document.addEventListener('visibilitychange', onWake)
    window.addEventListener('online', onWake)
    return () => {
      cancelled = true
      unsubscribe()
      document.removeEventListener('visibilitychange', onWake)
      window.removeEventListener('online', onWake)
      stopSimulatedSync()
      resetSimulatedWinRate()
    }
  }, [userId])

  return null
}
