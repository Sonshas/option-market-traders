import 'jsr:@supabase/functions-js/edge-runtime.d.ts'
import type { SupabaseClient } from 'npm:@supabase/supabase-js@2'
import { splitMpesaDeposits, type DepositSource } from '../_shared/admin-dashboard.ts'
import {
  SIMULATED_STARTING_BALANCE,
  effectiveWinRate,
  parseWinRate,
  periodSeries,
  summarizePeriods,
  type DatedAmount,
} from '../_shared/admin-panel.ts'
import { adminClient, corsHeaders, json, resolveServerConfig, userFromRequest } from '../_shared/server.ts'

// Superadmin panel reads. verify_jwt is on; the caller must also pass public.is_superadmin_user
// (confirmed email in public.app_admins). Never trusts an email or role sent by the client.
// POST { action: 'overview' } — deposit + signup metrics, users with simulated / real balances,
//   win rates, withdrawals overview, and the admin audit log.
// POST { action: 'user_detail', user_id } — one user's simulated activity, real trades, withdrawals.
// Read-only: balance and win-rate edits go through the admin_* RPCs, which re-check the role.

const PAGE = 1000
const MAX_PAGES = 20
const DEFAULT_WIN_RATE = 0.95

const DEPOSIT_COLUMNS =
  'id, user_id, amount, currency, status, provider, method, mpesa_receipt, callback_amount_kes, details, created_at, updated_at, is_simulated, account_mode'

type Row = Record<string, unknown>

function asRecord(value: unknown): Record<string, unknown> | null {
  if (value && typeof value === 'object' && !Array.isArray(value)) return value as Record<string, unknown>
  return null
}

function num(value: unknown): number | null {
  if (value == null || value === '') return null
  const n = Number(value)
  return Number.isFinite(n) ? n : null
}

async function pagedSelect(admin: SupabaseClient, table: string, columns: string, build?: (q: any) => any): Promise<Row[]> {
  const rows: Row[] = []
  for (let page = 0; page < MAX_PAGES; page++) {
    const from = page * PAGE
    let query = admin.from(table).select(columns)
    if (build) query = build(query)
    const { data, error } = await query.range(from, from + PAGE - 1)
    if (error) {
      console.error('admin-panel select', table, error.code ?? 'error')
      throw new Error(`${table} query failed`)
    }
    rows.push(...((data ?? []) as Row[]))
    if (!data || data.length < PAGE) break
  }
  return rows
}

async function loadAuthUsers(admin: SupabaseClient) {
  const users: { id: string; email: string | null; created_at: string; last_sign_in_at: string | null }[] = []
  for (let page = 1; page <= 50; page++) {
    const { data, error } = await admin.auth.admin.listUsers({ page, perPage: 200 })
    if (error) {
      console.error('admin-panel auth users', error.code ?? error.name ?? 'error')
      throw new Error('auth users query failed')
    }
    for (const u of data.users) {
      users.push({ id: u.id, email: u.email ?? null, created_at: u.created_at, last_sign_in_at: u.last_sign_in_at ?? null })
    }
    if (data.users.length < 200) break
  }
  return users
}

async function loadDeposits(admin: SupabaseClient): Promise<DepositSource[]> {
  const rows = await pagedSelect(admin, 'deposits', DEPOSIT_COLUMNS, (q) =>
    q.eq('account_mode', 'real').eq('is_simulated', false).order('created_at', { ascending: false }),
  )
  return rows.map((row) => ({
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
  }))
}

async function overview(admin: SupabaseClient) {
  const now = Date.now()
  const [cfg, authUsers, profiles, deposits, balances, overrides, settings, wallets, withdrawals, audit] = await Promise.all([
    resolveServerConfig(admin),
    loadAuthUsers(admin),
    pagedSelect(admin, 'users', 'id, role'),
    loadDeposits(admin),
    pagedSelect(admin, 'simulated_balances', 'user_id, book, balance, updated_at, updated_by'),
    pagedSelect(admin, 'simulated_win_rate_overrides', 'user_id, win_rate'),
    admin.from('simulation_settings').select('win_rate, updated_at').eq('id', true).maybeSingle(),
    pagedSelect(admin, 'wallets', 'user_id, available_balance, currency', (q) => q.eq('account_mode', 'real').eq('is_simulated', false)),
    pagedSelect(admin, 'withdrawals', 'id, user_id, amount, amount_kes, status, reference, created_at', (q) =>
      q.eq('account_mode', 'real').eq('is_simulated', false).order('created_at', { ascending: false }),
    ),
    admin.from('admin_audit_log').select('*').order('created_at', { ascending: false }).limit(200),
  ])
  if (settings.error) throw new Error('simulation_settings query failed')
  if (audit.error) throw new Error('admin_audit_log query failed')

  const rate = num(cfg.kesPerUsd)
  const emails = new Map(authUsers.map((u) => [u.id, u.email]))
  const { collected, other } = splitMpesaDeposits(deposits)
  const depositItems: DatedAmount[] = collected.map((d) => ({
    at: d.credited_at ?? d.created_at,
    usd: d.amount_usd ?? (d.amount_kes != null && rate ? Math.round((d.amount_kes / rate) * 100) / 100 : null),
  }))
  const recordedKes = collected.reduce((sum, d) => sum + (d.amount_kes ?? 0), 0)
  const signupItems: DatedAmount[] = authUsers.map((u) => ({ at: u.created_at, usd: 0 }))

  const roles = new Map(profiles.map((p) => [String(p.id), typeof p.role === 'string' ? p.role : null]))
  const sim = new Map<string, { demo: number | null; practice: number | null; updatedAt: string | null }>()
  for (const row of balances) {
    const id = String(row.user_id)
    const entry = sim.get(id) ?? { demo: null, practice: null, updatedAt: null }
    if (row.book === 'demo') entry.demo = num(row.balance)
    if (row.book === 'practice') entry.practice = num(row.balance)
    const at = typeof row.updated_at === 'string' ? row.updated_at : null
    if (at && (!entry.updatedAt || at > entry.updatedAt)) entry.updatedAt = at
    sim.set(id, entry)
  }
  const overrideById = new Map(overrides.map((o) => [String(o.user_id), parseWinRate(o.win_rate)]))
  const realById = new Map(wallets.map((w) => [String(w.user_id), { balance: num(w.available_balance), currency: String(w.currency ?? 'USD') }]))
  const globalRate = parseWinRate(settings.data?.win_rate) ?? DEFAULT_WIN_RATE

  const users = authUsers
    .map((u) => {
      const s = sim.get(u.id)
      const override = overrideById.get(u.id) ?? null
      return {
        id: u.id,
        email: u.email,
        signed_up_at: u.created_at,
        last_sign_in_at: u.last_sign_in_at,
        role: roles.get(u.id) ?? 'trader',
        demo_balance: s?.demo ?? null,
        practice_balance: s?.practice ?? null,
        simulated_synced: Boolean(s),
        simulated_updated_at: s?.updatedAt ?? null,
        real_balance: realById.get(u.id)?.balance ?? null,
        real_currency: realById.get(u.id)?.currency ?? 'USD',
        win_rate_override: override,
        effective_win_rate: effectiveWinRate(override, globalRate, DEFAULT_WIN_RATE),
      }
    })
    .sort((a, b) => (a.signed_up_at < b.signed_up_at ? 1 : a.signed_up_at > b.signed_up_at ? -1 : 0))

  const byStatus: Record<string, { count: number; usd: number }> = {}
  for (const w of withdrawals) {
    const status = String(w.status ?? 'UNKNOWN')
    const entry = byStatus[status] ?? { count: 0, usd: 0 }
    entry.count += 1
    entry.usd = Math.round((entry.usd + (num(w.amount) ?? 0)) * 100) / 100
    byStatus[status] = entry
  }

  return {
    generated_at: new Date(now).toISOString(),
    rate: { kes_per_usd: rate, source: 'Deposit rate (payment_settings DEPOSIT_KES_PER_USD, else KES_PER_USD secret)' },
    deposits: {
      summary: summarizePeriods(depositItems, now),
      series: periodSeries(depositItems, now),
      recorded_kes_total: Math.round(recordedKes * 100) / 100,
      not_collected_count: other.length,
    },
    signups: { summary: summarizePeriods(signupItems, now), series: periodSeries(signupItems, now) },
    users,
    win_rate: { global: globalRate, updated_at: settings.data?.updated_at ?? null },
    starting_balance: SIMULATED_STARTING_BALANCE,
    withdrawals: {
      by_status: byStatus,
      recent: withdrawals.slice(0, 25).map((w) => ({
        id: String(w.id),
        user_email: emails.get(String(w.user_id)) ?? null,
        amount_usd: num(w.amount),
        amount_kes: num(w.amount_kes),
        status: String(w.status ?? ''),
        reference: typeof w.reference === 'string' ? w.reference : null,
        created_at: String(w.created_at ?? ''),
      })),
    },
    audit: audit.data ?? [],
  }
}

async function userDetail(admin: SupabaseClient, userId: string) {
  const [ledger, trades, withdrawals] = await Promise.all([
    admin
      .from('simulated_balance_ledger')
      .select('id, book, kind, delta, balance_after, ref, meta, created_at')
      .eq('user_id', userId)
      .order('created_at', { ascending: false })
      .limit(60),
    admin
      .from('trades')
      .select('id, symbol, contract_type, contract_option, stake, status, payout, profit_loss, account_mode, created_at')
      .eq('user_id', userId)
      .order('created_at', { ascending: false })
      .limit(20),
    admin
      .from('withdrawals')
      .select('id, amount, amount_kes, status, reference, created_at')
      .eq('user_id', userId)
      .eq('is_simulated', false)
      .order('created_at', { ascending: false })
      .limit(20),
  ])
  if (ledger.error || trades.error || withdrawals.error) throw new Error('user detail query failed')
  return { simulated_activity: ledger.data ?? [], real_trades: trades.data ?? [], withdrawals: withdrawals.data ?? [] }
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders })
  if (req.method !== 'POST') return json({ error: 'Method not allowed' }, 405)

  const admin = adminClient()
  const user = await userFromRequest(admin, req)
  if (!user) return json({ error: 'Sign in as the superadmin.' }, 401)
  const { data: allowed, error: roleError } = await admin.rpc('is_superadmin_user', { p_user_id: user.id })
  if (roleError) {
    console.error('admin-panel role check', roleError.code ?? 'error')
    return json({ error: 'Could not verify access.' }, 500)
  }
  if (allowed !== true) {
    console.log('admin-panel forbidden', user.id)
    return json({ error: 'Forbidden' }, 403)
  }

  let body: Record<string, unknown> = {}
  try {
    body = await req.json()
  } catch {
    return json({ error: 'Invalid request.' }, 400)
  }

  try {
    if (body.action === 'overview') return json(await overview(admin))
    if (body.action === 'user_detail') {
      const id = typeof body.user_id === 'string' ? body.user_id : ''
      if (!UUID.test(id)) return json({ error: 'Invalid user.' }, 400)
      return json(await userDetail(admin, id))
    }
    return json({ error: 'Unknown action.' }, 400)
  } catch (err) {
    console.error('admin-panel failed', err instanceof Error ? err.message : 'error')
    return json({ error: 'Could not load the admin panel.' }, 500)
  }
})
