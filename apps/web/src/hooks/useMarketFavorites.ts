import { useCallback, useSyncExternalStore } from 'react'

/** Favorites are a UI preference shared by DEMO and REAL (both list the same genuine markets). */
export const MARKET_FAVORITES_KEY = 'sbb.real.marketFavorites'

/** Lists the app used to seed before favorites became opt-in; never treat them as user choices. */
const LEGACY_SEEDED = [JSON.stringify(['R_100', 'R_75', '1HZ100V']), JSON.stringify(['BTCUSDT', 'ETHUSDT'])]

const EMPTY: string[] = []
const listeners = new Set<() => void>()
let cache: { raw: string | null; value: string[] } | null = null

export function parseFavorites(raw: string | null): string[] {
  if (!raw || LEGACY_SEEDED.includes(raw)) return EMPTY
  try {
    const parsed: unknown = JSON.parse(raw)
    if (!Array.isArray(parsed)) return EMPTY
    return [...new Set(parsed.filter((item): item is string => typeof item === 'string' && item.length > 0))]
  } catch {
    return EMPTY
  }
}

function readRaw(): string | null {
  try {
    return localStorage.getItem(MARKET_FAVORITES_KEY)
  } catch {
    return null
  }
}

function getSnapshot(): string[] {
  const raw = readRaw()
  if (!cache || cache.raw !== raw) cache = { raw, value: parseFavorites(raw) }
  return cache.value
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener)
  const onStorage = (event: StorageEvent) => {
    if (event.key === MARKET_FAVORITES_KEY) listener()
  }
  window.addEventListener('storage', onStorage)
  return () => {
    listeners.delete(listener)
    window.removeEventListener('storage', onStorage)
  }
}

export function toggleFavoriteIn(list: string[], symbol: string): string[] {
  return list.includes(symbol) ? list.filter((item) => item !== symbol) : [...list, symbol]
}

/** Starred market symbols (empty until the user stars something). */
export function useMarketFavorites() {
  const favorites = useSyncExternalStore(subscribe, getSnapshot, () => EMPTY)
  const toggle = useCallback((symbol: string) => {
    const next = toggleFavoriteIn(getSnapshot(), symbol)
    try {
      localStorage.setItem(MARKET_FAVORITES_KEY, JSON.stringify(next))
    } catch {
      /* storage unavailable — keep in-memory only */
      cache = { raw: JSON.stringify(next), value: next }
    }
    for (const listener of listeners) listener()
  }, [])
  return { favorites, toggle }
}
