import { applyServerAvailableBalance } from '@/lib/demo-store'
import { getPracticeBook, type PracticeBook } from '@/lib/practice-book'

/**
 * Keeps the signed-in user's Demo / Practice available balances in step with the server rows
 * (public.simulated_balances). Trade maths stays local; each balance change is sent to the server
 * in order, and server snapshots (RPC replies, Realtime events, refetches) overwrite the local value.
 * Signed out there is no transport and everything stays in localStorage.
 *
 * These balances are virtual. Nothing here touches the real wallet or the payout flow.
 */

export type SimulatedChangeKind = 'stake' | 'settle' | 'topup' | 'withdraw'

export interface SimulatedSnapshot {
  book: PracticeBook
  balance: number
  version: number
  updatedBy?: string | null
}

export interface SimulatedChange {
  book: PracticeBook
  kind: SimulatedChangeKind
  amount: number
  ref: string | null
  meta: Record<string, unknown>
}

export interface SimulatedTransport {
  /** Resolves with the server snapshot after the change, or rejects when the server refused it. */
  apply(change: SimulatedChange): Promise<SimulatedSnapshot>
  fetchAll(): Promise<SimulatedSnapshot[]>
}

let transport: SimulatedTransport | null = null
let generation = 0
let queue: Promise<void> = Promise.resolve()
const knownVersion = new Map<PracticeBook, number>()
const pending = new Map<PracticeBook, number>()
const deferred = new Map<PracticeBook, SimulatedSnapshot>()

function resetState(): void {
  generation += 1
  queue = Promise.resolve()
  knownVersion.clear()
  pending.clear()
  deferred.clear()
}

export function startSimulatedSync(next: SimulatedTransport): Promise<void> {
  resetState()
  transport = next
  return refreshSimulatedBalances()
}

export function stopSimulatedSync(): void {
  resetState()
  transport = null
}

export function isSimulatedSyncActive(): boolean {
  return transport != null
}

/**
 * Applies a server snapshot when it is newer than anything seen for that book. While local changes
 * are still in flight, the user's own echoes are held back (no flicker); admin edits apply at once.
 * `force` applies a snapshot at the known version too (used after a refetch to repair drift).
 */
export function receiveSimulatedSnapshot(snapshot: SimulatedSnapshot, options: { force?: boolean } = {}): void {
  if (!transport) return
  if (!Number.isFinite(snapshot.balance) || !Number.isFinite(snapshot.version)) return
  const known = knownVersion.get(snapshot.book) ?? -1
  if (snapshot.version < known || (snapshot.version === known && !options.force)) return
  knownVersion.set(snapshot.book, snapshot.version)
  if ((pending.get(snapshot.book) ?? 0) > 0 && snapshot.updatedBy !== 'admin') {
    deferred.set(snapshot.book, snapshot)
    return
  }
  deferred.delete(snapshot.book)
  applyServerAvailableBalance(snapshot.book, snapshot.balance)
}

export async function refreshSimulatedBalances(): Promise<void> {
  const current = transport
  const gen = generation
  if (!current) return
  try {
    const rows = await current.fetchAll()
    if (gen !== generation) return
    for (const row of rows) receiveSimulatedSnapshot(row, { force: true })
  } catch {
    // Offline or not deployed yet: keep the local balances.
  }
}

/** Queues one balance change for the active book. No-op when signed out. */
export function recordSimulatedChange(
  kind: SimulatedChangeKind,
  amount: number,
  ref: string | null = null,
  meta: Record<string, unknown> = {},
): Promise<void> {
  if (!transport || !Number.isFinite(amount) || amount < 0) return Promise.resolve()
  const book = getPracticeBook()
  const gen = generation
  pending.set(book, (pending.get(book) ?? 0) + 1)
  queue = queue.then(async () => {
    let refresh = false
    try {
      if (gen !== generation || !transport) return
      const snapshot = await transport.apply({ book, kind, amount: Math.round(amount * 100) / 100, ref, meta })
      if (gen === generation) {
        const left = (pending.get(book) ?? 1) - 1
        pending.set(book, left)
        receiveSimulatedSnapshot(snapshot)
        return
      }
    } catch {
      refresh = true
    }
    if (gen !== generation) return
    pending.set(book, Math.max(0, (pending.get(book) ?? 1) - 1))
    if (refresh) await refreshSimulatedBalances()
  }).finally(() => {
    if (gen !== generation || (pending.get(book) ?? 0) > 0) return
    const held = deferred.get(book)
    if (held) {
      deferred.delete(book)
      applyServerAvailableBalance(held.book, held.balance)
    }
  })
  return queue
}
