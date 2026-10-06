import { describe, expect, it } from 'vitest'
import {
  AUTO_TRADE_DEFAULTS,
  AUTO_HIDDEN_DEFAULTS,
  evaluateAutoStop,
  nextAutoStake,
  validateAutoSettings,
  type AutoTradeSettings,
} from '@/domain/auto-trade'
import { SCANNER_DISCLAIMER, describeScan, scanDigits } from '@/domain/digit-scanner'
import { LOAD_PREDICTION_FIRST, validatePrediction, type ScanResult } from '@/domain/prediction'
import { directionPayoutLabel, payoutSummary, tickHint, ticksRemaining } from '@/domain/ticket'
import { candlesToCloseLine } from '@/domain/chart-data'

const settings: AutoTradeSettings = {
  account: 'DEMO',
  durationTicks: 5,
  baseStake: 10,
  maxTrades: 20,
  stopOnInsufficientBalance: true,
  ...AUTO_TRADE_DEFAULTS,
}

describe('Auto Trade Martingale', () => {
  it('uses the owner defaults', () => {
    expect(AUTO_TRADE_DEFAULTS).toEqual({ targetProfit: 20, stopLoss: 50, multiplier: 2, maxLossStreak: 6, maxStake: 500 })
  })

  it('keeps the hidden safety stops on: a trade cap and stop on low balance (no random modes)', () => {
    expect(AUTO_HIDDEN_DEFAULTS).toEqual({
      maxTrades: 1000,
      stopOnInsufficientBalance: true,
    })
    expect(validateAutoSettings({ ...settings, ...AUTO_HIDDEN_DEFAULTS })).toBeNull()
  })

  it('multiplies after a loss, resets after a win, keeps the stake on a refund', () => {
    const cfg = { baseStake: 1, multiplier: 2 }
    let stake = nextAutoStake(1, null, cfg)
    const seq = [stake]
    for (const outcome of ['lost', 'lost', 'lost', 'won', 'cancelled'] as const) {
      stake = nextAutoStake(stake, outcome, cfg)
      seq.push(stake)
    }
    expect(seq).toEqual([1, 2, 4, 8, 1, 1])
    expect(nextAutoStake(1.55, 'lost', { baseStake: 1, multiplier: 1.5 })).toBe(2.33)
  })

  it('stops on target, stop loss, loss streak, max stake and balance', () => {
    const ok = { realizedPnl: 0, lossStreak: 0 }
    expect(evaluateAutoStop(ok, 10, 1000, settings)).toBeNull()
    expect(evaluateAutoStop({ realizedPnl: 20, lossStreak: 0 }, 10, 1000, settings)).toMatch(/Target profit/)
    expect(evaluateAutoStop({ realizedPnl: -50, lossStreak: 2 }, 10, 1000, settings)).toMatch(/Stop loss/)
    expect(evaluateAutoStop({ realizedPnl: -10, lossStreak: 6 }, 10, 1000, settings)).toMatch(/6 losses in a row/)
    expect(evaluateAutoStop(ok, 640, 1000, settings)).toMatch(/max stake/)
    expect(evaluateAutoStop(ok, 40, 30, settings)).toMatch(/Balance too low/)
  })

  it('validates settings before starting', () => {
    expect(validateAutoSettings(settings)).toBeNull()
    expect(validateAutoSettings({ ...settings, multiplier: 4 })).toMatch(/×1 and ×3/)
    expect(validateAutoSettings({ ...settings, baseStake: 0.1 })).toMatch(/at least/)
    expect(validateAutoSettings({ ...settings, targetProfit: 0 })).toMatch(/Target profit/)
    expect(validateAutoSettings({ ...settings, maxStake: 5 })).toMatch(/Max stake/)
    expect(validateAutoSettings({ ...settings, account: 'REAL', baseStake: 0.5 })).toMatch(/Minimum stake/)
    expect(validateAutoSettings({ ...settings, account: 'REAL', maxStake: 600 })).toMatch(/Max stake for REAL/)
    expect(validateAutoSettings({ ...settings, maxTrades: 0 })).toMatch(/Number of trades/)
  })

  it('validates the loaded prediction before starting', () => {
    const base: ScanResult = {
      id: 'scan-1',
      contract: 'EVEN_ODD',
      side: 'odd',
      symbol: 'R_100',
      volatilityLabel: '100',
      scannedAt: 0,
      sampleSize: 1000,
    }
    expect(validatePrediction(null, 'DEMO')).toBe(LOAD_PREDICTION_FIRST)
    expect(validatePrediction(base, 'DEMO')).toBeNull()
    expect(validatePrediction({ ...base, contract: 'OVER_UNDER', side: 'over', barrier: 9 }, 'DEMO')).toMatch(/cannot win/)
    expect(validatePrediction({ ...base, contract: 'OVER_UNDER', side: 'under', barrier: 0 }, 'DEMO')).toMatch(/cannot win/)
    expect(validatePrediction({ ...base, contract: 'MATCH_DIFFER', side: 'match' }, 'DEMO')).toMatch(/target digit/)
    expect(validatePrediction({ ...base, side: 'over' }, 'DEMO')).toMatch(/invalid/)
    expect(validatePrediction({ ...base, symbol: 'BTCUSDT' }, 'REAL')).toMatch(/not available for REAL/)
  })
})

describe('Digit Scanner', () => {
  it('ranks by count with ties broken by the smaller digit, counts only', () => {
    const scan = scanDigits([1, 1, 2, 2, 3, 0, 0, 7, 9, 9, 4], 1000, 5)
    expect(scan.sampleSize).toBe(11)
    expect(scan.ranked.slice(0, 4).map((r) => r.digit)).toEqual([0, 1, 2, 9])
    expect(scan.hottest).toEqual([0, 1, 2, 9])
    expect(scan.coldest).toEqual([5, 6, 8])
    expect(scan.evenCount).toBe(5)
    expect(scan.oddCount).toBe(6)
    expect([scan.overCount, scan.underCount, scan.equalCount]).toEqual([3, 8, 0])
    const text = describeScan(scan)
    expect(text).not.toContain('%')
    expect(SCANNER_DISCLAIMER).not.toContain('%')
    expect(text).toContain('Most frequent 0 (2)')
  })

  it('only uses the latest window and handles no data', () => {
    expect(scanDigits([5, 5, 5, 1], 2).sampleSize).toBe(2)
    const empty = scanDigits([], 100)
    expect(empty.hottest).toEqual([])
    expect(describeScan(empty)).toBe('No ticks yet')
  })
})

describe('ticket labels', () => {
  const even = { contractType: 'EVEN_ODD', contractOption: 'even', selectedDigit: null, barrier: null } as const

  it('shows payout from the server rate', () => {
    expect(directionPayoutLabel(10, even)).toBe('Payout $19.00')
    expect(payoutSummary(10, even)).toBe('$19.00 USD • 90.00%')
    expect(directionPayoutLabel(50, even)).toBe('Payout $95.00')
    const dead = { contractType: 'OVER_UNDER', contractOption: 'over', selectedDigit: null, barrier: 9 } as const
    expect(directionPayoutLabel(10, dead)).toBe('Payout $0.00 · cannot win')
  })

  it('never claims 1 second where ticks are 2 seconds apart', () => {
    expect(tickHint('1HZ100V')).toBe('Each tick ≈ 1 second')
    expect(tickHint('R_100')).toBe('Each tick ≈ 2 seconds')
    expect(tickHint('BTCUSDT', [0, 3000, 6000, 9000])).toBe('Each tick is about 3 seconds')
    expect(tickHint('BTCUSDT')).toBe('Tick spacing depends on the market')
  })

  it('counts remaining ticks after the anchor', () => {
    expect(ticksRemaining({ durationTicks: 5, tickAnchorMs: 1000 }, [500, 1000, 2000, 3000])).toBe(3)
    expect(ticksRemaining({ durationTicks: 2, tickAnchorMs: 1000 }, [2000, 3000, 4000])).toBe(0)
    expect(ticksRemaining({ durationTicks: null, tickAnchorMs: null }, [2000])).toBeNull()
  })
})

describe('chart line from candles', () => {
  it('draws candle closes for Line on a timeframe', () => {
    const line = candlesToCloseLine([
      { time: 120_000, open: 2, high: 4, low: 1, close: 3 },
      { time: 60_000, open: 1, high: 3, low: 0.5, close: 2 },
    ])
    expect(line).toEqual([
      { time: 60, value: 2 },
      { time: 120, value: 3 },
    ])
  })
})
