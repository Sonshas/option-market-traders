const EVENT = 'sbb:real-wallet-changed'

/** Ask every mounted REAL wallet / history hook to re-read Supabase (e.g. after a deposit completes). */
export function notifyRealWalletChanged(): void {
  if (typeof window !== 'undefined') window.dispatchEvent(new Event(EVENT))
}

export function subscribeRealWalletChanged(listener: () => void): () => void {
  if (typeof window === 'undefined') return () => {}
  window.addEventListener(EVENT, listener)
  return () => window.removeEventListener(EVENT, listener)
}
