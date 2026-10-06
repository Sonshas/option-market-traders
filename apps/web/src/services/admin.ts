import { BOT_CATALOG, COPY_TRADER_PLACEHOLDERS } from '@/lib/constants'
import { loadDemoState } from '@/lib/demo-store'
import { okDemo } from '@/providers/results'
import { disconnected, uiPause } from '@/services/status'
import type {
  AuditLogEntry,
  Bot,
  CopyTrader,
  Deposit,
  DisconnectedResult,
  ProviderResult,
  SupportTicket,
  SystemSetting,
  Trade,
  Transaction,
  User,
  Wallet,
  Withdrawal,
} from '@/types'

/**
 * Admin UI. Inspects LOCAL DEMO data only. REAL tabs stay empty / NOT_CONNECTED.
 * Never fabricates completed real deposits or withdrawals.
 */
export const adminService = {
  async listUsers(): Promise<DisconnectedResult<User[]>> {
    await uiPause()
    return disconnected([])
  },

  async listAccounts(): Promise<DisconnectedResult<Wallet[]>> {
    await uiPause()
    return disconnected([])
  },

  async listDeposits(): Promise<ProviderResult<Deposit[]>> {
    await uiPause()
    return okDemo(loadDemoState().deposits, 'LOCAL DEMO deposits only. REAL deposits are never listed here.')
  },

  async listWithdrawals(): Promise<ProviderResult<Withdrawal[]>> {
    await uiPause()
    return okDemo(loadDemoState().withdrawals, 'LOCAL DEMO withdrawals only. REAL withdrawals are never listed here.')
  },

  async listTrades(): Promise<ProviderResult<Trade[]>> {
    await uiPause()
    return okDemo(loadDemoState().trades, 'LOCAL DEMO trades only. REAL trades stay empty until an engine connects.')
  },

  async listTransactions(): Promise<ProviderResult<Transaction[]>> {
    await uiPause()
    return okDemo(loadDemoState().transactions, 'LOCAL DEMO ledger / transactions only.')
  },

  async listTickets(): Promise<ProviderResult<SupportTicket[]>> {
    await uiPause()
    return okDemo(loadDemoState().tickets, 'LOCAL DEMO support tickets.')
  },

  async listBots(): Promise<DisconnectedResult<Bot[]>> {
    await uiPause()
    return disconnected(BOT_CATALOG, 'Local catalog preview only.')
  },

  async listCopyTraders(): Promise<DisconnectedResult<CopyTrader[]>> {
    await uiPause()
    return disconnected(COPY_TRADER_PLACEHOLDERS, 'Placeholder/demo records only.')
  },

  async listSettings(): Promise<DisconnectedResult<SystemSetting[]>> {
    await uiPause()
    return disconnected([
      { key: 'LIVE_TRADING_ENABLED', label: 'Live trading', value: 'not connected', note: 'Feature flag UI only.' },
      { key: 'MARKET_DATA', label: 'Market data provider', value: 'binance public (when configured)', note: 'Charts/prices only — execution stays disabled.' },
      { key: 'PAYMENTS', label: 'Payments', value: 'not connected', note: 'No real-money rails.' },
      { key: 'AUTH', label: 'Authentication', value: 'Supabase Auth', note: 'signUp / signInWithPassword / session restore wired.' },
    ])
  },

  async listAuditLogs(): Promise<DisconnectedResult<AuditLogEntry[]>> {
    await uiPause()
    return disconnected([])
  },
}
