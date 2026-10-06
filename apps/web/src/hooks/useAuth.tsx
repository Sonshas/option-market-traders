import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from 'react'
import { authService } from '@/services/auth'
import type { ProviderResult, User } from '@/types'

interface AuthContextValue {
  user: User | null
  isSignedIn: boolean
  loading: boolean
  message: string
  authService: typeof authService
  refresh: () => Promise<void>
}

const AuthContext = createContext<AuthContextValue | null>(null)

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User | null>(null)
  const [loading, setLoading] = useState(true)
  const [message, setMessage] = useState('')

  const refresh = useCallback(async () => {
    const result = await authService.getSession()
    setUser(result.data)
    setMessage(result.message)
    setLoading(false)
  }, [])

  useEffect(() => {
    let cancelled = false
    void authService.getSession().then((result) => {
      if (cancelled) return
      setUser(result.data)
      setMessage(result.message)
      setLoading(false)
    })
    const unsubscribe = authService.onAuthStateChange((next) => {
      if (cancelled) return
      setUser(next)
      setLoading(false)
      setMessage(next ? `Session active for ${next.email}.` : 'No active session.')
    })
    return () => {
      cancelled = true
      unsubscribe()
    }
  }, [])

  const value = useMemo(
    () => ({
      user,
      isSignedIn: Boolean(user),
      loading,
      message,
      authService,
      refresh,
    }),
    [user, loading, message, refresh],
  )

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>
}

export function useAuthSession(): AuthContextValue {
  const ctx = useContext(AuthContext)
  if (!ctx) {
    throw new Error('useAuthSession must be used within AuthProvider')
  }
  return ctx
}

/** @deprecated Prefer useAuthSession — kept for existing call sites. */
export function useDemoSession() {
  const { user, isSignedIn } = useAuthSession()
  return { user, isSignedIn }
}

export function useAuthAction() {
  const { refresh } = useAuthSession()
  const [loading, setLoading] = useState(false)
  const [result, setResult] = useState<ProviderResult<User | null> | null>(null)

  const run = useCallback(
    async (fn: () => Promise<ProviderResult<User | null | undefined> | ProviderResult<null>>) => {
      setLoading(true)
      setResult(null)
      const next = await fn()
      setResult({
        ...next,
        data: (next.data as User | null) ?? null,
      })
      await refresh()
      setLoading(false)
      return next
    },
    [refresh],
  )

  return { loading, result, run, authService }
}
