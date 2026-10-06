import 'jsr:@supabase/functions-js/edge-runtime.d.ts'
import type { SupabaseClient, User } from 'npm:@supabase/supabase-js@2'
import {
  collectedTotals,
  isDashboardStaffRole,
  mergeJoinedUsers,
  splitMpesaDeposits,
  type AuthUserSource,
  type DepositSource,
  type PublicUserSource,
} from '../_shared/admin-dashboard.ts'
import { adminClient, corsHeaders, json, userFromRequest } from '../_shared/server.ts'

// Read-only staff dashboard. verify_jwt is on, and the caller's JWT app_metadata.role must be
// admin, superadmin, or finance — the same allow-list as admin-withdrawals.
// POST { action: 'overview' } returns joined users and real M-Pesa deposits.
// Completed deposits are the only ones included in the collected total.
// This function never inserts, updates, or credits deposits, wallets, or users.

const DEPOSIT_COLUMNS =
  'id, user_id, amount, currency, status, provider, method, mpesa_receipt, callback_amount_kes, details, created_at, updated_at, is_simulated, account_mode'

const PAGE = 1000
const MAX_PAGES = 10

function appRole(user: User): string {
  const meta = (user.app_metadata ?? {}) as Record<string, unknown>
  return typeof meta.role === 'string' ? meta.role.trim() : ''
}

function asRecord(value: unknown): Record<string, unknown> | null {
  if (value && typeof value === 'object' && !Array.isArray(value)) return value as Record<string, unknown>
  return null
}

async function loadDeposits(admin: SupabaseClient): Promise<DepositSource[]> {
  const rows: DepositSource[] = []
  for (let page = 0; page < MAX_PAGES; page++) {
    const from = page * PAGE
    const { data, error } = await admin
      .from('deposits')
      .select(DEPOSIT_COLUMNS)
      .eq('account_mode', 'real')
      .eq('is_simulated', false)
      .eq('method', 'mpesa')
      .order('created_at', { ascending: false })
      .range(from, from + PAGE - 1)
    if (error) {
      console.error('admin-dashboard deposits', error.code ?? 'error')
      throw new Error('deposits query failed')
    }
    for (const raw of data ?? []) {
      const row = raw as Record<string, unknown>
      rows.push({
        id: String(row.id),
        user_id: String(row.user_id),
        amount: (row.amount as number | string | null) ?? null,
        currency: (row.currency as string | null) ?? null,
        status: (row.status as string | null) ?? null,
        provider: (row.provider as string | null) ?? null,
        method: (row.method as string | null) ?? null,
        mpesa_receipt: (row.mpesa_receipt as string | null) ?? null,
        callback_amount_kes: (row.callback_amount_kes as number | string | null) ?? null,
        details: asRecord(row.details),
        created_at: String(row.created_at ?? ''),
        updated_at: String(row.updated_at ?? ''),
        is_simulated: row.is_simulated === true,
        account_mode: (row.account_mode as string | null) ?? null,
      })
    }
    if (!data || data.length < PAGE) break
  }
  return rows
}

async function loadAuthUsers(admin: SupabaseClient): Promise<AuthUserSource[]> {
  const users: AuthUserSource[] = []
  for (let page = 1; page <= 20; page++) {
    const { data, error } = await admin.auth.admin.listUsers({ page, perPage: 200 })
    if (error) {
      console.error('admin-dashboard auth users', error.code ?? error.name ?? 'error')
      throw new Error('auth users query failed')
    }
    for (const authUser of data.users) {
      const meta = (authUser.app_metadata ?? {}) as Record<string, unknown>
      users.push({
        id: authUser.id,
        email: authUser.email ?? null,
        created_at: authUser.created_at,
        app_role: typeof meta.role === 'string' ? meta.role : null,
      })
    }
    if (data.users.length < 200) break
  }
  return users
}

async function loadProfiles(admin: SupabaseClient): Promise<PublicUserSource[]> {
  const rows: PublicUserSource[] = []
  for (let page = 0; page < MAX_PAGES; page++) {
    const from = page * PAGE
    const { data, error } = await admin.from('users').select('id, email, role').range(from, from + PAGE - 1)
    if (error) {
      console.error('admin-dashboard profiles', error.code ?? 'error')
      throw new Error('profiles query failed')
    }
    for (const row of data ?? []) {
      rows.push({
        id: String(row.id),
        email: typeof row.email === 'string' ? row.email : null,
        role: typeof row.role === 'string' ? row.role : null,
      })
    }
    if (!data || data.length < PAGE) break
  }
  return rows
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders })
  if (req.method !== 'POST') return json({ error: 'Method not allowed' }, 405)

  const admin = adminClient()
  const user = await userFromRequest(admin, req)
  if (!user) return json({ error: 'Sign in as staff.' }, 401)
  const role = appRole(user)
  if (!isDashboardStaffRole(role)) {
    console.log('admin-dashboard forbidden', user.id, role || 'trader')
    return json({ error: 'Forbidden' }, 403)
  }

  let body: Record<string, unknown> = {}
  try {
    body = await req.json()
  } catch {
    return json({ error: 'Invalid request.' }, 400)
  }
  if (body.action !== 'overview') return json({ error: 'Unknown action.' }, 400)

  try {
    const [authUsers, profiles, deposits] = await Promise.all([
      loadAuthUsers(admin),
      loadProfiles(admin),
      loadDeposits(admin),
    ])
    const users = mergeJoinedUsers(authUsers, profiles)
    const emails = new Map(users.map((row) => [row.id, row.email]))
    const { collected, other } = splitMpesaDeposits(deposits)
    const totals = collectedTotals(collected)
    const withEmail = <T extends { user_id: string }>(row: T) => ({
      ...row,
      user_email: emails.get(row.user_id) ?? null,
    })
    console.log('admin-dashboard overview', user.id, users.length, totals.count)
    return json({
      users,
      collected: collected.map(withEmail),
      other: other.map(withEmail),
      totals: {
        collected_usd: totals.usd,
        collected_kes: totals.kes,
        collected_count: totals.count,
        user_count: users.length,
      },
    })
  } catch (err) {
    console.error('admin-dashboard load failed', err instanceof Error ? err.message : 'error')
    return json({ error: 'Could not load the dashboard.' }, 500)
  }
})
