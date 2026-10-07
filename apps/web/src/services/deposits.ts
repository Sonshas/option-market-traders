import { DEFAULT_DEPOSIT_PROVIDER, parseDepositProvider, type DepositProvider } from '@/domain/daraja'
import { getSupabase } from '@/lib/supabase'
import {
  UNAVAILABLE,
  errorMessage,
  mapState,
  megapayService,
  type MegapayDepositConfig,
  type MegapayDepositState,
  type Result,
} from '@/services/megapay'

/**
 * REAL M-Pesa deposits. The active provider comes from the DEPOSIT_PROVIDER Edge Function secret
 * (reported by mpesa-deposit GET), so switching between Daraja and MegaPay needs no web deploy.
 */
export interface DepositConfig extends MegapayDepositConfig {
  provider: DepositProvider
  paybill: string | null
}

export type DepositState = MegapayDepositState

const DARAJA_FUNCTIONS = { start: 'mpesa-deposit', status: 'mpesa-status' } as const

export function resolveDepositProvider(raw: unknown): DepositProvider {
  const provider = raw && typeof raw === 'object' ? (raw as Record<string, unknown>).provider : undefined
  return typeof provider === 'string' ? parseDepositProvider(provider) : DEFAULT_DEPOSIT_PROVIDER
}

export function depositMethodLabel(config: Pick<DepositConfig, 'provider' | 'paybill'>): string {
  return config.provider === 'daraja' && config.paybill ? `M-Pesa (Paybill ${config.paybill})` : 'M-Pesa'
}

export const depositService = {
  async getConfig(): Promise<Result<DepositConfig>> {
    const client = getSupabase()
    if (!client) return { ok: false, error: UNAVAILABLE }
    const { data, error } = await client.functions.invoke<Record<string, unknown>>(DARAJA_FUNCTIONS.start, { method: 'GET' })
    if (error || !data) return { ok: false, error: await errorMessage(error) }

    if (resolveDepositProvider(data) === 'megapay') {
      const fallback = await megapayService.getConfig()
      return fallback.ok ? { ok: true, data: { ...fallback.data, provider: 'megapay', paybill: null } } : fallback
    }
    const quick = Array.isArray(data.quick_amounts)
      ? data.quick_amounts.map((n) => Number(n)).filter((n) => Number.isInteger(n) && n > 0)
      : undefined
    return {
      ok: true,
      data: {
        provider: 'daraja',
        paybill: typeof data.paybill === 'string' && data.paybill ? data.paybill : null,
        enabled: data.enabled === true,
        kesPerUsd: Number(data.kes_per_usd),
        minKes: Number(data.min_kes),
        maxKes: Number(data.max_kes),
        quickAmounts: quick && quick.length ? quick : undefined,
        message: (data.message as string | null) ?? null,
      },
    }
  },

  async startDeposit(provider: DepositProvider, amountKes: number, phone: string): Promise<Result<DepositState>> {
    if (provider === 'megapay') return megapayService.startDeposit(amountKes, phone)
    const client = getSupabase()
    if (!client) return { ok: false, error: UNAVAILABLE }
    const { data, error } = await client.functions.invoke<Record<string, unknown>>(DARAJA_FUNCTIONS.start, {
      method: 'POST',
      body: { amount_kes: amountKes, phone },
    })
    if (error || !data) return { ok: false, error: await errorMessage(error) }
    return { ok: true, data: mapState(data) }
  },

  async checkStatus(provider: DepositProvider, depositId: string): Promise<Result<DepositState>> {
    if (provider === 'megapay') return megapayService.checkStatus(depositId)
    const client = getSupabase()
    if (!client) return { ok: false, error: UNAVAILABLE }
    const { data, error } = await client.functions.invoke<Record<string, unknown>>(DARAJA_FUNCTIONS.status, {
      method: 'POST',
      body: { deposit_id: depositId },
    })
    if (error || !data) return { ok: false, error: await errorMessage(error) }
    return { ok: true, data: mapState(data) }
  },
}
