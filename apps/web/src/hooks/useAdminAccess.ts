import { useEffect, useState } from 'react'
import { adminPanelService, type AdminAccessLevel } from '@/services/admin-panel'

/**
 * Asks the server (public.admin_access_level) what the current session may do in /admin.
 * Disabled (signed out / auth still loading) it makes no request and reports no access.
 */
export function useAdminAccess(enabled: boolean, userId: string | null): { level: AdminAccessLevel | null; loading: boolean } {
  const [state, setState] = useState<{ key: string | null; level: AdminAccessLevel | null }>({ key: null, level: null })
  const key = enabled && userId ? userId : null

  useEffect(() => {
    if (!key) return
    let cancelled = false
    void adminPanelService
      .accessLevel()
      .catch((): AdminAccessLevel => 'none')
      .then((level) => {
        if (!cancelled) setState({ key, level })
      })
    return () => {
      cancelled = true
    }
  }, [key])

  if (!key) return { level: null, loading: false }
  if (state.key !== key) return { level: null, loading: true }
  return { level: state.level, loading: false }
}
