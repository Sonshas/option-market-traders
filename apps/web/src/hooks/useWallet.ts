import { useEffect, useState } from 'react'
import {
  REAL_BALANCE_LOADING,
  REAL_BALANCE_PLACEHOLDER,
  authConnectionStatus,
  buildRealAccountView,
} from '@/domain/account'
import { useAuthSession } from '@/hooks/useAuth'
import { formatMoney } from '@/lib/format'
import { loadDemoState, subscribeDemoStore } from '@/lib/demo-store'
import { notifyRealWalletChanged, subscribeRealWalletChanged } from '@/lib/real-wallet-events'
import { isOpenWithdrawalStatus } from '@/domain/withdrawals'
import { REAL_INTEGRATION } from '@/providers/config'
import { walletService } from '@/services/wallet'
import { WITHDRAWAL_POLL_MS, withdrawalService } from '@/services/withdrawals'
import type { AccountMode, Deposit, Transaction, Wallet, WalletLedger, Withdrawal } from '@/types'

/** Increments whenever a REAL deposit settles so REAL reads re-run without a page reload. */
function useRealWalletRefreshKey(kind: AccountMode): number {
  const [key, setKey] = useState(0)
  useEffect(() => {
    if (kind !== 'real') return
    return subscribeRealWalletChanged(() => setKey((k) => k + 1))
  }, [kind])
  return key
}

function readDemoWallet(): Wallet {
  return loadDemoState().wallet
}

function readDemoHistory(): {
  transactions: Transaction[]
  deposits: Deposit[]
  withdrawals: Withdrawal[]
} {
  const state = loadDemoState()
  return {
    transactions: state.transactions,
    deposits: state.deposits,
    withdrawals: state.withdrawals,
  }
}

export function useWallet(kind: AccountMode) {
  const { isSignedIn, user } = useAuthSession()
  const [demoWallet, setDemoWallet] = useState<Wallet>(() => readDemoWallet())
  const [realWallet, setRealWallet] = useState<Wallet | null>(null)
  const [message, setMessage] = useState('')
  const [loading, setLoading] = useState(kind === 'real')
  const [walletConnected, setWalletConnected] = useState(false)
  const refreshKey = useRealWalletRefreshKey(kind)

  useEffect(() => {
    if (kind !== 'demo') return
    const refresh = () => setDemoWallet(readDemoWallet())
    refresh()
    setMessage('DEMO wallet — simulated virtual funds, not real money.')
    setLoading(false)
    return subscribeDemoStore(refresh)
  }, [kind])

  useEffect(() => {
    if (kind !== 'real') return
    let cancelled = false
    if (refreshKey === 0) {
      setLoading(true)
      setRealWallet(null)
      setWalletConnected(false)
    }
    void walletService.getWallet('real').then((result) => {
      if (!cancelled) {
        setRealWallet(result.data)
        // Show authentic ledger balance (including $0) when Supabase returned a real wallet row.
        const readable =
          Boolean(result.connected) &&
          result.data != null &&
          !result.data.isSimulated &&
          result.data.availableBalance != null &&
          (result.data.status === 'ready' || result.data.status === 'empty')
        setWalletConnected(readable)
        setMessage(result.message)
        setLoading(false)
      }
    })
    return () => {
      cancelled = true
    }
  }, [kind, isSignedIn, user?.id, refreshKey])

  if (kind === 'demo') {
    return {
      wallet: demoWallet,
      message,
      loading: false,
      balanceDisplay: formatMoney(demoWallet.availableBalance ?? 0),
      authStatus: authConnectionStatus(isSignedIn),
      userEmail: user?.email ?? null,
    }
  }

  const view = buildRealAccountView(REAL_INTEGRATION)
  const authStatus = authConnectionStatus(isSignedIn)
  const connectedBalance =
    walletConnected && realWallet?.availableBalance != null
      ? formatMoney(realWallet.availableBalance, realWallet.currency || 'USD')
      : !isSignedIn
        ? 'NOT CONNECTED'
        : loading
          ? REAL_BALANCE_LOADING
          : REAL_BALANCE_PLACEHOLDER
  return {
    wallet: realWallet,
    message,
    loading,
    balanceDisplay: connectedBalance,
    authStatus,
    userEmail: user?.email ?? null,
    realView: {
      ...view,
      balanceDisplay: connectedBalance,
      label: authStatus,
      tradingExecution: 'NOT CONNECTED',
      deposits: 'NOT CONNECTED',
      withdrawals: 'NOT CONNECTED',
    },
  }
}

export function useWalletHistory(kind: AccountMode) {
  const { isSignedIn, user } = useAuthSession()
  const [demoHistory, setDemoHistory] = useState(() => readDemoHistory())
  const [transactions, setTransactions] = useState<Transaction[]>([])
  const [deposits, setDeposits] = useState<Deposit[]>([])
  const [withdrawals, setWithdrawals] = useState<Withdrawal[]>([])
  const [loading, setLoading] = useState(kind === 'real')
  const [message, setMessage] = useState('')
  const refreshKey = useRealWalletRefreshKey(kind)

  useEffect(() => {
    if (kind !== 'demo') return
    const refresh = () => setDemoHistory(readDemoHistory())
    refresh()
    setLoading(false)
    return subscribeDemoStore(refresh)
  }, [kind])

  useEffect(() => {
    if (kind !== 'real') return
    let cancelled = false
    if (refreshKey === 0) {
      setLoading(true)
      setTransactions([])
      setDeposits([])
      setWithdrawals([])
    }
    void Promise.all([
      walletService.listTransactions('real'),
      walletService.listDeposits('real'),
      walletService.listWithdrawals('real'),
    ]).then(([tx, dep, wd]) => {
      if (!cancelled) {
        setTransactions(tx.data)
        setDeposits(dep.data)
        setWithdrawals(wd.data)
        setMessage(tx.message)
        setLoading(false)
      }
    })
    return () => {
      cancelled = true
    }
  }, [kind, isSignedIn, user?.id, refreshKey])

  // Live REAL withdrawal status: realtime on the user's rows, plus a 5 s poll while any request is open.
  const hasOpenWithdrawal = kind === 'real' && withdrawals.some((w) => isOpenWithdrawalStatus(w.status))
  useEffect(() => {
    if (kind !== 'real' || !user?.id) return
    return withdrawalService.subscribe(user.id, notifyRealWalletChanged, {
      channel: `wallet-history:${user.id}`,
      pollMs: hasOpenWithdrawal ? WITHDRAWAL_POLL_MS : 0,
    })
  }, [kind, user?.id, hasOpenWithdrawal])

  if (kind === 'demo') {
    return {
      transactions: demoHistory.transactions,
      deposits: demoHistory.deposits,
      withdrawals: demoHistory.withdrawals,
      loading: false,
      message: 'DEMO transactions. Simulated ledger only.',
    }
  }

  return { transactions, deposits, withdrawals, loading, message }
}

/** DEMO wallet ledger (each row carries the balance after the entry). */
export function useDemoLedger(): WalletLedger[] {
  const [ledger, setLedger] = useState<WalletLedger[]>(() => loadDemoState().ledger)
  useEffect(() => {
    const refresh = () => setLedger(loadDemoState().ledger)
    refresh()
    return subscribeDemoStore(refresh)
  }, [])
  return ledger
}

export function useWallets() {
  const { wallet: demoWallet, loading: demoLoading } = useWallet('demo')
  const { wallet: realWallet, loading: realLoading, balanceDisplay } = useWallet('real')
  return {
    demoWallet,
    realWallet,
    liveWallet: realWallet,
    loading: demoLoading || realLoading,
    realBalanceDisplay: balanceDisplay,
  }
}
