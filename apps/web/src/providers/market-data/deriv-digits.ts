import { REAL_TRADE_SYMBOLS } from '@/domain/digit-contracts'
import type { Candle, Timeframe } from '@/types'

/** Normalized REAL quote for digit contracts — never invent digits. */
export type RealMarketQuote = {
  symbol: string
  quote: number
  epoch: number
  pipSize: number
  lastDigit: number | null
  connectionStatus: 'CONNECTING' | 'CONNECTED' | 'DISCONNECTED' | 'ERROR' | 'RECONNECTING'
}

export { extractLastDigit, normalizePipSize } from '@/domain/digit-contracts'

export function timeframeToDerivGranularity(timeframe: Timeframe): number | null {
  switch (timeframe) {
    case '1m':
      return 60
    case '5m':
      return 300
    case '15m':
      return 900
    case '30m':
      return 1800
    case '1h':
      return 3600
    case '4h':
      return 14400
    case '1d':
      return 86400
    default:
      return null
  }
}

export function timeframeToMs(timeframe: Timeframe): number {
  switch (timeframe) {
    case '1m':
      return 60_000
    case '5m':
      return 300_000
    case '15m':
      return 900_000
    case '30m':
      return 1_800_000
    case '1h':
      return 3_600_000
    case '4h':
      return 14_400_000
    case '1d':
      return 86_400_000
    default:
      return 60_000
  }
}

/** Deriv `ticks_history` (style: candles) row → app candle (ms). Null when any field is invalid. */
export function mapDerivCandle(raw: {
  epoch?: unknown
  open?: unknown
  high?: unknown
  low?: unknown
  close?: unknown
}): Candle | null {
  const epoch = Number(raw.epoch)
  const open = Number(raw.open)
  const high = Number(raw.high)
  const low = Number(raw.low)
  const close = Number(raw.close)
  if (![epoch, open, high, low, close].every(Number.isFinite)) return null
  return { time: epoch * 1000, open, high, low, close }
}

/**
 * Deriv `ohlc` stream message (string prices; `open_time` = candle start, `epoch` = latest tick)
 * → app candle keyed by its start time. Null when any field is invalid.
 */
export function mapDerivOhlc(raw: {
  open_time?: unknown
  open?: unknown
  high?: unknown
  low?: unknown
  close?: unknown
}): Candle | null {
  return mapDerivCandle({ ...raw, epoch: raw.open_time })
}

/** Build / update OHLC candles from genuine tick prices. */
export function applyTickToCandles(
  candles: Candle[],
  price: number,
  epochMs: number,
  timeframeMs: number,
): Candle[] {
  if (!Number.isFinite(price) || !Number.isFinite(epochMs) || timeframeMs <= 0) return candles
  const bucket = Math.floor(epochMs / timeframeMs) * timeframeMs
  const next = [...candles]
  const last = next[next.length - 1]
  if (!last || last.time < bucket) {
    next.push({ time: bucket, open: price, high: price, low: price, close: price })
    return next
  }
  if (last.time === bucket) {
    next[next.length - 1] = {
      ...last,
      high: Math.max(last.high, price),
      low: Math.min(last.low, price),
      close: price,
    }
  }
  return next
}

export function candlesFromHistory(
  prices: number[],
  times: number[],
  timeframeMs: number,
): Candle[] {
  let candles: Candle[] = []
  const n = Math.min(prices.length, times.length)
  for (let i = 0; i < n; i += 1) {
    const price = prices[i]!
    const epochMs = times[i]! * (times[i]! < 1e12 ? 1000 : 1)
    candles = applyTickToCandles(candles, price, epochMs, timeframeMs)
  }
  return candles
}

export const DERIV_PREFERRED_SYMBOLS = REAL_TRADE_SYMBOLS
