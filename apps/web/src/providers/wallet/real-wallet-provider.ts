import {
  REAL_ACCOUNT_ID,
  REAL_UNAVAILABLE_PAYMENTS,
  REAL_UNAVAILABLE_WITHDRAWALS,
  REAL_USER_ID,
  REAL_WALLET_ID,
  buildRealAccountView,
} from '@/domain/account'
import { nowIso } from '@/lib/ids'
import { getSupabase, isSupabaseConfigured } from '@/lib/supabase'
import { REAL_INTEGRATION } from '@/providers/config'
import { notConnected, okReal } from '@/providers/results'
import type {
  AccountMode,
  Deposit,
  Transaction,
  TransactionStatus,
  TransactionType,
  Wallet,
  Withdrawal,
} from '@/types'
import type { WalletProvider } from '@/providers/wallet/demo-wallet-provider'

function num(value: unknown): number {
  const n = typeof value === 'number' ? value : Number(value)
  return Number.isFinite(n) ? n : 0
}

function emptyRealWallet(overrides?: Partial<Wallet>): Wallet {
  const stamp = nowIso()
  return {
    id: REAL_WALLET_ID,
    userId: REAL_USER_ID,
    accountId: REAL_ACCOUNT_ID,
    accountMode: 'real',
    kind: 'real',
    currency: 'USD',
    balance: null,
    availableBalance: null,
    lockedBalance: null,
    status: 'not_connected',
    isSimulated: false,
    createdAt: stamp,
    updatedAt: stamp,
    ...overrides,
  }
}

function mapWallet(row: {
  id: string
  user_id: string
  account_id: string
  account_mode: string
  currency: string
  balance: number | string
  available_balance: number | string
  locked_balance: number | string
  status: string
  is_simulated: boolean
  created_at: string
  updated_at: string
}): Wallet {
  return {
    id: row.id,
    userId: row.user_id,
    accountId: row.account_id,
    accountMode: 'real',
    kind: 'real',
    currency: row.currency,
    balance: num(row.balance),
    availableBalance: num(row.available_balance),
    lockedBalance: num(row.locked_balance),
    status: row.status === 'ready' || row.status === 'empty' ? (row.status as 'ready' | 'empty') : 'ready',
    isSimulated: Boolean(row.is_simulated),
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  }
}

const WALLET_READ_TIMEOUT_MS = 8000

/** Reads the caller's REAL wallet row (RLS: owner select). Retries once on error or timeout. */
async function readRealWalletRow(client: NonNullable<ReturnType<typeof getSupabase>>, userId: string) {
  const query = () =>
    client
      .from('wallets')
      .select(
        'id, user_id, account_id, account_mode, currency, balance, available_balance, locked_balance, status, is_simulated, created_at, updated_at',
      )
      .eq('user_id', userId)
      .eq('account_mode', 'real')
      .abortSignal(AbortSignal.timeout(WALLET_READ_TIMEOUT_MS))
      .maybeSingle()
  const first = await query()
  return first.error ? query() : first
}

function mapTxStatus(status: string): TransactionStatus {
  const allowed: TransactionStatus[] = ['PENDING', 'PROCESSING', 'COMPLETED', 'FAILED', 'CANCELLED']
  if ((allowed as string[]).includes(status)) return status as TransactionStatus
  return 'PENDING'
}

function mapTxType(type: string): TransactionType {
  const allowed: TransactionType[] = [
    'deposit',
    'withdrawal',
    'trade_stake',
    'trade_payout',
    'trade_refund',
    'adjustment',
  ]
  if ((allowed as string[]).includes(type)) return type as TransactionType
  return 'adjustment'
}

/**
 * Real wallet provider — reads authoritative Supabase wallet/ledger rows (RLS).
 * Never invents balances. Mutating deposit/withdrawal completion stays unavailable
 * until a payment provider + privileged RPCs are configured.
 */
export const realWalletProvider: WalletProvider = {
  id: 'real-backend',

  async getBalance(kind: AccountMode) {
    return this.getWallet(kind)
  },

  async getWallet(_kind: AccountMode) {
    if (!REAL_INTEGRATION.backendConfigured || !isSupabaseConfigured) {
      const view = buildRealAccountView(REAL_INTEGRATION)
      return notConnected(
        emptyRealWallet(),
        `${view.label}. Balance: ${view.balanceDisplay}. Real balances are never calculated in the frontend.`,
        'NOT_CONNECTED',
      )
    }

    const client = getSupabase()!
    const {
      data: { session },
    } = await client.auth.getSession()
    if (!session?.user) {
      return notConnected(
        emptyRealWallet(),
        'REAL ACCOUNT — sign in to load your wallet from Supabase.',
        'NOT_CONNECTED',
      )
    }

    const { data, error } = await readRealWalletRow(client, session.user.id)

    if (error) {
      return notConnected(emptyRealWallet(), `REAL wallet read failed: ${error.message}`, 'NOT_CONNECTED')
    }
    if (!data) {
      return notConnected(
        emptyRealWallet({ userId: session.user.id, status: 'empty' }),
        'REAL ACCOUNT — no real wallet row yet (signup trigger may still be pending).',
        'NOT_CONNECTED',
      )
    }
    if (data.is_simulated) {
      return notConnected(
        emptyRealWallet({ userId: session.user.id }),
        'Refusing to treat a simulated wallet row as REAL money.',
        'NOT_CONNECTED',
      )
    }

    const wallet = mapWallet(data)
    return okReal(
      wallet,
      `REAL wallet from Supabase ledger (available ${wallet.availableBalance} ${wallet.currency}). Trading/payments remain gated.`,
    )
  },

  async getWallets() {
    const result = await this.getWallet('real')
    return {
      ...result,
      data: [result.data],
    }
  },

  async getTransactions(_kind: AccountMode) {
    return this.listTransactions('real')
  },

  async listTransactions(_kind: AccountMode) {
    if (!REAL_INTEGRATION.backendConfigured || !isSupabaseConfigured) {
      return notConnected([], 'REAL ACCOUNT NOT CONNECTED. Transaction history is served only by the backend.')
    }
    const client = getSupabase()!
    const {
      data: { session },
    } = await client.auth.getSession()
    if (!session?.user) {
      return notConnected([], 'Sign in to load REAL transactions.')
    }

    const { data, error } = await client
      .from('transactions')
      .select(
        'id, user_id, account_id, account_mode, wallet_id, type, amount, currency, status, reference, note, is_simulated, created_at, updated_at',
      )
      .eq('user_id', session.user.id)
      .eq('account_mode', 'real')
      .eq('is_simulated', false)
      .order('created_at', { ascending: false })

    if (error) {
      return notConnected([], `REAL transactions read failed: ${error.message}`)
    }

    const rows: Transaction[] = (data ?? []).map((row) => ({
      id: row.id,
      userId: row.user_id,
      accountId: row.account_id,
      accountMode: 'real' as const,
      walletId: row.wallet_id,
      type: mapTxType(row.type),
      amount: num(row.amount),
      currency: row.currency,
      status: mapTxStatus(row.status),
      reference: row.reference,
      note: row.note,
      isSimulated: false,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
    }))

    return okReal(rows, rows.length ? 'REAL transactions from Supabase.' : 'No REAL transactions yet.')
  },

  async listDeposits() {
    if (!REAL_INTEGRATION.backendConfigured || !isSupabaseConfigured) {
      return notConnected([], 'REAL ACCOUNT NOT CONNECTED. Deposits are not listed from the frontend.')
    }
    const client = getSupabase()!
    const {
      data: { session },
    } = await client.auth.getSession()
    if (!session?.user) {
      return notConnected([], 'Sign in to load REAL deposits.')
    }

    const { data, error } = await client
      .from('deposits')
      .select(
        'id, user_id, account_id, account_mode, wallet_id, amount, currency, method, status, provider, details, is_simulated, created_at, updated_at',
      )
      .eq('user_id', session.user.id)
      .eq('account_mode', 'real')
      .eq('is_simulated', false)
      .order('created_at', { ascending: false })

    if (error) {
      return notConnected([], `REAL deposits read failed: ${error.message}`)
    }

    const rows: Deposit[] = (data ?? []).map((row) => {
      const details = (row.details && typeof row.details === 'object' && !Array.isArray(row.details)
        ? row.details
        : {}) as Record<string, unknown>
      return {
        id: row.id,
        userId: row.user_id,
        accountId: row.account_id,
        accountMode: 'real' as const,
        walletId: row.wallet_id,
        amount: num(row.amount),
        currency: row.currency,
        method: row.method,
        status: mapTxStatus(row.status),
        isSimulated: false,
        walletKind: 'real' as const,
        provider: row.provider,
        reference: typeof details.reference === 'string' ? details.reference : null,
        amountKes: details.amount_kes != null ? num(details.amount_kes) : null,
        failureReason: typeof details.failure_reason === 'string' ? details.failure_reason : null,
        createdAt: row.created_at,
        updatedAt: row.updated_at,
      }
    })

    return okReal(rows, rows.length ? 'REAL deposits from Supabase.' : 'No REAL deposits yet.')
  },

  async listWithdrawals() {
    if (!REAL_INTEGRATION.backendConfigured || !isSupabaseConfigured) {
      return notConnected([], 'REAL ACCOUNT NOT CONNECTED. Withdrawals are not listed from the frontend.')
    }
    const client = getSupabase()!
    const {
      data: { session },
    } = await client.auth.getSession()
    if (!session?.user) {
      return notConnected([], 'Sign in to load REAL withdrawals.')
    }

    const { data, error } = await client
      .from('withdrawals')
      .select(
        'id, user_id, account_id, account_mode, wallet_id, amount, currency, destination, status, is_simulated, created_at, updated_at, provider, reference, amount_kes, fee_kes, net_kes, msisdn, mpesa_receipt, failure_reason, processing_at, completed_at, failed_at',
      )
      .eq('user_id', session.user.id)
      .eq('account_mode', 'real')
      .eq('is_simulated', false)
      .order('created_at', { ascending: false })

    if (error) {
      return notConnected([], `REAL withdrawals read failed: ${error.message}`)
    }

    const rows: Withdrawal[] = (data ?? []).map((row) => ({
      id: row.id,
      userId: row.user_id,
      accountId: row.account_id,
      accountMode: 'real' as const,
      walletId: row.wallet_id,
      amount: num(row.amount),
      currency: row.currency,
      destination: row.destination,
      status: mapTxStatus(row.status),
      isSimulated: false,
      walletKind: 'real' as const,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
      provider: row.provider,
      reference: row.reference,
      amountKes: row.amount_kes == null ? null : num(row.amount_kes),
      feeKes: num(row.fee_kes),
      netKes: row.net_kes == null ? null : num(row.net_kes),
      msisdn: row.msisdn,
      receipt: row.mpesa_receipt,
      failureReason: row.failure_reason,
      processingAt: row.processing_at,
      completedAt: row.completed_at,
      failedAt: row.failed_at,
    }))

    return okReal(rows, rows.length ? 'REAL withdrawals from Supabase.' : 'No REAL withdrawals yet.')
  },

  async createDeposit(input) {
    return this.requestDeposit(input)
  },

  async createWithdrawal(input) {
    return this.requestWithdrawal(input)
  },

  // REAL deposits go through the megapay-deposit Edge Function (services/megapay.ts), never a direct insert.
  async requestDeposit(_input) {
    return notConnected(null, REAL_UNAVAILABLE_PAYMENTS, 'REAL_PAYMENTS_UNAVAILABLE')
  },

  // REAL withdrawals go through the mpesa-withdraw Edge Function (services/withdrawals.ts), never a direct insert.
  async requestWithdrawal(_input) {
    return notConnected(null, REAL_UNAVAILABLE_WITHDRAWALS, 'REAL_PAYMENTS_UNAVAILABLE')
  },
}
