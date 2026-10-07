import { getSupabase } from '@/lib/supabase'
import type { Result } from '@/services/megapay'

/**
 * Staff read of joined users and real M-Pesa deposits.
 * The admin-dashboard Edge Function checks app_metadata.role (admin, superadmin, finance)
 * and reads with the service role. This client never writes deposits, wallets, or users.
 */

const FUNCTION = 'admin-dashboard'

export interface DashboardUserRow {
  id: string
  email: string | null
  signedUpAt: string
  role: string
}

export interface DashboardDepositRow {
  id: string
  userId: string
  userEmail: string | null
  amountUsd: number | null
  amountKes: number | null
  status: string
  provider: string | null
  receipt: string | null
  createdAt: string
  creditedAt: string | null
}

export interface AdminDashboard {
  users: DashboardUserRow[]
  collected: DashboardDepositRow[]
  other: DashboardDepositRow[]
  totals: {
    collectedUsd: number | null
    collectedKes: number | null
    collectedCount: number
    userCount: number
  }
}

async function functionError(error: unknown): Promise<string> {
  const context = (error as { context?: Response } | null)?.context
  if (context && typeof context.json === 'function') {
    try {
      const body = (await context.clone().json()) as { error?: string; message?: string }
      if (body.error || body.message) return String(body.error ?? body.message)
    } catch {
      // fall through
    }
  }
  return 'Could not load the dashboard.'
}

function text(value: unknown): string | null {
  return typeof value === 'string' && value ? value : null
}

function money(value: unknown): number | null {
  if (value == null || value === '') return null
  const n = Number(value)
  return Number.isFinite(n) ? n : null
}

function mapUser(raw: Record<string, unknown>): DashboardUserRow | null {
  const id = text(raw.id)
  if (!id) return null
  return {
    id,
    email: text(raw.email),
    signedUpAt: text(raw.signed_up_at) ?? '',
    role: text(raw.role) ?? 'trader',
  }
}

function mapDeposit(raw: Record<string, unknown>): DashboardDepositRow | null {
  const id = text(raw.id)
  if (!id) return null
  return {
    id,
    userId: text(raw.user_id) ?? '',
    userEmail: text(raw.user_email),
    amountUsd: money(raw.amount_usd),
    amountKes: money(raw.amount_kes),
    status: text(raw.status) ?? '',
    provider: text(raw.provider),
    receipt: text(raw.receipt),
    createdAt: text(raw.created_at) ?? '',
    creditedAt: text(raw.credited_at),
  }
}

function mapList(value: unknown, map: (raw: Record<string, unknown>) => DashboardDepositRow | null): DashboardDepositRow[] {
  if (!Array.isArray(value)) return []
  return value.flatMap((row) => {
    if (!row || typeof row !== 'object') return []
    const mapped = map(row as Record<string, unknown>)
    return mapped ? [mapped] : []
  })
}

export const adminDashboardService = {
  async load(): Promise<Result<AdminDashboard>> {
    const client = getSupabase()
    if (!client) return { ok: false, error: 'This service is temporarily unavailable.' }
    const { data, error } = await client.functions.invoke<Record<string, unknown>>(FUNCTION, {
      method: 'POST',
      body: { action: 'overview' },
    })
    if (error || !data) return { ok: false, error: await functionError(error) }
    const totals = data.totals && typeof data.totals === 'object' ? (data.totals as Record<string, unknown>) : {}
    const users = Array.isArray(data.users)
      ? data.users.flatMap((row) => {
          if (!row || typeof row !== 'object') return []
          const mapped = mapUser(row as Record<string, unknown>)
          return mapped ? [mapped] : []
        })
      : []
    return {
      ok: true,
      data: {
        users,
        collected: mapList(data.collected, mapDeposit),
        other: mapList(data.other, mapDeposit),
        totals: {
          collectedUsd: money(totals.collected_usd),
          collectedKes: money(totals.collected_kes),
          collectedCount: Number(totals.collected_count ?? 0) || 0,
          userCount: Number(totals.user_count ?? users.length) || users.length,
        },
      },
    }
  },
}
