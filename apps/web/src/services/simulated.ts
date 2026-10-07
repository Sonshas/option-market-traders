import type { RealtimeChannel } from '@supabase/supabase-js'
import { getSupabase } from '@/lib/supabase'
import type { PracticeBook } from '@/lib/practice-book'
import type { SimulatedSnapshot, SimulatedTransport } from '@/lib/simulated-balance-sync'
import type { Json } from '@/lib/database.types'

/**
 * Signed-in user's simulated (Demo / Practice) balance rows and effective win rate.
 * All writes go through validated SECURITY DEFINER RPCs; tables are read-only to clients.
 * Virtual money only — never the real wallet.
 */

function asBook(value: unknown): PracticeBook | null {
  return value === 'demo' || value === 'practice' ? value : null
}

export function toSnapshot(raw: Record<string, unknown> | null | undefined): SimulatedSnapshot | null {
  if (!raw) return null
  const book = asBook(raw.book)
  const balance = Number(raw.balance)
  const version = Number(raw.version)
  if (!book || !Number.isFinite(balance) || !Number.isFinite(version)) return null
  return { book, balance, version, updatedBy: typeof raw.updated_by === 'string' ? raw.updated_by : null }
}

export function supabaseSimulatedTransport(): SimulatedTransport | null {
  const client = getSupabase()
  if (!client) return null
  return {
    async apply(change) {
      const { data, error } = await client.rpc('apply_simulated_change', {
        p_book: change.book,
        p_kind: change.kind,
        p_amount: change.amount,
        p_ref: change.ref ?? undefined,
        p_meta: change.meta as Json,
      })
      if (error) throw new Error(error.message)
      const row = Array.isArray(data) ? data[0] : data
      const snapshot = toSnapshot({ ...(row as Record<string, unknown>), updated_by: 'user' })
      if (!snapshot) throw new Error('Unexpected reply.')
      return snapshot
    },
    async fetchAll() {
      const { data, error } = await client.rpc('my_simulated_balances')
      if (error) throw new Error(error.message)
      return (Array.isArray(data) ? data : []).flatMap((row) => {
        const snapshot = toSnapshot(row as Record<string, unknown>)
        return snapshot ? [snapshot] : []
      })
    },
  }
}

export async function fetchMyWinRate(): Promise<number | null> {
  const client = getSupabase()
  if (!client) return null
  const { data, error } = await client.rpc('my_simulated_win_rate')
  if (error || data == null) return null
  const n = Number(data)
  return Number.isFinite(n) ? n : null
}

/** Realtime: own balance rows, own win-rate override, and the global win-rate change signal. */
export function subscribeSimulated(
  userId: string,
  handlers: { onBalance: (snapshot: SimulatedSnapshot) => void; onWinRateChanged: () => void },
): () => void {
  const client = getSupabase()
  if (!client) return () => undefined
  const channel: RealtimeChannel = client
    .channel(`simulated:${userId}`)
    .on(
      'postgres_changes',
      { event: '*', schema: 'public', table: 'simulated_balances', filter: `user_id=eq.${userId}` },
      (payload) => {
        const snapshot = toSnapshot(payload.new as Record<string, unknown>)
        if (snapshot) handlers.onBalance(snapshot)
      },
    )
    .on(
      'postgres_changes',
      { event: '*', schema: 'public', table: 'simulated_win_rate_overrides', filter: `user_id=eq.${userId}` },
      () => handlers.onWinRateChanged(),
    )
    .on('postgres_changes', { event: '*', schema: 'public', table: 'simulation_signals' }, () => handlers.onWinRateChanged())
    .subscribe()
  return () => {
    void client.removeChannel(channel)
  }
}
