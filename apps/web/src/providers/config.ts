import type { RealCapabilityMap } from '@/types'
import { isMarketDataProviderConfigured } from '@/providers/market-data/env'

/**
 * Real-money integration flags.
 *
 * Market data may be enabled (public Binance feed) without enabling execution.
 * Never flip execution/payment/compliance in the frontend alone to "activate"
 * real-money trading.
 *
 * backendConfigured=true: Supabase Auth + REAL wallet/ledger reads are wired.
 */
export const REAL_INTEGRATION: RealCapabilityMap = {
  backendConfigured: true,
  get marketDataConfigured() {
    return isMarketDataProviderConfigured()
  },
  executionConfigured: false,
  paymentConfigured: false,
  /** DEMO-only site: no new REAL deposits; withdrawals stay on so existing REAL balances can be paid out. */
  depositsConfigured: false,
  withdrawalsConfigured: true,
  complianceConfigured: false,
}

export const DEMO_STARTING_BALANCE = 10_000
export const DEMO_STORAGE_KEY = 'sbb.demo.v1'
export const DEMO_SESSION_KEY = 'sbb.demo.session'
export const ACCOUNT_MODE_STORAGE_KEY = 'sbb.accountMode'
