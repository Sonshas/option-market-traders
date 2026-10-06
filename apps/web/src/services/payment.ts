import { walletService } from '@/services/wallet'
import type { AccountMode, Deposit, ProviderResult, Withdrawal } from '@/types'

/**
 * Payment facade — routes through mode-scoped wallets.
 * DEMO deposits/withdrawals are simulated virtual funds only.
 * REAL payments always return NOT_CONNECTED.
 */
export interface PaymentProvider {
  readonly id: string
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
  listDeposits(kind?: AccountMode): Promise<ProviderResult<Deposit[]>>
  listWithdrawals(kind?: AccountMode): Promise<ProviderResult<Withdrawal[]>>
}

export const paymentProvider: PaymentProvider = {
  id: 'mode-scoped',

  async requestDeposit(input) {
    return walletService.requestDeposit(input)
  },

  async requestWithdrawal(input) {
    return walletService.requestWithdrawal(input)
  },

  async listDeposits(kind = 'demo') {
    return walletService.listDeposits(kind)
  },

  async listWithdrawals(kind = 'demo') {
    return walletService.listWithdrawals(kind)
  },
}
