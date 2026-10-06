import { TRADE_DURATIONS } from '@/domain/digit-contracts'
import type { Bot, CopyTrader, Market, Timeframe } from '@/types'

export const APP_NAME = 'SmartBaseBinary'
export const APP_TAGLINE = 'Binary workspace for DEMO and REAL accounts'

export const NOT_CONNECTED =
  'This service is not connected. No live account, balance, or market feed is available in this UI phase.'

export const AUTH_NOT_CONNECTED =
  'Authentication is not connected. This form does not sign you in to a production account.'

export const TRADING_NOT_LIVE =
  'Live trading is not operational in this interface. Charts do not show live market prices.'

export const RISK_DISCLAIMER =
  'Binary contracts involve a high risk of losing the stake you place. Past or historical results, if shown later, are not a guarantee of future outcomes. SmartBaseBinary does not promise profits, win rates, or payout percentages. Never trade money you cannot afford to lose.'

/** Deriv serves candles from 60 s up; sub-minute timeframes are deliberately absent. */
export const TIMEFRAMES: Timeframe[] = ['1m', '5m', '15m', '30m', '1h', '4h', '1d']

export const DURATIONS = TRADE_DURATIONS

/**
 * Instrument catalog only. Prices stay null until a legitimate provider is wired.
 * Names follow publicly known synthetic index labels used by this product domain.
 */
const CATALOG_FEED = 'Catalog only — no live quote'
const DIGIT_CONTRACTS = ['EVEN_ODD', 'MATCH_DIFFER', 'OVER_UNDER'] as const

export const MARKET_CATALOG: Market[] = [
  { symbol: 'R_10', displayName: 'Volatility 10', category: 'synthetic', contractKinds: [...DIGIT_CONTRACTS], durationsMs: [15_000, 30_000, 60_000, 300_000], lastPrice: null, priceStatus: 'disconnected', feedLabel: CATALOG_FEED, isSimulated: false },
  { symbol: '1HZ10V', displayName: 'Volatility 10 (1s)', category: 'synthetic', contractKinds: [...DIGIT_CONTRACTS], durationsMs: [2_000, 15_000, 30_000], lastPrice: null, priceStatus: 'disconnected', feedLabel: CATALOG_FEED, isSimulated: false },
  { symbol: 'R_25', displayName: 'Volatility 25', category: 'synthetic', contractKinds: [...DIGIT_CONTRACTS], durationsMs: [15_000, 30_000, 60_000, 300_000], lastPrice: null, priceStatus: 'disconnected', feedLabel: CATALOG_FEED, isSimulated: false },
  { symbol: '1HZ25V', displayName: 'Volatility 25 (1s)', category: 'synthetic', contractKinds: [...DIGIT_CONTRACTS], durationsMs: [2_000, 15_000, 30_000], lastPrice: null, priceStatus: 'disconnected', feedLabel: CATALOG_FEED, isSimulated: false },
  { symbol: 'R_50', displayName: 'Volatility 50', category: 'synthetic', contractKinds: [...DIGIT_CONTRACTS], durationsMs: [15_000, 30_000, 60_000, 300_000], lastPrice: null, priceStatus: 'disconnected', feedLabel: CATALOG_FEED, isSimulated: false },
  { symbol: 'R_75', displayName: 'Volatility 75', category: 'synthetic', contractKinds: [...DIGIT_CONTRACTS], durationsMs: [15_000, 30_000, 60_000, 300_000], lastPrice: null, priceStatus: 'disconnected', feedLabel: CATALOG_FEED, isSimulated: false },
  { symbol: '1HZ75V', displayName: 'Volatility 75 (1s)', category: 'synthetic', contractKinds: [...DIGIT_CONTRACTS], durationsMs: [2_000, 15_000, 30_000], lastPrice: null, priceStatus: 'disconnected', feedLabel: CATALOG_FEED, isSimulated: false },
  { symbol: 'R_100', displayName: 'Volatility 100', category: 'synthetic', contractKinds: [...DIGIT_CONTRACTS], durationsMs: [15_000, 30_000, 60_000, 300_000], lastPrice: null, priceStatus: 'disconnected', feedLabel: CATALOG_FEED, isSimulated: false },
  { symbol: 'frxEURUSD', displayName: 'EUR/USD', category: 'forex', contractKinds: [...DIGIT_CONTRACTS], durationsMs: [60_000, 300_000], lastPrice: null, priceStatus: 'disconnected', feedLabel: CATALOG_FEED, isSimulated: false },
  { symbol: 'frxGBPUSD', displayName: 'GBP/USD', category: 'forex', contractKinds: [...DIGIT_CONTRACTS], durationsMs: [60_000, 300_000], lastPrice: null, priceStatus: 'disconnected', feedLabel: CATALOG_FEED, isSimulated: false },
]

export const BOT_CATALOG: Bot[] = [
  {
    id: 'parity-filter',
    name: 'Parity Filter',
    marketSymbol: 'R_75',
    description: 'Even/odd contract filter with a configurable loss-streak stop. Does not claim a win rate.',
    historicalPerformance: 'N/A — historical results are not connected',
    riskLevel: 'medium',
    defaultStake: 1,
    takeProfit: null,
    stopLoss: null,
    maxRuns: 20,
    lossStreakLimit: 3,
  },
  {
    id: 'range-anchor',
    name: 'Range Anchor',
    marketSymbol: 'R_50',
    description: 'Over/under range filter. Stops on take-profit, stop-loss, or max runs.',
    historicalPerformance: 'N/A — historical results are not connected',
    riskLevel: 'low',
    defaultStake: 1,
    takeProfit: null,
    stopLoss: null,
    maxRuns: 15,
    lossStreakLimit: 2,
  },
  {
    id: 'digit-gate',
    name: 'Digit Gate',
    marketSymbol: 'R_100',
    description: 'Matches/differs digit filter. Manual start and stop only in this UI phase.',
    historicalPerformance: 'N/A — historical results are not connected',
    riskLevel: 'high',
    defaultStake: 1,
    takeProfit: null,
    stopLoss: null,
    maxRuns: 10,
    lossStreakLimit: 2,
  },
  {
    id: 'pulse-window',
    name: 'Pulse Window',
    marketSymbol: '1HZ25V',
    description: 'Short-duration digit contracts on 1-second synthetic indices.',
    historicalPerformance: 'N/A — historical results are not connected',
    riskLevel: 'high',
    defaultStake: 1,
    takeProfit: null,
    stopLoss: null,
    maxRuns: 25,
    lossStreakLimit: 4,
  },
  {
    id: 'drift-watch',
    name: 'Drift Watch',
    marketSymbol: 'R_10',
    description: 'Conservative under-threshold watcher with a tight loss-streak cap.',
    historicalPerformance: 'N/A — historical results are not connected',
    riskLevel: 'low',
    defaultStake: 1,
    takeProfit: null,
    stopLoss: null,
    maxRuns: 12,
    lossStreakLimit: 2,
  },
  {
    id: 'breakout-rail',
    name: 'Breakout Rail',
    marketSymbol: 'R_25',
    description: 'Over-threshold breakout filter. Risk controls are required before a real engine is connected.',
    historicalPerformance: 'N/A — historical results are not connected',
    riskLevel: 'medium',
    defaultStake: 1,
    takeProfit: null,
    stopLoss: null,
    maxRuns: 18,
    lossStreakLimit: 3,
  },
]

/**
 * Structural leaderboard slots only. Performance is unavailable — not fabricated
 * successful traders or win rates.
 */
export const COPY_TRADER_PLACEHOLDERS: CopyTrader[] = [
  { id: 'ph-01', displayName: 'DEMO Trader 01', handle: '@demo_01', recordKind: 'simulated_demo', historicalRoi: 'N/A — DEMO simulated, not a live track record', historicalWinRate: 'N/A — not a guaranteed win rate', historicalPnl: 'N/A — DEMO simulated only', riskLevel: 'medium', tradeCount: 'N/A', style: 'Even/odd filter (DEMO simulated)', accountMode: 'demo', isSimulated: true },
  { id: 'ph-02', displayName: 'DEMO Trader 02', handle: '@demo_02', recordKind: 'simulated_demo', historicalRoi: 'N/A — DEMO simulated, not a live track record', historicalWinRate: 'N/A — not a guaranteed win rate', historicalPnl: 'N/A — DEMO simulated only', riskLevel: 'low', tradeCount: 'N/A', style: 'Range under/over (DEMO simulated)', accountMode: 'demo', isSimulated: true },
  { id: 'ph-03', displayName: 'DEMO Trader 03', handle: '@demo_03', recordKind: 'simulated_demo', historicalRoi: 'N/A — DEMO simulated, not a live track record', historicalWinRate: 'N/A — not a guaranteed win rate', historicalPnl: 'N/A — DEMO simulated only', riskLevel: 'high', tradeCount: 'N/A', style: 'Digit matches (DEMO simulated)', accountMode: 'demo', isSimulated: true },
  { id: 'ph-04', displayName: 'DEMO Trader 04', handle: '@demo_04', recordKind: 'simulated_demo', historicalRoi: 'N/A — DEMO simulated, not a live track record', historicalWinRate: 'N/A — not a guaranteed win rate', historicalPnl: 'N/A — DEMO simulated only', riskLevel: 'medium', tradeCount: 'N/A', style: 'Short-duration digit contracts (DEMO simulated)', accountMode: 'demo', isSimulated: true },
  { id: 'ph-05', displayName: 'DEMO Trader 05', handle: '@demo_05', recordKind: 'simulated_demo', historicalRoi: 'N/A — DEMO simulated, not a live track record', historicalWinRate: 'N/A — not a guaranteed win rate', historicalPnl: 'N/A — DEMO simulated only', riskLevel: 'low', tradeCount: 'N/A', style: 'Conservative drift (DEMO simulated)', accountMode: 'demo', isSimulated: true },
  { id: 'ph-06', displayName: 'DEMO Trader 06', handle: '@demo_06', recordKind: 'simulated_demo', historicalRoi: 'N/A — DEMO simulated, not a live track record', historicalWinRate: 'N/A — not a guaranteed win rate', historicalPnl: 'N/A — DEMO simulated only', riskLevel: 'high', tradeCount: 'N/A', style: 'Breakout rail (DEMO simulated)', accountMode: 'demo', isSimulated: true },
]

/**
 * Desktop top bar, in display order. `inlineFrom` is the breakpoint at which an item
 * leaves the "More" menu and sits inline (md = 768px, lg = 1024px, xl = 1280px).
 */
export const APP_TOP_NAV = [
  { to: '/app/trade', label: 'Trade', icon: 'trade' as const, inlineFrom: 'md' as const },
  { to: '/app/dashboard', label: 'Dashboard', icon: 'home' as const, inlineFrom: 'md' as const },
  { to: '/app/wallet', label: 'Wallet', icon: 'wallet' as const, inlineFrom: 'lg' as const },
  { to: '/app/history', label: 'Trade History', icon: 'history' as const, inlineFrom: 'xl' as const },
  { to: '/app/transactions', label: 'Transactions', icon: 'tx' as const, inlineFrom: 'xl' as const },
  { to: '/app/support', label: 'Support', icon: 'support' as const, inlineFrom: 'xl' as const },
] as const

export const APP_DRAWER_NAV = [
  { to: '/app/trade', label: 'Trade', icon: 'trade' as const },
  { to: '/app/dashboard', label: 'Dashboard', icon: 'home' as const },
  { to: '/app/wallet', label: 'Wallet', icon: 'wallet' as const },
  { to: '/app/history', label: 'Trade History', icon: 'history' as const },
  { to: '/app/transactions', label: 'Transactions', icon: 'tx' as const },
  { to: '/app/notifications', label: 'Notifications', icon: 'bell' as const },
  { to: '/app/support', label: 'Support', icon: 'support' as const },
  { to: '/app/profile', label: 'Profile', icon: 'profile' as const },
  { to: '/app/security', label: 'Security', icon: 'lock' as const },
] as const

export const PROFILE_MENU_NAV = [
  { to: '/app/profile', label: 'Profile', icon: 'profile' as const },
  { to: '/app/security', label: 'Security', icon: 'lock' as const },
] as const

export const STAKE_PRESETS = [1, 5, 10, 25, 50, 100] as const

export const ADMIN_NAV = [
  { to: '/admin', label: 'Overview', end: true },
  { to: '/admin/users', label: 'Users' },
  { to: '/admin/accounts', label: 'Accounts' },
  { to: '/admin/deposits', label: 'Deposits' },
  { to: '/admin/dashboard', label: 'Dashboard' },
  { to: '/admin/withdrawals', label: 'Withdrawals' },
  { to: '/admin/trades', label: 'Trades' },
  { to: '/admin/ledger', label: 'Ledger' },
  { to: '/admin/support', label: 'Support' },
  { to: '/admin/notifications', label: 'Notifications' },
  { to: '/admin/copy-traders', label: 'Copy traders' },
  { to: '/admin/settings', label: 'Settings' },
  { to: '/admin/audit', label: 'Audit logs' },
] as const
