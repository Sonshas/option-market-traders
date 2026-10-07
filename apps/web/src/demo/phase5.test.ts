import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('@/domain/outcome/demo-win-rate', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/domain/outcome/demo-win-rate')>()),
  demoExitDigit: (_contract: unknown, natural: number) => natural,
}))
import { filterByAccountMode, assertSameMode } from '@/domain/isolation'
import { lastDigitOfPrice, settleDigitContract } from '@/domain/contracts'
import { DEMO_STARTING_BALANCE } from '@/providers/config'
import {
  createInitialDemoState,
  loadDemoState,
  persistDemoState,
  resetDemoState,
} from '@/lib/demo-store'
import { demoTradingProvider, settleDemoTrades } from '@/providers/trading/demo-trading-provider'
import { realTradingProvider } from '@/providers/trading/real-trading-provider'
import { demoWalletProvider } from '@/providers/wallet/demo-wallet-provider'
import { realWalletProvider } from '@/providers/wallet/real-wallet-provider'
import { demoBotProvider, realBotProvider } from '@/providers/bots/providers'
import { demoCopyTradingProvider, realCopyTradingProvider } from '@/providers/copy-trading/providers'
import { demoMarketDataProvider, realMarketDataProvider } from '@/providers/market-data/providers'
import { getAccountProviders } from '@/providers/registry'
import { authService } from '@/services/auth'
import {
  clearDemoCredentials,
  clearDemoSession,
  resetDemoSessionMemory,
  saveDemoSession,
} from '@/lib/demo-session'
import { CROSS_MODE_FORBIDDEN } from '@/domain/errors'
import { clearTickBufferForTests, recordTicks } from '@/providers/market-data/tick-buffer'
import type { Tick } from '@/types'

function liveTick(symbol: string, price: number, timestamp: number, pipSize = 0.01): Tick {
  const lastDigit = Math.round(price / pipSize) % 10
  return { symbol, price, timestamp, pipSize, lastDigit, isSimulated: false, feedLabel: 'test feed' }
}

function seedLive(symbols: string[], now = Date.now()) {
  for (const symbol of symbols) recordTicks(symbol, [liveTick(symbol, 1234.56, now)])
}

beforeEach(() => {
  resetDemoState()
  clearDemoSession()
  clearDemoCredentials()
  resetDemoSessionMemory()
  clearTickBufferForTests()
})

describe('DEMO / REAL isolation', () => {
  it('keeps provider registries separate', () => {
    const demo = getAccountProviders('demo')
    const real = getAccountProviders('real')
    expect(demo.wallet.id).toBe('demo-local')
    expect(real.wallet.id).toBe('real-backend')
    expect(demo.trading.id).not.toBe(real.trading.id)
  })

  it('filters records by accountMode', () => {
    const rows = [
      { accountMode: 'demo' as const, id: '1' },
      { accountMode: 'real' as const, id: '2' },
    ]
    expect(filterByAccountMode(rows, 'demo')).toHaveLength(1)
    expect(() => assertSameMode('demo', 'real', 'wallet')).toThrow(CROSS_MODE_FORBIDDEN)
  })
})

describe('Digit contract settlement rules (natural contracts)', () => {
  it('settles EVEN/ODD/MATCH/DIFFER from the exit digit', () => {
    expect(lastDigitOfPrice(1234.56)).toBe(6)
    expect(settleDigitContract({
      contractType: 'EVEN_ODD',
      contractOption: 'even',
      selectedDigit: null,
      barrier: null,
      exitPrice: 10.2,
    })).toBe('won')
    expect(settleDigitContract({
      contractType: 'EVEN_ODD',
      contractOption: 'odd',
      selectedDigit: null,
      barrier: null,
      exitPrice: 10.2,
    })).toBe('lost')
    expect(settleDigitContract({
      contractType: 'MATCH_DIFFER',
      contractOption: 'match',
      selectedDigit: 7,
      barrier: null,
      exitPrice: 99.17,
    })).toBe('won')
    expect(settleDigitContract({
      contractType: 'MATCH_DIFFER',
      contractOption: 'differ',
      selectedDigit: 7,
      barrier: null,
      exitPrice: 99.17,
    })).toBe('lost')
  })
})

describe('DEMO wallet and trading', () => {
  it('starts with labelled DEMO balance', async () => {
    const wallet = await demoWalletProvider.getWallet('demo')
    expect(wallet.connected).toBe(true)
    expect(wallet.data.accountMode).toBe('demo')
    expect(wallet.data.isSimulated).toBe(true)
    expect(wallet.data.availableBalance).toBe(DEMO_STARTING_BALANCE)
  })

  it('places DEMO trades on the simulated feed without a live connection', async () => {
    const result = await demoTradingProvider.placeTrade({
      symbol: 'R_75',
      contractType: 'EVEN_ODD',
      contractOption: 'even',
      stake: 10,
      durationMs: 15_000,
      kind: 'demo',
      accountMode: 'demo',
    })
    expect(result.data).not.toBeNull()
    const wallet = await demoWalletProvider.getWallet('demo')
    expect(wallet.data.availableBalance).toBe(DEMO_STARTING_BALANCE - 10)
  })

  it('places EVEN/ODD, MATCH/DIFFER, OVER/UNDER DEMO trades', async () => {
    seedLive(['R_75', 'R_50'])
    const even = await demoTradingProvider.placeTrade({
      symbol: 'R_75',
      contractType: 'EVEN_ODD',
      contractOption: 'even',
      stake: 10,
      durationMs: 15_000,
      kind: 'demo',
      accountMode: 'demo',
    })
    const match = await demoTradingProvider.placeTrade({
      symbol: 'R_75',
      contractType: 'MATCH_DIFFER',
      contractOption: 'match',
      selectedDigit: 4,
      stake: 5,
      durationMs: 15_000,
      kind: 'demo',
      accountMode: 'demo',
    })
    const over = await demoTradingProvider.placeTrade({
      symbol: 'R_50',
      contractType: 'OVER_UNDER',
      contractOption: 'over',
      barrier: 5,
      stake: 5,
      durationMs: 15_000,
      kind: 'demo',
      accountMode: 'demo',
    })
    expect(even.data?.accountMode).toBe('demo')
    expect(even.data?.isSimulated).toBe(true)
    expect(even.data?.contractType).toBe('EVEN_ODD')
    expect(even.data?.contractOption).toBe('even')
    expect(match.data?.selectedDigit).toBe(4)
    expect(over.data?.barrier).toBe(5)
    expect(over.data?.market).toBe('R_50')
    expect(over.data?.result).toBe('open')
    const open = await demoTradingProvider.listOpen('demo')
    expect(open.data.length).toBe(3)
    const wallet = await demoWalletProvider.getWallet('demo')
    expect(wallet.data.availableBalance).toBe(DEMO_STARTING_BALANCE - 20)
    expect(wallet.data.lockedBalance).toBe(20)
  })

  it('settles due trades on the first genuine tick after expiry', async () => {
    const t0 = Date.now()
    recordTicks('R_75', [liveTick('R_75', 1234.56, t0)])
    const placed = await demoTradingProvider.placeTrade({
      symbol: 'R_75',
      contractType: 'EVEN_ODD',
      contractOption: 'odd',
      stake: 20,
      durationMs: 2_000,
      kind: 'demo',
      accountMode: 'demo',
    })
    expect(placed.data).toBeTruthy()
    expect(placed.data?.entryPrice).toBe(1234.56)
    // No tick after expiry yet → stays open, nothing invented.
    expect(settleDemoTrades(t0 + 5_000)).toHaveLength(0)
    // 1234.50 has last digit 0 at pip 0.01 (EVEN) — must not be read as 5.
    recordTicks('R_75', [liveTick('R_75', 1234.5, t0 + 1_000), liveTick('R_75', 1234.5, t0 + 2_000)])
    const settled = settleDemoTrades(t0 + 5_000)
    expect(settled.length).toBe(1)
    expect(settled[0]?.accountMode).toBe('demo')
    expect(settled[0]?.isSimulated).toBe(true)
    expect(settled[0]?.exitPrice).toBe(1234.5)
    expect(settled[0]?.exitDigit).toBe(0)
    expect(settled[0]?.result).toBe('lost')
    expect(settled[0]?.resolvedAt).toBeTruthy()
    const history = await demoTradingProvider.listHistory('demo')
    expect(history.data.some((trade) => trade.id === placed.data?.id)).toBe(true)
    const tx = await demoWalletProvider.listTransactions('demo')
    expect(tx.data.some((item) => item.reference === placed.data?.id)).toBe(true)
    expect(tx.data.every((item) => item.accountMode === 'demo' && item.isSimulated)).toBe(true)
  })

  it('refunds the stake when no genuine exit tick ever arrives', async () => {
    const t0 = Date.now()
    recordTicks('R_50', [liveTick('R_50', 99.12, t0)])
    const placed = await demoTradingProvider.placeTrade({
      symbol: 'R_50',
      contractType: 'MATCH_DIFFER',
      contractOption: 'match',
      selectedDigit: 2,
      stake: 10,
      durationMs: 1_000,
      kind: 'demo',
      accountMode: 'demo',
    })
    expect(placed.data).toBeTruthy()
    const settled = settleDemoTrades(t0 + 11 * 60_000)
    expect(settled[0]?.status).toBe('cancelled')
    expect(settled[0]?.profitLoss).toBe(0)
    expect(settled[0]?.exitPrice).toBeNull()
    const wallet = await demoWalletProvider.getWallet('demo')
    expect(wallet.data.availableBalance).toBe(DEMO_STARTING_BALANCE)
    expect(wallet.data.lockedBalance).toBe(0)
  })

  it('supports DEMO deposit and withdrawal', async () => {
    const deposit = await demoWalletProvider.requestDeposit({ amount: 100, method: 'bank', kind: 'demo' })
    expect(deposit.data?.isSimulated).toBe(true)
    expect(deposit.data?.accountMode).toBe('demo')
    const afterDeposit = await demoWalletProvider.getWallet('demo')
    expect(afterDeposit.data.availableBalance).toBe(DEMO_STARTING_BALANCE + 100)
    const withdrawal = await demoWalletProvider.requestWithdrawal({
      amount: 50,
      destination: 'demo-dest',
      kind: 'demo',
    })
    expect(withdrawal.data?.isSimulated).toBe(true)
    const afterWithdraw = await demoWalletProvider.getWallet('demo')
    expect(afterWithdraw.data.availableBalance).toBe(DEMO_STARTING_BALANCE + 50)
  })
})

describe('REAL providers stay NOT_CONNECTED', () => {
  it('refuses real trading and never invents balances', async () => {
    const quote = await realTradingProvider.getQuote({ stake: 10, durationMs: 15_000, symbol: 'R_75' })
    expect(quote.connected).toBe(false)
    expect(quote.data.available).toBe(false)
    const place = await realTradingProvider.placeTrade({
      symbol: 'R_75',
      contractType: 'EVEN_ODD',
      contractOption: 'even',
      stake: 10,
      durationMs: 15_000,
      kind: 'real',
      accountMode: 'real',
    })
    expect(place.connected).toBe(false)
    expect(place.data).toBeNull()
    const wallet = await realWalletProvider.getWallet('real')
    expect(wallet.connected).toBe(false)
    expect(wallet.data.balance).toBeNull()
    expect(wallet.data.status).toBe('not_connected')
  })

  it('labels every market as simulated practice data', async () => {
    const demoMarkets = await demoMarketDataProvider.listMarkets()
    const realMarkets = await realMarketDataProvider.listMarkets()
    expect(demoMarketDataProvider.isSimulated).toBe(true)
    for (const market of [...demoMarkets, ...realMarkets]) {
      expect(market.feedLabel).toMatch(/SIMULATED/i)
    }
  })

  it('disables real bots and copy trading', async () => {
    const bot = await realBotProvider.start({
      botId: 'parity-filter',
      stake: 1,
      takeProfit: null,
      stopLoss: null,
      maxRuns: 1,
      lossStreakLimit: 1,
      kind: 'real',
    })
    expect(bot.connected).toBe(false)
    const copy = await realCopyTradingProvider.startCopy({
      copyTraderId: 'ph-01',
      allocation: 10,
      maxDailyLoss: 5,
      kind: 'real',
    })
    expect(copy.connected).toBe(false)
  })
})

describe('DEMO bots, copy trading, auth, persistence', () => {
  it('starts and stops DEMO bots', async () => {
    const start = await demoBotProvider.start({
      botId: 'parity-filter',
      stake: 1,
      takeProfit: null,
      stopLoss: null,
      maxRuns: 5,
      lossStreakLimit: 2,
      kind: 'demo',
    })
    expect(start.data?.accountMode).toBe('demo')
    expect(start.data?.isSimulated).toBe(true)
    expect(start.data?.status).toBe('running')
    const stop = await demoBotProvider.stop('parity-filter', 'demo')
    expect(stop.data?.status).toBe('stopped')
  })

  it('starts and stops DEMO copy trading', async () => {
    const start = await demoCopyTradingProvider.startCopy({
      copyTraderId: 'ph-01',
      allocation: 12,
      maxDailyLoss: 4,
      kind: 'demo',
    })
    expect(start.data?.accountMode).toBe('demo')
    expect(start.data?.isSimulated).toBe(true)
    const stop = await demoCopyTradingProvider.stopCopy('ph-01', 'demo')
    expect(stop.data?.status).toBe('inactive')
  })

  it('keeps auth offline in unit tests without Supabase env', async () => {
    const signup = await authService.signUp({
      name: 'Demo Trader',
      email: 'demo-flow@example.com',
      password: 'demopass1',
      phone: '+15550001111',
      country: 'United States',
    })
    expect(signup.connected).toBe(false)
    expect(signup.message).toMatch(/temporarily unavailable/i)
    expect(signup.message).not.toMatch(/supabase|VITE_|\.env/i)
    const session = await authService.getSession()
    expect(session.connected).toBe(false)
    expect(session.data).toBeNull()
  })

  it('persists DEMO state across reload simulation', async () => {
    seedLive(['R_50'])
    saveDemoSession({ email: 'persist@example.com', name: 'Persist', password: 'demopass1' })
    await demoWalletProvider.requestDeposit({ amount: 25, method: 'bank', kind: 'demo' })
    await demoTradingProvider.placeTrade({
      symbol: 'R_50',
      contractType: 'MATCH_DIFFER',
      contractOption: 'differ',
      selectedDigit: 3,
      stake: 8,
      durationMs: 60_000,
      kind: 'demo',
      accountMode: 'demo',
    })
    const snapshot = loadDemoState()
    persistDemoState(snapshot)
    const reloaded = createInitialDemoState()
    expect(reloaded.wallet.balance).toBe(DEMO_STARTING_BALANCE)
    resetDemoState()
    persistDemoState(snapshot)
    const again = loadDemoState()
    expect(again.wallet.availableBalance).toBe(snapshot.wallet.availableBalance)
    expect(again.trades.length).toBe(snapshot.trades.length)
    expect(again.transactions.length).toBe(snapshot.transactions.length)
  })
})
