import { DEMO_WIN_RATE } from '@/domain/outcome/demo-win-rate'
import { parseWinRate } from '@/domain/admin-panel'

/**
 * Effective simulated (Demo / Practice) win rate for the signed-in user, resolved on the server
 * (override ?? global) and cached here. Signed out or offline it stays at DEMO_WIN_RATE.
 * Read at settlement time, so a change applies to the next settled trade.
 */
let current = DEMO_WIN_RATE
const listeners = new Set<() => void>()

export function getSimulatedWinRate(): number {
  return current
}

export function setSimulatedWinRate(value: unknown): void {
  const next = parseWinRate(value) ?? DEMO_WIN_RATE
  if (next === current) return
  current = next
  listeners.forEach((listener) => listener())
}

export function resetSimulatedWinRate(): void {
  setSimulatedWinRate(DEMO_WIN_RATE)
}

export function subscribeSimulatedWinRate(listener: () => void): () => void {
  listeners.add(listener)
  return () => {
    listeners.delete(listener)
  }
}
