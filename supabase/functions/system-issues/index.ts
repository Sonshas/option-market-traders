import 'jsr:@supabase/functions-js/edge-runtime.d.ts'
import type { SupabaseClient, User } from 'npm:@supabase/supabase-js@2'
import { isDashboardStaffRole } from '../_shared/admin-dashboard.ts'
import { adminClient, corsHeaders, json, recordSystemIssue, userFromRequest } from '../_shared/server.ts'

// Staff-facing log of backend failures. Users never see these details.
// POST { action: 'report', area, operation, code?, message, route? } — any caller; fields are bounded
//   and repeats of the same area/operation/code fold into one open row.
// POST { action: 'overview' } — staff only; open + recently resolved issues and live table probes.
// POST { action: 'resolve', id } / { action: 'resolve_all' } — staff only.

const SLUG = /^[a-z0-9_.:-]{1,64}$/i

/** Tables the web app reads. A failed probe means users are seeing "temporarily unavailable". */
const PROBE_TABLES = [
  'users',
  'accounts',
  'wallets',
  'transactions',
  'deposits',
  'withdrawals',
  'trades',
  'trade_settlements',
  'notifications',
  'support_tickets',
  'payment_settings',
  'trading_settings',
  'feature_flags',
  'system_issues',
] as const

function appRole(user: User): string {
  const meta = (user.app_metadata ?? {}) as Record<string, unknown>
  return typeof meta.role === 'string' ? meta.role.trim() : ''
}

function bounded(value: unknown, max: number): string | null {
  if (typeof value !== 'string') return null
  const trimmed = value.trim()
  return trimmed ? trimmed.slice(0, max) : null
}

async function probe(admin: SupabaseClient) {
  return Promise.all(
    PROBE_TABLES.map(async (table) => {
      const started = performance.now()
      const { error } = await admin.from(table).select('*', { count: 'exact', head: true }).limit(1)
      const ms = Math.round(performance.now() - started)
      if (error) {
        await recordSystemIssue(admin, {
          source: 'probe',
          area: 'database',
          operation: `table:${table}`,
          code: error.code ?? null,
          message: error.message,
        })
      }
      return { table, ok: !error, ms, code: error?.code ?? null, message: error ? error.message.slice(0, 300) : null }
    }),
  )
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders })
  if (req.method !== 'POST') return json({ error: 'Method not allowed' }, 405)

  let body: Record<string, unknown> = {}
  try {
    body = await req.json()
  } catch {
    return json({ error: 'Invalid request.' }, 400)
  }

  const admin = adminClient()
  const user = await userFromRequest(admin, req)

  if (body.action === 'report') {
    const area = bounded(body.area, 64)
    const operation = bounded(body.operation, 64)
    const message = bounded(body.message, 500)
    if (!area || !operation || !message || !SLUG.test(area) || !SLUG.test(operation)) {
      return json({ error: 'Invalid report.' }, 400)
    }
    await recordSystemIssue(admin, {
      source: 'web',
      area,
      operation,
      code: bounded(body.code, 64),
      message,
      route: bounded(body.route, 200),
      userId: user?.id ?? null,
    })
    return json({ ok: true })
  }

  if (!user) return json({ error: 'Sign in as staff.' }, 401)
  if (!isDashboardStaffRole(appRole(user))) return json({ error: 'Forbidden' }, 403)

  if (body.action === 'overview') {
    const probes = await probe(admin)
    const [open, resolved] = await Promise.all([
      admin.from('system_issues').select('*').is('resolved_at', null).order('last_seen', { ascending: false }).limit(200),
      admin
        .from('system_issues')
        .select('*')
        .not('resolved_at', 'is', null)
        .order('resolved_at', { ascending: false })
        .limit(50),
    ])
    if (open.error || resolved.error) {
      console.error('system-issues overview', open.error?.code ?? resolved.error?.code ?? 'error')
    }
    return json({
      checked_at: new Date().toISOString(),
      probes,
      open: open.data ?? [],
      resolved: resolved.data ?? [],
      log_available: !open.error,
    })
  }

  if (body.action === 'resolve' || body.action === 'resolve_all') {
    let query = admin
      .from('system_issues')
      .update({ resolved_at: new Date().toISOString(), resolved_by: user.id })
      .is('resolved_at', null)
    if (body.action === 'resolve') {
      const id = bounded(body.id, 64)
      if (!id) return json({ error: 'Missing issue id.' }, 400)
      query = query.eq('id', id)
    }
    const { error } = await query
    if (error) {
      console.error('system-issues resolve', error.code ?? 'error')
      return json({ error: 'Could not update issues.' }, 500)
    }
    return json({ ok: true })
  }

  return json({ error: 'Unknown action.' }, 400)
})
