import type { Tick } from '@/types'

/**
 * In-memory buffer of genuine provider ticks per symbol (never persisted, never sent to Supabase).
 * Feeds charts, digit statistics and DEMO settlement against real quotes.
 */

const MAX_TICKS_PER_SYMBOL = 2000

const buffers = new Map<string, Tick[]>()
const receivedAt = new Map<string, number>()
const listeners = new Map<string, Set<(ticks: Tick[]) => void>>()

function notify(symbol: string): void {
  const set = listeners.get(symbol)
  if (!set || set.size === 0) return
  const ticks = buffers.get(symbol) ?? []
  for (const listener of set) listener(ticks)
}

/** Merge ticks into a sorted, de-duplicated (by timestamp) list capped at `max`. */
export function mergeTicks(existing: Tick[], incoming: Tick[], max = MAX_TICKS_PER_SYMBOL): Tick[] {
  const valid = incoming.filter(
    (tick) => !tick.isSimulated && Number.isFinite(tick.price) && Number.isFinite(tick.timestamp),
  )
  if (valid.length === 0) return existing
  const last = existing[existing.length - 1]
  let merged: Tick[]
  if (last && valid.every((tick) => tick.timestamp > last.timestamp)) {
    merged = [...existing, ...[...valid].sort((a, b) => a.timestamp - b.timestamp)]
  } else {
    const byTime = new Map<number, Tick>()
    for (const tick of existing) byTime.set(tick.timestamp, tick)
    for (const tick of valid) byTime.set(tick.timestamp, tick)
    merged = [...byTime.values()].sort((a, b) => a.timestamp - b.timestamp)
  }
  return merged.length > max ? merged.slice(merged.length - max) : merged
}

export function recordTicks(symbol: string, ticks: Tick[], now = Date.now()): void {
  if (!symbol || ticks.length === 0) return
  const prev = buffers.get(symbol) ?? []
  const next = mergeTicks(prev, ticks)
  if (next === prev) return
  const prevLatest = prev[prev.length - 1]?.timestamp ?? -Infinity
  if (next[next.length - 1]!.timestamp > prevLatest) receivedAt.set(symbol, now)
  buffers.set(symbol, next)
  notify(symbol)
}

/** Client time when a newer genuine tick last arrived for `symbol` (0 if never). */
export function getLastReceivedAt(symbol: string): number {
  return receivedAt.get(symbol) ?? 0
}

export function recordTick(tick: Tick): void {
  recordTicks(tick.symbol, [tick])
}

export function getBufferedTicks(symbol: string): Tick[] {
  return buffers.get(symbol) ?? []
}

export function getLatestBufferedTick(symbol: string): Tick | null {
  const ticks = buffers.get(symbol)
  return ticks && ticks.length > 0 ? ticks[ticks.length - 1]! : null
}

/** First genuine tick at or after `timestampMs` (used to settle DEMO contracts at expiry). */
export function firstTickAtOrAfter(symbol: string, timestampMs: number): Tick | null {
  const ticks = buffers.get(symbol)
  if (!ticks || ticks.length === 0) return null
  let lo = 0
  let hi = ticks.length - 1
  if (ticks[hi]!.timestamp < timestampMs) return null
  while (lo < hi) {
    const mid = (lo + hi) >> 1
    if (ticks[mid]!.timestamp >= timestampMs) hi = mid
    else lo = mid + 1
  }
  return ticks[lo]!
}

export function subscribeTickBuffer(symbol: string, listener: (ticks: Tick[]) => void): () => void {
  let set = listeners.get(symbol)
  if (!set) {
    set = new Set()
    listeners.set(symbol, set)
  }
  set.add(listener)
  return () => {
    set!.delete(listener)
    if (set!.size === 0) listeners.delete(symbol)
  }
}

export function clearTickBufferForTests(): void {
  buffers.clear()
  receivedAt.clear()
  listeners.clear()
}

/**
 * Optional live source used by DEMO settlement to make sure the symbols of open trades
 * keep receiving real ticks, and to backfill the expiry window via `ticks_history`.
 * Registered only when a REAL market-data provider is configured.
 */
export type LiveTickSource = {
  ensureSubscribed(symbol: string): void
  backfill(symbol: string, fromMs: number, toMs: number): Promise<void>
  loadRecent(symbol: string, count: number): Promise<void>
}

let liveSource: LiveTickSource | null = null

export function registerLiveTickSource(source: LiveTickSource | null): void {
  liveSource = source
}

export function getLiveTickSource(): LiveTickSource | null {
  return liveSource
}
