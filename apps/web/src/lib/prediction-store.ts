import type { LoadedPrediction, ScanResult } from '@/domain/prediction'

/**
 * Single source of truth for the AI BOT SCANNER result and the loaded prediction. Lives in memory only and is
 * independent of the account mode: switching DEMO ↔ REAL never touches it.
 */

export interface PredictionState {
  /** Latest scan result (only ever one). */
  latest: ScanResult | null
  scanning: boolean
  loaded: LoadedPrediction | null
  /** Why the loaded prediction was cleared, e.g. the ticket changed. */
  notice: string | null
}

const EMPTY: PredictionState = { latest: null, scanning: false, loaded: null, notice: null }

export function createPredictionStore(now: () => number = () => Date.now()) {
  let state: PredictionState = EMPTY
  const listeners = new Set<() => void>()

  function set(patch: Partial<PredictionState>): void {
    state = { ...state, ...patch }
    listeners.forEach((listener) => listener())
  }

  return {
    getSnapshot(): PredictionState {
      return state
    },
    subscribe(listener: () => void): () => void {
      listeners.add(listener)
      return () => {
        listeners.delete(listener)
      }
    },
    getLoaded(): LoadedPrediction | null {
      return state.loaded
    },
    /** A new scan replaces the previous result and invalidates the loaded prediction. */
    beginScan(): void {
      set({ latest: null, scanning: true, loaded: null, notice: null })
    },
    completeScan(result: ScanResult | null): void {
      set({ latest: result ? Object.freeze({ ...result }) : null, scanning: false })
    },
    cancelScan(): void {
      if (state.scanning) set({ scanning: false })
    },
    /** Stores the latest scan result exactly as shown — no recalculation and no new scan. */
    load(): LoadedPrediction | null {
      if (!state.latest || state.scanning) return null
      const loaded: LoadedPrediction = Object.freeze({ ...state.latest, loadedAt: now() })
      set({ loaded, notice: null })
      return loaded
    },
    invalidate(notice: string | null = null): void {
      if (!state.loaded) return
      set({ loaded: null, notice })
    },
    clearNotice(): void {
      if (state.notice) set({ notice: null })
    },
    resetForTests(): void {
      state = EMPTY
      listeners.clear()
    },
  }
}

export type PredictionStore = ReturnType<typeof createPredictionStore>

export const predictionStore = createPredictionStore()
