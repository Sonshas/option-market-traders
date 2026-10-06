/**
 * Application-level TypeScript interfaces for SmartBaseBinary.
 *
 * These are database-ready domain shapes for a future backend. They are not a
 * live database schema and must not be applied to Supabase or any remote DB.
 *
 * DEMO and REAL financial records are never mixed. Every financial row carries
 * userId, accountId, accountMode, createdAt, and updatedAt.
 */

export type UserRole =
  | 'trader'
  | 'admin'
  | 'support'
  | 'finance'
  | 'compliance'
  | 'superadmin'

export type AccountStatus = 'active' | 'suspended' | 'restricted'
export type AccountMode = 'demo' | 'real'
/** @deprecated Use AccountMode. Alias kept while screens migrate from demo/live wording. */
export type WalletKind = AccountMode

export type RealAccountStatus = 'NOT_CONNECTED' | 'READY' | 'ACTIVE' | 'RESTRICTED'
export type KycStatus = 'not_started' | 'pending' | 'under_review' | 'approved' | 'rejected'
export type ConnectionStatus =
  | 'disconnected'
  | 'connecting'
  | 'reconnecting'
  | 'live'
  | 'error'
  | 'simulated'
export type ServiceStatus = 'not_connected' | 'empty' | 'ready'

export type TransactionStatus = 'PENDING' | 'PROCESSING' | 'COMPLETED' | 'FAILED' | 'CANCELLED'
/** @deprecated Use TransactionStatus. */
export type PaymentStatus = 'pending' | 'confirmed' | 'failed' | TransactionStatus

export type TransactionType =
  | 'deposit'
  | 'withdrawal'
  | 'trade_stake'
  | 'trade_payout'
  | 'trade_refund'
  | 'adjustment'

export type LedgerEntryType =
  | TransactionType
  | 'bot_stake'
  | 'copy_stake'
  | 'withdrawal_hold'
  | 'withdrawal_paid'
  | 'withdrawal_refund'

/** Primary DEMO/REAL contract families — not CALL/PUT. */
export type ContractType = 'EVEN_ODD' | 'MATCH_DIFFER' | 'OVER_UNDER'
export type ContractOption = 'even' | 'odd' | 'match' | 'differ' | 'over' | 'under'
/** @deprecated Prefer ContractOption. Kept for any legacy call sites. */
export type TradeSide = ContractOption | 'call' | 'put'
export type TradeStatus = 'open' | 'won' | 'lost' | 'tie' | 'cancelled'
export type TradeResultOutcome = 'win' | 'loss' | 'tie'
export type BotRiskLevel = 'low' | 'medium' | 'high'
export type BotRunStatus = 'idle' | 'running' | 'stopped' | 'not_connected'
export type SupportTicketStatus = 'open' | 'closed'
export type NotificationKind = 'system' | 'trading' | 'wallet' | 'security'
export type Timeframe = '1m' | '5m' | '15m' | '30m' | '1h' | '4h' | '1d'

export type ProviderErrorCode =
  | 'NOT_CONNECTED'
  | 'REAL_TRADING_UNAVAILABLE'
  | 'REAL_PAYMENTS_UNAVAILABLE'
  | 'LIVE_MARKET_DATA_UNAVAILABLE'
  | 'REAL_BOTS_UNAVAILABLE'
  | 'REAL_COPY_UNAVAILABLE'
  | 'CROSS_MODE_FORBIDDEN'
  | 'INSUFFICIENT_FUNDS'
  | 'VALIDATION'

export interface FinancialRecord {
  id: string
  userId: string
  accountId: string
  accountMode: AccountMode
  createdAt: string
  updatedAt: string
}

export interface User {
  id: string
  email: string
  name: string
  role: UserRole
  accountStatus: AccountStatus
  liveTradingEnabled: boolean
  kycStatus: KycStatus
  createdAt: string
  updatedAt: string
}

export interface Account {
  id: string
  userId: string
  accountMode: AccountMode
  status: AccountStatus
  createdAt: string
  updatedAt: string
}

export interface Profile {
  userId: string
  displayName: string
  email: string
  timezone: string
  twoFactorEnabled: boolean
}

export interface Wallet extends FinancialRecord {
  currency: string
  /**
   * REAL: null until an authoritative backend ledger responds.
   * DEMO: simulated virtual balance only. Never treat as real money.
   */
  balance: number | null
  availableBalance: number | null
  lockedBalance: number | null
  status: ServiceStatus
  isSimulated: boolean
  kind: AccountMode
}

export interface WalletLedger extends FinancialRecord {
  walletId: string
  entryType: LedgerEntryType
  amount: number
  balanceAfter: number | null
  referenceId: string | null
  note: string | null
  isSimulated: boolean
}

export interface Transaction extends FinancialRecord {
  walletId: string
  type: TransactionType
  amount: number
  currency: string
  status: TransactionStatus
  reference: string | null
  note: string | null
  isSimulated: boolean
}

export interface Deposit extends FinancialRecord {
  walletId: string
  amount: number
  currency: string
  method: string
  status: TransactionStatus
  isSimulated: boolean
  walletKind: AccountMode
  provider?: string | null
  reference?: string | null
  amountKes?: number | null
  failureReason?: string | null
}

export interface Withdrawal extends FinancialRecord {
  walletId: string
  amount: number
  currency: string
  destination: string
  status: TransactionStatus
  isSimulated: boolean
  walletKind: AccountMode
  /** REAL M-Pesa payouts: 'manual' (admin pays from the business M-Pesa) or 'daraja_b2c'. */
  provider?: string | null
  reference?: string | null
  amountKes?: number | null
  feeKes?: number | null
  netKes?: number | null
  /** Normalised 2547XXXXXXXX / 2541XXXXXXXX. */
  msisdn?: string | null
  receipt?: string | null
  failureReason?: string | null
  processingAt?: string | null
  completedAt?: string | null
  failedAt?: string | null
}

export interface Market {
  symbol: string
  displayName: string
  category: 'synthetic' | 'forex' | 'crypto'
  contractKinds: ContractType[]
  durationsMs: number[]
  lastPrice: number | null
  priceStatus: ConnectionStatus
  feedLabel: string
  isSimulated: boolean
  favorite?: boolean
  /** Provider sub-market (Deriv `active_symbols.submarket`, e.g. `random_index` = volatility indices). */
  submarket?: string
  /** Quote precision from the provider (e.g. 0.01). */
  pipSize?: number
}

export interface Candle {
  time: number
  open: number
  high: number
  low: number
  close: number
}

export interface Tick {
  symbol: string
  price: number
  timestamp: number
  isSimulated: boolean
  feedLabel: string
  bid?: number | null
  ask?: number | null
  /** Provider epoch seconds when available (REAL Deriv ticks). */
  epoch?: number
  /** Provider pip size used for digit extraction — never invent. */
  pipSize?: number
  /** Final displayed digit from quote÷pipSize; null if not derivable. */
  lastDigit?: number | null
}

export interface Quote extends FinancialRecord {
  symbol: string
  contractType: ContractType | null
  contractOption: ContractOption | null
  stake: number
  durationMs: number
  payoutRate: number | null
  potentialReturn: number | null
  potentialLoss: number | null
  available: boolean
  message: string
  isSimulated: boolean
  expiresAt: string | null
}

/** Ticket helper kept for existing trade UI. */
export interface ContractQuote {
  payoutRate: number | null
  potentialReturn: number | null
  potentialLoss: number | null
  available: boolean
  message: string
  isSimulated: boolean
  accountMode: AccountMode
}

export interface Trade extends FinancialRecord {
  walletId: string
  /** Market symbol (also exposed as `market` for demo trade records). */
  symbol: string
  market: string
  contractType: ContractType
  contractOption: ContractOption
  /** Digit 0–9 for MATCH/DIFFER. */
  selectedDigit: number | null
  /** Barrier digit 0–9 for OVER/UNDER. */
  barrier: number | null
  stake: number
  durationMs: number
  duration: number
  payoutRate: number | null
  status: TradeStatus
  /** Alias of status for demo trade records. */
  result: TradeStatus
  entryPrice: number | null
  exitPrice: number | null
  payout: number | null
  profitLoss: number | null
  expiresAt: string | null
  resolvedAt: string | null
  isSimulated: boolean
  walletKind: AccountMode
  /** Last digit of the genuine exit tick (quote ÷ pip size). */
  exitDigit?: number | null
  /** DEMO bot run that opened this trade, if any. */
  botRunId?: string | null
  /** Tick contracts: settles on this many ticks after `tickAnchorMs`; null/undefined for legacy time-based trades. */
  durationTicks?: number | null
  /** Deriv epoch (ms) of the entry tick. */
  entryEpochMs?: number | null
  /** Ticks are counted strictly after this Deriv epoch (ms). */
  tickAnchorMs?: number | null
}

export interface TradeSettlement extends FinancialRecord {
  tradeId: string
  outcome: TradeResultOutcome
  exitPrice: number | null
  payout: number | null
  profitLoss: number | null
  isSimulated: boolean
}

export interface TradeResult {
  tradeId: string
  outcome: TradeResultOutcome
  exitPrice: number | null
  payout: number | null
  closedAt: string
}

export interface Bot {
  id: string
  name: string
  marketSymbol: string
  description: string
  historicalPerformance: string
  riskLevel: BotRiskLevel
  defaultStake: number
  takeProfit: number | null
  stopLoss: number | null
  maxRuns: number
  lossStreakLimit: number
  accountMode?: AccountMode
  isSimulated?: boolean
}

export interface BotRun extends FinancialRecord {
  botId: string
  status: BotRunStatus
  stake: number
  takeProfit: number | null
  stopLoss: number | null
  maxRuns: number
  lossStreakLimit: number
  startedAt: string | null
  stoppedAt: string | null
  note: string
  isSimulated: boolean
  tradesPlaced: number
  realizedPnl: number | null
  wins?: number
  losses?: number
  lossStreak?: number
  stopReason?: string | null
}

export interface CopyTrader {
  id: string
  displayName: string
  handle: string
  recordKind: 'placeholder' | 'simulated_demo' | 'verified'
  historicalRoi: string
  historicalWinRate: string
  historicalPnl: string
  riskLevel: BotRiskLevel
  tradeCount: string
  style: string
  accountMode?: AccountMode
  isSimulated?: boolean
}

export interface CopyTrade extends FinancialRecord {
  copyTraderId: string
  allocation: number | null
  maxDailyLoss: number | null
  status: 'inactive' | 'active' | 'not_connected'
  isSimulated: boolean
}

export interface Notification extends FinancialRecord {
  kind: NotificationKind
  title: string
  body: string
  read: boolean
  isSimulated: boolean
}

export interface SupportTicket extends FinancialRecord {
  subject: string
  message: string
  status: SupportTicketStatus
}

export interface AuditLog {
  id: string
  userId: string
  accountId: string | null
  accountMode: AccountMode | null
  actorEmail: string
  action: string
  targetType: string
  targetId: string
  createdAt: string
  updatedAt: string
}

export interface AuditLogEntry {
  id: string
  actorEmail: string
  action: string
  targetType: string
  targetId: string
  createdAt: string
}

export interface SystemSetting {
  key: string
  label: string
  value: string
  note: string
}

export interface DisconnectedResult<T> {
  status: ServiceStatus
  connected: false
  message: string
  data: T
  code?: ProviderErrorCode
  accountMode?: AccountMode
  isSimulated?: boolean
}

export interface ConnectedResult<T> {
  status: 'ready'
  connected: true
  message: string
  data: T
  accountMode: AccountMode
  isSimulated: boolean
}

export type ProviderResult<T> = ConnectedResult<T> | DisconnectedResult<T>

export interface MarketSnapshot {
  status: ConnectionStatus
  candles: Candle[]
  lastTick: Tick | null
  note: string
  isSimulated: boolean
  feedLabel: string
  bid?: number | null
  ask?: number | null
  lastUpdateAt?: number | null
}

export interface PlaceTradeInput {
  symbol: string
  contractType: ContractType
  contractOption: ContractOption
  selectedDigit?: number | null
  barrier?: number | null
  stake: number
  /** Legacy time-based duration; ignored when `durationTicks` is set. */
  durationMs: number
  /** Tick duration 1–10 (current ticket). */
  durationTicks?: number | null
  kind: AccountMode
  accountMode?: AccountMode
  botRunId?: string | null
  /** REAL only: reused when the same order is retried so the server opens it at most once. */
  idempotencyKey?: string
}

export interface RealCapabilityMap {
  backendConfigured: boolean
  marketDataConfigured: boolean
  executionConfigured: boolean
  paymentConfigured: boolean
  /** REAL M-Pesa deposits (Daraja STK Push / MegaPay, server-side). */
  depositsConfigured: boolean
  /** REAL M-Pesa withdrawals (hold on request; completed only after the payout is confirmed). */
  withdrawalsConfigured: boolean
  complianceConfigured: boolean
}

export interface RealAccountView {
  status: RealAccountStatus
  label: string
  balanceDisplay: string
  marketData: string
  tradingExecution: string
  deposits: string
  withdrawals: string
  explanation: string
}
