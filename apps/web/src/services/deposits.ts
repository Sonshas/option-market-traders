import { parseDepositProvider, type DepositProvider } from '@/domain/daraja'
import {
  megapayService,
  type MegapayDepositConfig,
  type MegapayDepositState,
  type Result,
} from '@/services/megapay'

/**
 * REAL M-Pesa deposits via MegaPay. Daraja deposit functions stay deployed only as a
 * disabled fallback; the live site always uses megapay-deposit / megapay-status.
 */
export interface DepositConfig extends MegapayDepositConfig {
  provider: DepositProvider
  /** M-Pesa Till shown to the member (MegaPay). Daraja used Paybill. */
  till: string | null
  paybill: string | null
}

export type DepositState = MegapayDepositState

export function resolveDepositProvider(raw: unknown): DepositProvider {
  const provider = raw && typeof raw === 'object' ? (raw as Record<string, unknown>).provider : undefined
  return typeof provider === 'string' ? parseDepositProvider(provider) : 'megapay'
}

export function depositMethodLabel(config: Pick<DepositConfig, 'provider' | 'till' | 'paybill'>): string {
  if (config.provider === 'megapay' && config.till) return `M-Pesa (Till ${config.till})`
  if (config.provider === 'daraja' && config.paybill) return `M-Pesa (Paybill ${config.paybill})`
  return 'M-Pesa'
}

export const depositService = {
  async getConfig(): Promise<Result<DepositConfig>> {
    const fallback = await megapayService.getConfig()
    if (!fallback.ok) return fallback
    return {
      ok: true,
      data: {
        ...fallback.data,
        provider: 'megapay',
        till: fallback.data.till ?? null,
        paybill: null,
      },
    }
  },

  async startDeposit(_provider: DepositProvider, amountKes: number, phone: string): Promise<Result<DepositState>> {
    return megapayService.startDeposit(amountKes, phone)
  },

  async checkStatus(_provider: DepositProvider, depositId: string): Promise<Result<DepositState>> {
    return megapayService.checkStatus(depositId)
  },
}
