import type { AutoAccount } from '@/domain/auto-trade'
import type { DigitContractSelection } from '@/domain/digit-contracts'
import { loadDemoState } from '@/lib/demo-store'
import { notifyRealWalletChanged } from '@/lib/real-wallet-events'
import { demoTradingProvider, settleDemoTrades } from '@/providers/trading/demo-trading-provider'
import { realTradingProvider } from '@/providers/trading/real-trading-provider'
import { walletService } from '@/services/wallet'
import type { Trade } from '@/types'

/** Account execution layer for Auto Trade: one executor per account, never mixed. */

export const REAL_CONNECTION_INACTIVE = 'Real trading is unavailable because the live trading connection is not active.'

export interface AutoOrder {
  account: AutoAccount
  symbol: string
  selection: DigitContractSelection
  stake: number
  durationTicks: number
  runId: string
  /** REAL: reused when the same order is retried so the server opens it at most once. */
  idempotencyKey: string
}

export type ExecutionErrorCode =
  | 'MODE_MISMATCH'
  /** No fresh live price yet — the same order may be retried shortly. */
  | 'RETRY'
  | 'INSUFFICIENT_FUNDS'
  | 'UNAVAILABLE'
  | 'REJECTED'

export type ExecutionResult = { ok: true; trade: Trade } | { ok: false; code: ExecutionErrorCode; message: string }

export interface AccountExecutor {
  readonly account: AutoAccount
  /** Available balance of this account, or null when it cannot be read. */
  getBalance(): Promise<number | null>
  execute(order: AutoOrder): Promise<ExecutionResult>
  /** Current authoritative state of a trade placed by this executor (null if not found / unreadable). */
  getTrade(tradeId: string): Promise<Trade | null>
}

export interface Executors {
  demo: AccountExecutor
  real: AccountExecutor
}

function mismatch(selected: AutoAccount, executor: AutoAccount | string): ExecutionResult {
  return {
    ok: false,
    code: 'MODE_MISMATCH',
    message: `Blocked: the ${executor} executor cannot place a trade while ${selected} is selected.`,
  }
}

export async function executeDemoTrade(executor: AccountExecutor, order: AutoOrder): Promise<ExecutionResult> {
  if (executor.account !== 'DEMO' || order.account !== 'DEMO') return mismatch('DEMO', executor.account)
  return executor.execute(order)
}

export async function executeRealTrade(executor: AccountExecutor, order: AutoOrder): Promise<ExecutionResult> {
  if (executor.account !== 'REAL' || order.account !== 'REAL') return mismatch('REAL', executor.account)
  return executor.execute(order)
}

/** The only entry point Auto Trade uses to place a trade: routes strictly by the selected mode. */
export async function executeTrade(mode: AutoAccount, executors: Executors, order: AutoOrder): Promise<ExecutionResult> {
  if (order.account !== mode) return mismatch(mode, order.account)
  if (mode === 'DEMO') return executeDemoTrade(executors.demo, order)
  else if (mode === 'REAL') return executeRealTrade(executors.real, order)
  return mismatch(mode, 'unknown')
}

export function executorFor(mode: AutoAccount, executors: Executors): AccountExecutor {
  const executor = mode === 'REAL' ? executors.real : executors.demo
  if (executor.account !== mode) throw new Error(`Executor mismatch: ${executor.account} for ${mode}`)
  return executor
}

export const demoExecutor: AccountExecutor = {
  account: 'DEMO',
  async getBalance() {
    return loadDemoState().wallet.availableBalance ?? 0
  },
  async execute(order) {
    const result = await demoTradingProvider.placeTrade({
      symbol: order.symbol,
      ...order.selection,
      stake: order.stake,
      durationMs: 0,
      durationTicks: order.durationTicks,
      kind: 'demo',
      accountMode: 'demo',
      botRunId: order.runId,
    })
    if (result.connected && result.data) return { ok: true, trade: result.data }
    const code = 'code' in result ? result.code : undefined
    if (code === 'LIVE_MARKET_DATA_UNAVAILABLE') return { ok: false, code: 'RETRY', message: result.message }
    if (code === 'INSUFFICIENT_FUNDS') return { ok: false, code: 'INSUFFICIENT_FUNDS', message: 'Insufficient DEMO balance' }
    return { ok: false, code: 'REJECTED', message: result.message }
  },
  async getTrade(tradeId) {
    settleDemoTrades()
    return loadDemoState().trades.find((trade) => trade.id === tradeId) ?? null
  },
}

const REAL_RETRY = /moved on before your trade|Live price is unavailable/i
const REAL_UNAVAILABLE = /^(Sign in to trade\.|Real trading is temporarily unavailable\.)$/

export const realExecutor: AccountExecutor = {
  account: 'REAL',
  async getBalance() {
    const result = await walletService.getWallet('real')
    const wallet = result.data
    if (!result.connected || !wallet || wallet.isSimulated || wallet.availableBalance == null) return null
    return wallet.availableBalance
  },
  async execute(order) {
    const result = await realTradingProvider.placeTrade({
      symbol: order.symbol,
      ...order.selection,
      stake: order.stake,
      durationMs: 0,
      durationTicks: order.durationTicks,
      kind: 'real',
      accountMode: 'real',
      idempotencyKey: order.idempotencyKey,
    })
    if (result.connected && result.data && !result.data.isSimulated && result.data.accountMode === 'real') {
      return { ok: true, trade: result.data }
    }
    const message = result.message || REAL_CONNECTION_INACTIVE
    if (REAL_RETRY.test(message)) return { ok: false, code: 'RETRY', message }
    if (/Insufficient REAL balance/i.test(message)) return { ok: false, code: 'INSUFFICIENT_FUNDS', message }
    if (REAL_UNAVAILABLE.test(message)) return { ok: false, code: 'UNAVAILABLE', message: REAL_CONNECTION_INACTIVE }
    return { ok: false, code: 'REJECTED', message }
  },
  async getTrade(tradeId) {
    const result = await realTradingProvider.getTradeStatus(tradeId, 'real')
    const trade = result.connected ? result.data : null
    if (trade && trade.status !== 'open') notifyRealWalletChanged()
    return trade && !trade.isSimulated ? trade : null
  },
}

export const ACCOUNT_EXECUTORS: Executors = { demo: demoExecutor, real: realExecutor }
