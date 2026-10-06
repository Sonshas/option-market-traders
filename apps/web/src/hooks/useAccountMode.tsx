import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react'
import { setActiveAccountMode } from '@/lib/active-account-mode'
import { ACCOUNT_MODE_STORAGE_KEY } from '@/providers/config'
import type { AccountMode } from '@/types'

interface AccountModeContextValue {
  kind: AccountMode
  mode: AccountMode
  setKind: (kind: AccountMode) => void
  setMode: (mode: AccountMode) => void
}

const AccountModeContext = createContext<AccountModeContextValue | null>(null)

function readStoredMode(): AccountMode {
  try {
    const raw = localStorage.getItem(ACCOUNT_MODE_STORAGE_KEY)
    if (raw === 'real' || raw === 'demo') return raw
    if (raw === 'live') return 'real'
  } catch {
    /* ignore */
  }
  return 'demo'
}

function persistMode(mode: AccountMode): void {
  try {
    localStorage.setItem(ACCOUNT_MODE_STORAGE_KEY, mode)
  } catch {
    /* ignore */
  }
}

export function AccountModeProvider({ children }: { children: ReactNode }) {
  const [kind, setKindState] = useState<AccountMode>(() => {
    const stored = readStoredMode()
    setActiveAccountMode(stored)
    return stored
  })

  useEffect(() => {
    persistMode(kind)
    setActiveAccountMode(kind)
  }, [kind])

  const setKind = useCallback((next: AccountMode) => {
    const mode = next === 'real' ? 'real' : 'demo'
    setActiveAccountMode(mode)
    setKindState(mode)
  }, [])

  const value = useMemo(
    () => ({
      kind,
      mode: kind,
      setKind,
      setMode: setKind,
    }),
    [kind, setKind],
  )

  return <AccountModeContext.Provider value={value}>{children}</AccountModeContext.Provider>
}

export function useAccountMode(): AccountModeContextValue {
  const ctx = useContext(AccountModeContext)
  if (!ctx) throw new Error('useAccountMode must be used within AccountModeProvider')
  return ctx
}
