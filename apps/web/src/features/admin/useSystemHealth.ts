import { useCallback, useEffect, useState } from 'react'
import { systemIssuesService, type SystemHealth } from '@/services/system-issues'

/** Loads /admin/system data and refreshes it on an interval (0 disables polling). */
export function useSystemHealth(pollMs = 60_000) {
  const [health, setHealth] = useState<SystemHealth | null>(null)
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(true)

  const refresh = useCallback(async () => {
    const result = await systemIssuesService.load()
    if (result.ok) {
      setHealth(result.data)
      setError('')
    } else {
      setError(result.error)
    }
    setLoading(false)
  }, [])

  useEffect(() => {
    void refresh()
    if (!pollMs) return
    const timer = window.setInterval(() => void refresh(), pollMs)
    return () => window.clearInterval(timer)
  }, [refresh, pollMs])

  const failingProbes = health?.probes.filter((probe) => !probe.ok) ?? []
  const problemCount = (health?.open.length ?? 0) + failingProbes.length + (error ? 1 : 0)

  return { health, error, loading, refresh, failingProbes, problemCount }
}
