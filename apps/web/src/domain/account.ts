import type { AccountMode, RealAccountStatus, RealAccountView, RealCapabilityMap } from '@/types'

export const DEMO_USER_ID = 'user_demo_local'
export const REAL_USER_ID = 'user_real_unlinked'
export const DEMO_ACCOUNT_ID = 'acct_demo_local'
export const REAL_ACCOUNT_ID = 'acct_real_unlinked'
export const DEMO_WALLET_ID = 'wallet_demo_local'
export const REAL_WALLET_ID = 'wallet_real_unlinked'

export const ACCOUNT_MODE_LABEL: Record<AccountMode, string> = {
  demo: 'DEMO ACCOUNT',
  real: 'REAL ACCOUNT',
}

export const REAL_STATUS_LABEL: Record<RealAccountStatus, string> = {
  NOT_CONNECTED: 'REAL ACCOUNT NOT CONNECTED',
  READY: 'REAL ACCOUNT READY',
  ACTIVE: 'REAL ACCOUNT ACTIVE',
  RESTRICTED: 'REAL ACCOUNT RESTRICTED',
}

export const REAL_UNAVAILABLE_TRADING = 'REAL TRADING EXECUTION NOT CONNECTED'
export const REAL_UNAVAILABLE_PAYMENTS = 'Real payments are currently unavailable.'
export const REAL_UNAVAILABLE_WITHDRAWALS = 'Real withdrawals are currently unavailable.'
export const REAL_UNAVAILABLE_BOTS = 'Real bots unavailable.'
export const REAL_UNAVAILABLE_COPY = 'N/A — real copy trading is not connected.'
export const LIVE_MARKET_UNAVAILABLE = 'Live market data unavailable.'
/** Shown when a REAL wallet row cannot be read safely — never invent an amount. */
export const REAL_BALANCE_PLACEHOLDER = '—'
export const REAL_BALANCE_LOADING = 'Loading…'

/** Shown for missing profile/account fields — never invent placeholder identities or money. */
export const NOT_AVAILABLE = 'Not available'

export type AuthConnectionStatus = 'CONNECTED' | 'NOT CONNECTED'

export function authConnectionStatus(isSignedIn: boolean): AuthConnectionStatus {
  return isSignedIn ? 'CONNECTED' : 'NOT CONNECTED'
}

export function displayOrUnavailable(value: string | null | undefined): string {
  const trimmed = value?.trim()
  return trimmed ? trimmed : NOT_AVAILABLE
}

export const SIMULATED_FEED_LABEL = 'SIMULATED / DEV MARKET DATA'
export const REAL_TRADE_LABEL = 'REAL ACCOUNT'

export const REAL_NEEDS_EXPLANATION =
  'Live REAL functionality needs a legitimate backend, market-data provider, trade-execution engine, payment provider, and compliance (KYC/AML) stack. None of those are connected. SmartBaseBinary will not invent real balances, prices, or trade results.'

export const REAL_COMING_SOON = 'Coming soon'

export function isDemoMode(mode: AccountMode): boolean {
  return mode === 'demo'
}

export function isRealMode(mode: AccountMode): boolean {
  return mode === 'real'
}

export function accountModeLabel(mode: AccountMode): string {
  return ACCOUNT_MODE_LABEL[mode]
}

export function deriveRealStatus(capabilities: RealCapabilityMap): RealAccountStatus {
  if (!capabilities.backendConfigured) return 'NOT_CONNECTED'
  if (!capabilities.complianceConfigured) return 'RESTRICTED'
  if (
    capabilities.marketDataConfigured &&
    capabilities.executionConfigured &&
    capabilities.paymentConfigured
  ) {
    return 'READY'
  }
  return 'RESTRICTED'
}

export function realTradingEnabled(capabilities: RealCapabilityMap): boolean {
  return (
    capabilities.backendConfigured &&
    capabilities.executionConfigured &&
    capabilities.marketDataConfigured &&
    capabilities.complianceConfigured
  )
}

export function realPaymentsEnabled(capabilities: RealCapabilityMap): boolean {
  return capabilities.backendConfigured && capabilities.paymentConfigured && capabilities.complianceConfigured
}

/** M-Pesa deposits are additionally gated server-side by REAL_PAYMENTS_ENABLED and the MegaPay secrets. */
export function realDepositsEnabled(capabilities: RealCapabilityMap): boolean {
  return capabilities.backendConfigured && capabilities.depositsConfigured
}

/** M-Pesa withdrawals: the server holds the amount on request and completes only after the payout is confirmed. */
export function realWithdrawalsEnabled(capabilities: RealCapabilityMap): boolean {
  return capabilities.backendConfigured && capabilities.withdrawalsConfigured
}

export function buildRealAccountView(capabilities: RealCapabilityMap): RealAccountView {
  const status = deriveRealStatus(capabilities)
  return {
    status,
    label: REAL_STATUS_LABEL[status],
    // Balance is overlaid by useWallet with the authentic Supabase amount when available.
    balanceDisplay: 'NOT CONNECTED',
    marketData: capabilities.marketDataConfigured ? 'CONNECTED' : 'NOT CONNECTED',
    tradingExecution: 'NOT CONNECTED',
    deposits: 'NOT CONNECTED',
    withdrawals: 'NOT CONNECTED',
    explanation: capabilities.marketDataConfigured
      ? 'REAL market data may be live for charts and prices. REAL order execution, deposits, withdrawals, and settlement stay disabled until a verified execution stack is wired. Connecting a chart does not authorize real-money trading.'
      : REAL_NEEDS_EXPLANATION,
  }
}
