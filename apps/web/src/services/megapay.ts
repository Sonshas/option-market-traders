import { getSupabase } from '@/lib/supabase'

/** Server-side MegaPay config returned by the megapay-deposit Edge Function (GET). */
export interface MegapayDepositConfig {
  enabled: boolean
  kesPerUsd: number
  minKes: number
  maxKes: number
  message: string | null
}

export interface MegapayDepositState {
  depositId: string
  reference: string | null
  status: 'PENDING' | 'PROCESSING' | 'COMPLETED' | 'FAILED' | 'CANCELLED'
  amountUsd: number
  amountKes: number
  receipt: string | null
  failureReason: string | null
}

export type Result<T> = { ok: true; data: T } | { ok: false; error: string }

export const UNAVAILABLE = 'Deposits temporarily unavailable'

export async function errorMessage(error: unknown): Promise<string> {
  const context = (error as { context?: Response } | null)?.context
  if (context && typeof context.json === 'function') {
    try {
      const body = (await context.clone().json()) as { error?: string; message?: string }
      if (body.error || body.message) return String(body.error ?? body.message)
    } catch {
      // fall through
    }
  }
  return UNAVAILABLE
}

export function mapState(raw: Record<string, unknown>): MegapayDepositState {
  return {
    depositId: String(raw.deposit_id),
    reference: (raw.reference as string | null) ?? null,
    status: String(raw.status) as MegapayDepositState['status'],
    amountUsd: Number(raw.amount_usd),
    amountKes: Number(raw.amount_kes),
    receipt: (raw.receipt as string | null) ?? null,
    failureReason: (raw.failure_reason as string | null) ?? null,
  }
}

export const megapayService = {
  async getConfig(): Promise<Result<MegapayDepositConfig>> {
    const client = getSupabase()
    if (!client) return { ok: false, error: UNAVAILABLE }
    const { data, error } = await client.functions.invoke<Record<string, unknown>>('megapay-deposit', { method: 'GET' })
    if (error || !data) return { ok: false, error: await errorMessage(error) }
    return {
      ok: true,
      data: {
        enabled: data.enabled === true,
        kesPerUsd: Number(data.kes_per_usd),
        minKes: Number(data.min_kes),
        maxKes: Number(data.max_kes),
        message: (data.message as string | null) ?? null,
      },
    }
  },

  async startDeposit(amountKes: number, phone: string): Promise<Result<MegapayDepositState>> {
    const client = getSupabase()
    if (!client) return { ok: false, error: UNAVAILABLE }
    const { data, error } = await client.functions.invoke<Record<string, unknown>>('megapay-deposit', {
      method: 'POST',
      body: { amount_kes: amountKes, phone },
    })
    if (error || !data) return { ok: false, error: await errorMessage(error) }
    return { ok: true, data: mapState(data) }
  },

  async checkStatus(depositId: string): Promise<Result<MegapayDepositState>> {
    const client = getSupabase()
    if (!client) return { ok: false, error: UNAVAILABLE }
    const { data, error } = await client.functions.invoke<Record<string, unknown>>('megapay-status', {
      method: 'POST',
      body: { deposit_id: depositId },
    })
    if (error || !data) return { ok: false, error: await errorMessage(error) }
    return { ok: true, data: mapState(data) }
  },
}
