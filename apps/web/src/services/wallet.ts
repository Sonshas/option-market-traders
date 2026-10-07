import { getAccountProviders } from '@/providers/registry'
import type { AccountMode, Deposit, ProviderResult, Transaction, Wallet, Withdrawal } from '@/types'

/**
 * Mode-scoped wallet facade.
 * DEMO → simulated local ledger. REAL → Supabase wallet/ledger reads (RLS).
 */
export interface WalletProvider {
  readonly id: string
  getWallets(): Promise<ProviderResult<Wallet[]>>
  getWallet(kind: AccountMode): Promise<ProviderResult<Wallet>>
  listTransactions(kind: AccountMode): Promise<ProviderResult<Transaction[]>>
  listDeposits(kind?: AccountMode): Promise<ProviderResult<Deposit[]>>
  listWithdrawals(kind?: AccountMode): Promise<ProviderResult<Withdrawal[]>>
  requestDeposit(input: {
    amount: number
    method: string
    kind: AccountMode
  }): Promise<ProviderResult<Deposit | null>>
  requestWithdrawal(input: {
    amount: number
    destination: string
    kind: AccountMode
  }): Promise<ProviderResult<Withdrawal | null>>
}

function wallet(kind: AccountMode) {
  return getAccountProviders(kind).wallet
}

export const walletService: WalletProvider = {
  id: 'mode-scoped',

  async getWallets() {
    const demo = await wallet('demo').getWallets()
    const real = await wallet('real').getWallets()
    return {
      status: 'ready' as const,
      connected: true,
      message: 'DEMO wallets are practice funds. REAL wallets load when you sign in.',
      data: [...demo.data, ...real.data],
      accountMode: 'demo' as const,
      isSimulated: true,
    }
  },

  async getWallet(kind) {
    return wallet(kind).getWallet(kind)
  },

  async listTransactions(kind) {
    return wallet(kind).listTransactions(kind)
  },

  async listDeposits(kind = 'demo') {
    return wallet(kind).listDeposits(kind)
  },

  async listWithdrawals(kind = 'demo') {
    return wallet(kind).listWithdrawals(kind)
  },

  async requestDeposit(input) {
    return wallet(input.kind).requestDeposit(input)
  },

  async requestWithdrawal(input) {
    return wallet(input.kind).requestWithdrawal(input)
  },
}

export const walletProvider: WalletProvider = walletService
