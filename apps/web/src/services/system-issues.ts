import { getSupabase } from '@/lib/supabase'

/**
 * Backend failures are reported here and shown to staff on /admin/system.
 * Users only ever get the neutral fallback text — never codes, table names, or raw database errors.
 */

const FUNCTION = 'system-issues'
const THROTTLE_MS = 60_000
const lastSent = new Map<string, number>()

export type Result<T> = { ok: true; data: T } | { ok: false; error: string }

function describe(error: unknown): { code: string | null; message: string } {
  if (error && typeof error === 'object') {
    const row = error as { code?: unknown; status?: unknown; message?: unknown; name?: unknown }
    const code = row.code ?? row.status ?? null
    const message = typeof row.message === 'string' && row.message ? row.message : String(row.name ?? 'Unknown error')
    return { code: code == null ? null : String(code), message }
  }
  return { code: null, message: typeof error === 'string' && error ? error : 'Unknown error' }
}

/** Fire-and-forget. Never throws and never blocks the caller. */
export function reportBackendIssue(area: string, operation: string, error: unknown, code?: string | number | null): void {
  const detail = describe(error)
  const finalCode = code == null ? detail.code : String(code)
  const fingerprint = `${area}:${operation}:${finalCode ?? ''}`
  const now = Date.now()
  if ((lastSent.get(fingerprint) ?? 0) > now - THROTTLE_MS) return
  lastSent.set(fingerprint, now)

  const client = getSupabase()
  if (!client) return
  const route = typeof window === 'undefined' ? null : window.location.pathname
  void client.functions
    .invoke(FUNCTION, {
      method: 'POST',
      body: { action: 'report', area, operation, code: finalCode, message: detail.message.slice(0, 500), route },
    })
    .catch(() => undefined)
}

/**
 * Turns an Edge Function error into user-safe text. 4xx business messages (e.g. "Insufficient balance")
 * pass through; server failures and network errors are reported and replaced by `fallback`.
 */
export async function edgeErrorMessage(
  error: unknown,
  fallback: string,
  where: { area: string; operation: string },
): Promise<string> {
  const context = (error as { context?: Response } | null)?.context
  const status = context && typeof context.status === 'number' ? context.status : null
  let bodyMessage: string | null = null
  if (context && typeof context.json === 'function') {
    try {
      const body = (await context.clone().json()) as { error?: string; message?: string }
      bodyMessage = body.error || body.message ? String(body.error ?? body.message) : null
    } catch {
      // not JSON
    }
  }
  if (status !== null && status >= 400 && status < 500 && bodyMessage) return bodyMessage
  reportBackendIssue(where.area, where.operation, bodyMessage ? { message: bodyMessage } : error, status)
  return fallback
}

export interface SystemIssue {
  id: string
  source: 'web' | 'edge' | 'probe'
  area: string
  operation: string
  code: string | null
  message: string
  route: string | null
  occurrences: number
  firstSeen: string
  lastSeen: string
  resolvedAt: string | null
}

export interface TableProbe {
  table: string
  ok: boolean
  ms: number
  code: string | null
  message: string | null
}

export interface SystemHealth {
  checkedAt: string
  probes: TableProbe[]
  open: SystemIssue[]
  resolved: SystemIssue[]
  logAvailable: boolean
}

function str(value: unknown): string | null {
  return typeof value === 'string' && value ? value : null
}

function mapIssue(raw: Record<string, unknown>): SystemIssue {
  const source = raw.source === 'edge' || raw.source === 'probe' ? raw.source : 'web'
  return {
    id: String(raw.id ?? ''),
    source,
    area: str(raw.area) ?? 'unknown',
    operation: str(raw.operation) ?? 'unknown',
    code: str(raw.code),
    message: str(raw.message) ?? '',
    route: str(raw.route),
    occurrences: Number(raw.occurrences ?? 1) || 1,
    firstSeen: str(raw.first_seen) ?? '',
    lastSeen: str(raw.last_seen) ?? '',
    resolvedAt: str(raw.resolved_at),
  }
}

function rows(value: unknown): Record<string, unknown>[] {
  return Array.isArray(value) ? value.filter((row): row is Record<string, unknown> => Boolean(row) && typeof row === 'object') : []
}

async function staffError(error: unknown): Promise<string> {
  const context = (error as { context?: Response } | null)?.context
  if (context?.status === 403) return 'This page is limited to admin, superadmin, and finance accounts.'
  if (context?.status === 401) return 'Sign in as staff to view system health.'
  return 'System health could not be loaded. The issue log itself may be unavailable.'
}

export const systemIssuesService = {
  async load(): Promise<Result<SystemHealth>> {
    const client = getSupabase()
    if (!client) return { ok: false, error: 'The backend is not reachable from this build.' }
    const { data, error } = await client.functions.invoke<Record<string, unknown>>(FUNCTION, {
      method: 'POST',
      body: { action: 'overview' },
    })
    if (error || !data) return { ok: false, error: await staffError(error) }
    return {
      ok: true,
      data: {
        checkedAt: str(data.checked_at) ?? new Date().toISOString(),
        probes: rows(data.probes).map((row) => ({
          table: String(row.table ?? ''),
          ok: row.ok === true,
          ms: Number(row.ms ?? 0) || 0,
          code: str(row.code),
          message: str(row.message),
        })),
        open: rows(data.open).map(mapIssue),
        resolved: rows(data.resolved).map(mapIssue),
        logAvailable: data.log_available !== false,
      },
    }
  },

  async resolve(id?: string): Promise<Result<null>> {
    const client = getSupabase()
    if (!client) return { ok: false, error: 'The backend is not reachable from this build.' }
    const { error } = await client.functions.invoke(FUNCTION, {
      method: 'POST',
      body: id ? { action: 'resolve', id } : { action: 'resolve_all' },
    })
    if (error) return { ok: false, error: await staffError(error) }
    return { ok: true, data: null }
  },
}
