import {
  DEMO_ACCOUNT_ID,
  DEMO_USER_ID,
  DEMO_WALLET_ID,
} from '@/domain/account'
import { assertSameMode } from '@/domain/isolation'
import { createId, nowIso } from '@/lib/ids'
import {
  PRACTICE_STORAGE_KEY,
  getPracticeBook,
  subscribePracticeBook,
  type PracticeBook,
} from '@/lib/practice-book'
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

function storageKeyFor(book: PracticeBook): string {
  return book === 'practice' ? PRACTICE_STORAGE_KEY : DEMO_STORAGE_KEY
}

function storageKey(): string {
  return storageKeyFor(getPracticeBook())
}

/** Practice books saved before Practice had a balance held this hidden placeholder amount. */
const LEGACY_PRACTICE_NOMINAL_BALANCE = 1_000_000_000

function withoutLegacyPracticeWallet(state: DemoState): DemoState {
  if (getPracticeBook() !== 'practice') return state
  if ((state.wallet.availableBalance ?? 0) < LEGACY_PRACTICE_NOMINAL_BALANCE) return state
  return {
    ...state,
    wallet: {
      ...state.wallet,
      balance: DEMO_STARTING_BALANCE,
      availableBalance: DEMO_STARTING_BALANCE,
      lockedBalance: 0,
    },
  }
}

function emptyWallet(now: string): Wallet {
  const balance = DEMO_STARTING_BALANCE
  return {
    id: DEMO_WALLET_ID,
    userId: DEMO_USER_ID,
    accountId: DEMO_ACCOUNT_ID,
    accountMode: 'demo',
    kind: 'demo',
    currency: 'USD',
    balance,
    availableBalance: balance,
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

/** One cached state per book, keyed by storage key; each book keeps its own balance and trades. */
const memory = new Map<string, DemoState>()

subscribePracticeBook(() => {
  // With storage available, re-read the newly active book so it reflects any other tab's changes.
  if (canUseStorage()) memory.clear()
  listeners.forEach((listener) => listener())
})

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
  const key = storageKey()
  const cached = memory.get(key)
  if (cached) return cached
  if (canUseStorage()) {
    const raw = localStorage.getItem(key)
    if (raw) {
      try {
        const state = withoutLegacyPracticeWallet(revive(JSON.parse(raw) as DemoState))
        memory.set(key, state)
        return state
      } catch {
        return resetDemoState()
      }
    }
  }
  return resetDemoState()
}

export function persistDemoState(state: DemoState): void {
  const key = storageKey()
  memory.set(key, state)
  if (canUseStorage()) {
    localStorage.setItem(key, JSON.stringify(state))
  }
  listeners.forEach((listener) => listener())
}

export function resetDemoState(now = Date.now()): DemoState {
  const state = createInitialDemoState(now)
  persistDemoState(state)
  return state
}

/**
 * Sets one book's available balance to the server value (signed-in users: the server row is the
 * source of truth). Locked stakes of open local trades are kept. Works for the inactive book too.
 */
export function applyServerAvailableBalance(book: PracticeBook, available: number, now = Date.now()): void {
  if (!Number.isFinite(available) || available < 0) return
  const key = storageKeyFor(book)
  let state = memory.get(key) ?? null
  if (!state && canUseStorage()) {
    const raw = localStorage.getItem(key)
    if (raw) {
      try {
        state = revive(JSON.parse(raw) as DemoState)
      } catch {
        state = null
      }
    }
  }
  if (!state) state = createInitialDemoState(now)
  if (state.wallet.availableBalance === available) return
  const locked = state.wallet.lockedBalance ?? 0
  const next: DemoState = {
    ...state,
    wallet: { ...state.wallet, availableBalance: available, lockedBalance: locked, balance: available + locked, updatedAt: nowIso(now) },
  }
  memory.set(key, next)
  if (canUseStorage()) localStorage.setItem(key, JSON.stringify(next))
  listeners.forEach((listener) => listener())
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
