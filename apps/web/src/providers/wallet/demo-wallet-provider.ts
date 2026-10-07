import {
  DEMO_ACCOUNT_ID,
  DEMO_USER_ID,
  DEMO_WALLET_ID,
} from '@/domain/account'
import { createId, nowIso } from '@/lib/ids'
import { recordSimulatedChange } from '@/lib/simulated-balance-sync'
import {
  appendDemoLedger,
  applyDemoBalance,
  loadDemoState,
  mutateDemoState,
  pushDemoNotification,
  type DemoState,
} from '@/lib/demo-store'
import { okDemo } from '@/providers/results'
import type {
  AccountMode,
  Deposit,
  DisconnectedResult,
  ProviderResult,
  Transaction,
  Wallet,
  Withdrawal,
} from '@/types'

/** Same per-top-up cap as public.apply_simulated_change. */
export const MAX_SIMULATED_TOPUP = 1_000_000

export interface WalletProvider {
  readonly id: string
  getBalance(kind: AccountMode): Promise<ProviderResult<Wallet>>
  getWallet(kind: AccountMode): Promise<ProviderResult<Wallet>>
  getWallets(): Promise<ProviderResult<Wallet[]>>
  getTransactions(kind: AccountMode): Promise<ProviderResult<Transaction[]>>
  listTransactions(kind: AccountMode): Promise<ProviderResult<Transaction[]>>
  listDeposits(kind?: AccountMode): Promise<ProviderResult<Deposit[]>>
  listWithdrawals(kind?: AccountMode): Promise<ProviderResult<Withdrawal[]>>
  createDeposit(input: { amount: number; method: string; kind: AccountMode }): Promise<ProviderResult<Deposit | null>>
  createWithdrawal(input: {
    amount: number
    destination: string
    kind: AccountMode
  }): Promise<ProviderResult<Withdrawal | null>>
  requestDeposit(input: { amount: number; method: string; kind: AccountMode }): Promise<ProviderResult<Deposit | null>>
  requestWithdrawal(input: {
    amount: number
    destination: string
    kind: AccountMode
  }): Promise<ProviderResult<Withdrawal | null>>
}

function demoOnly<T>(kind: AccountMode, fallback: T, run: () => ProviderResult<T>): ProviderResult<T> {
  if (kind !== 'demo') {
    const empty: DisconnectedResult<T> = {
      status: 'not_connected',
      connected: false,
      message: 'DemoWalletProvider refuses real-mode requests.',
      data: fallback,
      code: 'CROSS_MODE_FORBIDDEN',
      accountMode: 'real',
      isSimulated: false,
    }
    return empty
  }
  return run()
}

export const demoWalletProvider: WalletProvider = {
  id: 'demo-local',

  async getBalance(kind) {
    return this.getWallet(kind)
  },

  async getWallet(kind) {
    return demoOnly(kind, loadDemoState().wallet, () =>
      okDemo(loadDemoState().wallet, 'DEMO wallet — simulated virtual funds, not real money.'),
    )
  },

  async getWallets() {
    return okDemo([loadDemoState().wallet], 'DEMO wallets only. REAL balances are never stored here.')
  },

  async getTransactions(kind) {
    return this.listTransactions(kind)
  },

  async listTransactions(kind) {
    return demoOnly(kind, [], () =>
      okDemo(loadDemoState().transactions, 'DEMO transactions. Simulated ledger only.'),
    )
  },

  async listDeposits(kind = 'demo') {
    return demoOnly(kind, [], () => okDemo(loadDemoState().deposits, 'DEMO deposits. Simulated only.'))
  },

  async listWithdrawals(kind = 'demo') {
    return demoOnly(kind, [], () => okDemo(loadDemoState().withdrawals, 'DEMO withdrawals. Simulated only.'))
  },

  async createDeposit(input) {
    return this.requestDeposit(input)
  },

  async createWithdrawal(input) {
    return this.requestWithdrawal(input)
  },

  async requestDeposit(input) {
    if (input.kind !== 'demo') {
      return demoOnly(input.kind, null, () => okDemo(null, ''))
    }
    if (!(input.amount > 0) || input.amount > MAX_SIMULATED_TOPUP) {
      return {
        status: 'not_connected',
        connected: false,
        message: `Enter a demo deposit amount greater than zero and at most ${MAX_SIMULATED_TOPUP.toLocaleString('en-US')}.`,
        data: null,
        code: 'VALIDATION',
        accountMode: 'demo',
        isSimulated: true,
      }
    }
    const now = Date.now()
    const createdAt = nowIso(now)
    const deposit: Deposit = {
      id: createId('dep'),
      userId: DEMO_USER_ID,
      accountId: DEMO_ACCOUNT_ID,
      accountMode: 'demo',
      walletId: DEMO_WALLET_ID,
      walletKind: 'demo',
      amount: input.amount,
      currency: 'USD',
      method: input.method,
      status: 'COMPLETED',
      isSimulated: true,
      createdAt,
      updatedAt: createdAt,
    }
    const tx: Transaction = {
      id: createId('txn'),
      userId: DEMO_USER_ID,
      accountId: DEMO_ACCOUNT_ID,
      accountMode: 'demo',
      walletId: DEMO_WALLET_ID,
      type: 'deposit',
      amount: input.amount,
      currency: 'USD',
      status: 'COMPLETED',
      reference: deposit.id,
      note: 'DEMO simulated deposit',
      isSimulated: true,
      createdAt,
      updatedAt: createdAt,
    }
    mutateDemoState((state) => {
      let next: DemoState = applyDemoBalance(state, input.amount, 0, now)
      next = {
        ...next,
        deposits: [deposit, ...next.deposits],
        transactions: [tx, ...next.transactions],
      }
      next = appendDemoLedger(
        next,
        { entryType: 'deposit', amount: input.amount, referenceId: deposit.id, note: 'DEMO simulated deposit' },
        now,
      )
      return pushDemoNotification(
        next,
        'wallet',
        'DEMO deposit completed',
        `Simulated ${input.amount} USD credited to DEMO ACCOUNT. Not real money.`,
        now,
      )
    })
    void recordSimulatedChange('topup', input.amount, deposit.id)
    return okDemo(deposit, 'DEMO simulated deposit completed. This is virtual practice funds, not real money.')
  },

  async requestWithdrawal(input) {
    if (input.kind !== 'demo') {
      return demoOnly(input.kind, null, () => okDemo(null, ''))
    }
    const wallet = loadDemoState().wallet
    if (!(input.amount > 0)) {
      return {
        status: 'not_connected',
        connected: false,
        message: 'Enter a demo withdrawal amount greater than zero.',
        data: null,
        code: 'VALIDATION',
        accountMode: 'demo',
        isSimulated: true,
      }
    }
    if ((wallet.availableBalance ?? 0) < input.amount) {
      return {
        status: 'not_connected',
        connected: false,
        message: 'Insufficient DEMO balance for this simulated withdrawal.',
        data: null,
        code: 'INSUFFICIENT_FUNDS',
        accountMode: 'demo',
        isSimulated: true,
      }
    }
    const now = Date.now()
    const createdAt = nowIso(now)
    const withdrawal: Withdrawal = {
      id: createId('wdr'),
      userId: DEMO_USER_ID,
      accountId: DEMO_ACCOUNT_ID,
      accountMode: 'demo',
      walletId: DEMO_WALLET_ID,
      walletKind: 'demo',
      amount: input.amount,
      currency: 'USD',
      destination: input.destination,
      status: 'COMPLETED',
      isSimulated: true,
      createdAt,
      updatedAt: createdAt,
    }
    const tx: Transaction = {
      id: createId('txn'),
      userId: DEMO_USER_ID,
      accountId: DEMO_ACCOUNT_ID,
      accountMode: 'demo',
      walletId: DEMO_WALLET_ID,
      type: 'withdrawal',
      amount: -input.amount,
      currency: 'USD',
      status: 'COMPLETED',
      reference: withdrawal.id,
      note: 'DEMO simulated withdrawal',
      isSimulated: true,
      createdAt,
      updatedAt: createdAt,
    }
    mutateDemoState((state) => {
      let next = applyDemoBalance(state, -input.amount, 0, now)
      next = {
        ...next,
        withdrawals: [withdrawal, ...next.withdrawals],
        transactions: [tx, ...next.transactions],
      }
      next = appendDemoLedger(
        next,
        { entryType: 'withdrawal', amount: -input.amount, referenceId: withdrawal.id, note: 'DEMO simulated withdrawal' },
        now,
      )
      return pushDemoNotification(
        next,
        'wallet',
        'DEMO withdrawal completed',
        `Simulated ${input.amount} USD deducted from DEMO ACCOUNT. No real payout was sent.`,
        now,
      )
    })
    void recordSimulatedChange('withdraw', input.amount, withdrawal.id)
    return okDemo(withdrawal, 'DEMO simulated withdrawal completed. No real funds were transferred.')
  },
}
