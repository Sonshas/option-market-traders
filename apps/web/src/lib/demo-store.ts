import {
  DEMO_ACCOUNT_ID,
  DEMO_USER_ID,
  DEMO_WALLET_ID,
} from '@/domain/account'
import { assertSameMode } from '@/domain/isolation'
import { createId, nowIso } from '@/lib/ids'
import { DEMO_STARTING_BALANCE, DEMO_STORAGE_KEY } from '@/providers/config'
import type {
  Account,
  BotRun,
  CopyTrade,
  Deposit,
  Notification,
  NotificationKind,
  SupportTicket,
  Trade,
  TradeSettlement,
  Transaction,
  Wallet,
  WalletLedger,
  Withdrawal,
} from '@/types'

export interface DemoState {
  account: Account
  wallet: Wallet
  ledger: WalletLedger[]
  transactions: Transaction[]
  deposits: Deposit[]
  withdrawals: Withdrawal[]
  trades: Trade[]
  settlements: TradeSettlement[]
  botRuns: BotRun[]
  copyTrades: CopyTrade[]
  notifications: Notification[]
  tickets: SupportTicket[]
}

const listeners = new Set<() => void>()

function emptyWallet(now: string): Wallet {
  return {
    id: DEMO_WALLET_ID,
    userId: DEMO_USER_ID,
    accountId: DEMO_ACCOUNT_ID,
    accountMode: 'demo',
    kind: 'demo',
    currency: 'USD',
    balance: DEMO_STARTING_BALANCE,
    availableBalance: DEMO_STARTING_BALANCE,
    lockedBalance: 0,
    status: 'ready',
    isSimulated: true,
    createdAt: now,
    updatedAt: now,
  }
}

export function createInitialDemoState(now = Date.now()): DemoState {
  const createdAt = nowIso(now)
  return {
    account: {
      id: DEMO_ACCOUNT_ID,
      userId: DEMO_USER_ID,
      accountMode: 'demo',
      status: 'active',
      createdAt,
      updatedAt: createdAt,
    },
    wallet: emptyWallet(createdAt),
    ledger: [],
    transactions: [],
    deposits: [],
    withdrawals: [],
    trades: [],
    settlements: [],
    botRuns: [],
    copyTrades: [],
    notifications: [],
    tickets: [],
  }
}

let memory: DemoState | null = null

function canUseStorage(): boolean {
  try {
    return typeof localStorage !== 'undefined'
  } catch {
    return false
  }
}

function revive(raw: DemoState): DemoState {
  assertSameMode('demo', raw.account.accountMode, 'demo account')
  assertSameMode('demo', raw.wallet.accountMode, 'demo wallet')
  const trades = (raw.trades ?? []).map((trade) => {
    const legacy = trade as Trade & { side?: string }
    const contractType = legacy.contractType ?? 'EVEN_ODD'
    const contractOption =
      legacy.contractOption ??
      (legacy.side === 'put' || legacy.side === 'odd' ? 'odd' : 'even')
    return {
      ...legacy,
      market: legacy.market ?? legacy.symbol,
      contractType,
      contractOption,
      selectedDigit: legacy.selectedDigit ?? null,
      barrier: legacy.barrier ?? null,
      duration: legacy.duration ?? legacy.durationMs,
      result: legacy.result ?? legacy.status,
      resolvedAt: legacy.resolvedAt ?? (legacy.status === 'open' ? null : legacy.updatedAt),
    } satisfies Trade
  })
  for (const trade of trades) assertSameMode('demo', trade.accountMode, 'demo trade')
  for (const tx of raw.transactions) assertSameMode('demo', tx.accountMode, 'demo transaction')
  return { ...raw, trades }
}

export function loadDemoState(): DemoState {
  if (memory) return memory
  if (canUseStorage()) {
    const raw = localStorage.getItem(DEMO_STORAGE_KEY)
    if (raw) {
      try {
        memory = revive(JSON.parse(raw) as DemoState)
        return memory
      } catch {
        memory = createInitialDemoState()
        persistDemoState(memory)
        return memory
      }
    }
  }
  memory = createInitialDemoState()
  persistDemoState(memory)
  return memory
}

export function persistDemoState(state: DemoState): void {
  memory = state
  if (canUseStorage()) {
    localStorage.setItem(DEMO_STORAGE_KEY, JSON.stringify(state))
  }
  listeners.forEach((listener) => listener())
}

export function resetDemoState(now = Date.now()): DemoState {
  memory = createInitialDemoState(now)
  persistDemoState(memory)
  return memory
}

export function subscribeDemoStore(listener: () => void): () => void {
  listeners.add(listener)
  return () => {
    listeners.delete(listener)
  }
}

export function mutateDemoState(mutator: (state: DemoState) => DemoState): DemoState {
  const next = mutator(loadDemoState())
  persistDemoState(next)
  return next
}

export function pushDemoNotification(
  state: DemoState,
  kind: NotificationKind,
  title: string,
  body: string,
  now = Date.now(),
): DemoState {
  const createdAt = nowIso(now)
  const notification: Notification = {
    id: createId('ntf'),
    userId: DEMO_USER_ID,
    accountId: DEMO_ACCOUNT_ID,
    accountMode: 'demo',
    kind,
    title,
    body,
    read: false,
    isSimulated: true,
    createdAt,
    updatedAt: createdAt,
  }
  return { ...state, notifications: [notification, ...state.notifications] }
}

export function applyDemoBalance(
  state: DemoState,
  deltaAvailable: number,
  deltaLocked: number,
  now: number,
): DemoState {
  const available = Math.max(0, (state.wallet.availableBalance ?? 0) + deltaAvailable)
  const locked = Math.max(0, (state.wallet.lockedBalance ?? 0) + deltaLocked)
  const updatedAt = nowIso(now)
  return {
    ...state,
    wallet: {
      ...state.wallet,
      availableBalance: available,
      lockedBalance: locked,
      balance: available + locked,
      updatedAt,
    },
  }
}

export function appendDemoLedger(
  state: DemoState,
  entry: Omit<WalletLedger, 'id' | 'userId' | 'accountId' | 'accountMode' | 'walletId' | 'isSimulated' | 'createdAt' | 'updatedAt' | 'balanceAfter'> & {
    balanceAfter?: number | null
  },
  now: number,
): DemoState {
  const createdAt = nowIso(now)
  const ledgerEntry: WalletLedger = {
    id: createId('ldg'),
    userId: DEMO_USER_ID,
    accountId: DEMO_ACCOUNT_ID,
    accountMode: 'demo',
    walletId: DEMO_WALLET_ID,
    isSimulated: true,
    createdAt,
    updatedAt: createdAt,
    balanceAfter: entry.balanceAfter ?? state.wallet.balance,
    ...entry,
  }
  return { ...state, ledger: [ledgerEntry, ...state.ledger] }
}
