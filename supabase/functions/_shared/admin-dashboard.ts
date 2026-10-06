// Pure staff-dashboard rules shared by the web app and the admin-dashboard Edge Function.
// supabase/functions/_shared/admin-dashboard.ts must stay byte-identical to this file
// (enforced by admin-dashboard.test.ts).
//
// Read-only. Nothing here inserts, updates, or credits money.
// Collected money is COMPLETED real M-Pesa deposits only. Pending, failed, and cancelled
// rows can be listed beside them and are never added to the total.

/** Same app_metadata.role allow-list as admin-withdrawals (WITHDRAWAL_ADMIN_ROLES). */
export const DASHBOARD_STAFF_ROLES = ['admin', 'superadmin', 'finance'] as const

export function isDashboardStaffRole(role: string | null | undefined): boolean {
  if (!role) return false
  const trimmed = role.trim()
  return (DASHBOARD_STAFF_ROLES as readonly string[]).includes(trimmed)
}

export interface DepositSource {
  id: string
  user_id: string
  amount: number | string | null
  currency: string | null
  status: string | null
  provider: string | null
  method: string | null
  mpesa_receipt: string | null
  callback_amount_kes: number | string | null
  details: Record<string, unknown> | null
  created_at: string
  updated_at: string
  is_simulated: boolean
  account_mode: string | null
}

export interface DashboardDeposit {
  id: string
  user_id: string
  amount_usd: number | null
  amount_kes: number | null
  status: string
  provider: string | null
  receipt: string | null
  created_at: string
  credited_at: string | null
}

export interface CollectedTotals {
  usd: number | null
  kes: number | null
  count: number
}

export interface AuthUserSource {
  id: string
  email: string | null
  created_at: string
  app_role: string | null
}

export interface PublicUserSource {
  id: string
  email: string | null
  role: string | null
}

export interface DashboardUser {
  id: string
  email: string | null
  signed_up_at: string
  role: string
}

function finiteNumber(value: unknown): number | null {
  if (value == null || value === '') return null
  const n = typeof value === 'number' ? value : Number(value)
  return Number.isFinite(n) ? n : null
}

function text(value: unknown): string | null {
  return typeof value === 'string' && value.trim() ? value.trim() : null
}

function roundMoney(value: number): number {
  return Math.round((value + Number.EPSILON) * 100) / 100
}

export function isRealMpesaDeposit(row: DepositSource): boolean {
  return row.account_mode === 'real' && row.is_simulated === false && (row.method ?? '').toLowerCase() === 'mpesa'
}

export function isCreditedDeposit(row: DepositSource): boolean {
  return isRealMpesaDeposit(row) && row.status === 'COMPLETED'
}

export function toDashboardDeposit(row: DepositSource): DashboardDeposit {
  const details = row.details ?? {}
  const currency = (row.currency ?? '').toUpperCase()
  const amount = finiteNumber(row.amount)
  const kesFromDetails = finiteNumber(details.amount_kes)
  const kesFromCallback = finiteNumber(row.callback_amount_kes)
  const amountKes = currency === 'KES' ? (kesFromCallback ?? kesFromDetails ?? amount) : (kesFromCallback ?? kesFromDetails)
  const amountUsd = currency === 'USD' ? amount : finiteNumber(details.amount_usd)
  const credited =
    row.status === 'COMPLETED' ? (text(details.completed_at) ?? text(row.updated_at)) : null
  return {
    id: row.id,
    user_id: row.user_id,
    amount_usd: amountUsd,
    amount_kes: amountKes,
    status: row.status ?? '',
    provider: text(row.provider),
    receipt: text(row.mpesa_receipt) ?? text(details.mpesa_receipt),
    created_at: row.created_at,
    credited_at: credited,
  }
}

export function splitMpesaDeposits(rows: DepositSource[]): { collected: DashboardDeposit[]; other: DashboardDeposit[] } {
  const collected: DashboardDeposit[] = []
  const other: DashboardDeposit[] = []
  for (const row of rows) {
    if (!isRealMpesaDeposit(row)) continue
    const view = toDashboardDeposit(row)
    if (row.status === 'COMPLETED') collected.push(view)
    else other.push(view)
  }
  return { collected, other }
}

/** Sum of credited (COMPLETED) rows only. Pass the collected list, not pending or failed rows. */
export function collectedTotals(collected: DashboardDeposit[]): CollectedTotals {
  if (collected.length === 0) return { usd: 0, kes: 0, count: 0 }
  let usd = 0
  let kes = 0
  let hasUsd = false
  let hasKes = false
  for (const row of collected) {
    if (row.amount_usd != null) {
      usd += row.amount_usd
      hasUsd = true
    }
    if (row.amount_kes != null) {
      kes += row.amount_kes
      hasKes = true
    }
  }
  return {
    usd: hasUsd ? roundMoney(usd) : null,
    kes: hasKes ? roundMoney(kes) : null,
    count: collected.length,
  }
}

/**
 * Signup time comes from auth.users. Role prefers auth app_metadata (not user-editable),
 * then the public.users.role the app stores. Newest signup first.
 */
export function mergeJoinedUsers(authUsers: AuthUserSource[], profiles: PublicUserSource[]): DashboardUser[] {
  const profilesById = new Map(profiles.map((profile) => [profile.id, profile]))
  const seen = new Set<string>()
  const merged: DashboardUser[] = []
  for (const authUser of authUsers) {
    if (!authUser.id || seen.has(authUser.id)) continue
    seen.add(authUser.id)
    const profile = profilesById.get(authUser.id)
    merged.push({
      id: authUser.id,
      email: text(authUser.email) ?? text(profile?.email),
      signed_up_at: authUser.created_at,
      role: text(authUser.app_role) ?? text(profile?.role) ?? 'trader',
    })
  }
  merged.sort((a, b) => {
    const at = Date.parse(a.signed_up_at)
    const bt = Date.parse(b.signed_up_at)
    const aOk = Number.isFinite(at)
    const bOk = Number.isFinite(bt)
    if (aOk && bOk && at !== bt) return bt - at
    if (aOk !== bOk) return aOk ? -1 : 1
    return a.id < b.id ? -1 : a.id > b.id ? 1 : 0
  })
  return merged
}
