import { createContext, useContext, useEffect, useMemo, type ReactNode } from 'react'
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

const DEMO: AccountMode = 'demo'

/** The site is DEMO-only: trading always uses the DEMO practice account. */
export function AccountModeProvider({ children }: { children: ReactNode }) {
  setActiveAccountMode(DEMO)

  useEffect(() => {
    try {
      localStorage.setItem(ACCOUNT_MODE_STORAGE_KEY, DEMO)
    } catch {
      /* ignore */
    }
  }, [])

  const value = useMemo(() => {
    const setKind = () => setActiveAccountMode(DEMO)
    return { kind: DEMO, mode: DEMO, setKind, setMode: setKind }
  }, [])

  return <AccountModeContext.Provider value={value}>{children}</AccountModeContext.Provider>
}

export function useAccountMode(): AccountModeContextValue {
  const ctx = useContext(AccountModeContext)
  if (!ctx) throw new Error('useAccountMode must be used within AccountModeProvider')
  return ctx
}
