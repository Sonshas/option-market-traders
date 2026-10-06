import type { Candle, Tick, Trade, WalletLedger } from '@/types'

/** Time-value point in milliseconds since epoch. */
export type SeriesPoint = { time: number; value: number }

/** lightweight-charts wants strictly ascending whole-second times. */
export type ChartLinePoint = { time: number; value: number }
export type ChartCandlePoint = { time: number; open: number; high: number; low: number; close: number }

function toSeconds(ms: number): number {
  return Math.floor(ms / 1000)
}

/** Sort, convert to seconds, and keep the last value per second. */
export function toChartLine(points: SeriesPoint[]): ChartLinePoint[] {
  const sorted = points
    .filter((point) => Number.isFinite(point.time) && Number.isFinite(point.value))
    .sort((a, b) => a.time - b.time)
  const out: ChartLinePoint[] = []
  for (const point of sorted) {
    const time = toSeconds(point.time)
    const last = out[out.length - 1]
    if (last && last.time === time) last.value = point.value
    else out.push({ time, value: point.value })
  }
  return out
}

export function ticksToChartLine(ticks: Tick[]): ChartLinePoint[] {
  return toChartLine(
    ticks.filter((tick) => !tick.isSimulated).map((tick) => ({ time: tick.timestamp, value: tick.price })),
  )
}

export function candlesToChart(candles: Candle[]): ChartCandlePoint[] {
  const sorted = candles
    .filter((c) => [c.time, c.open, c.high, c.low, c.close].every(Number.isFinite))
    .sort((a, b) => a.time - b.time)
  const out: ChartCandlePoint[] = []
  for (const candle of sorted) {
    const time = toSeconds(candle.time)
    const point = { time, open: candle.open, high: candle.high, low: candle.low, close: candle.close }
    const last = out[out.length - 1]
    if (last && last.time === time) out[out.length - 1] = point
    else out.push(point)
  }
  return out
}

/** Line of official candle closes (Line style on a timeframe). */
export function candlesToCloseLine(candles: Candle[]): ChartLinePoint[] {
  return candlesToChart(candles).map((candle) => ({ time: candle.time, value: candle.close }))
}

/** Wallet balance over time from ledger rows that carry `balanceAfter`. */
export function balanceSeriesFromLedger(ledger: WalletLedger[], startingBalance?: number | null): SeriesPoint[] {
  const rows = ledger
    .filter((row) => row.balanceAfter != null && Number.isFinite(row.balanceAfter))
    .map((row) => ({ time: new Date(row.createdAt).getTime(), value: row.balanceAfter as number }))
    .filter((point) => Number.isFinite(point.time))
    .sort((a, b) => a.time - b.time)
  if (rows.length > 0 && startingBalance != null && Number.isFinite(startingBalance)) {
    return [{ time: rows[0]!.time - 1000, value: startingBalance }, ...rows]
  }
  return rows
}

function closedAt(trade: Trade): number {
  return new Date(trade.resolvedAt ?? trade.updatedAt ?? trade.createdAt).getTime()
}

/** Settled trades only (won / lost / tie / cancelled with a numeric P/L), oldest first. */
export function settledTrades(trades: Trade[]): Trade[] {
  return trades
    .filter((trade) => trade.status !== 'open' && trade.profitLoss != null && Number.isFinite(trade.profitLoss))
    .sort((a, b) => closedAt(a) - closedAt(b))
}

/** Running total of realized P/L. */
export function cumulativePnlSeries(trades: Trade[]): SeriesPoint[] {
  let total = 0
  return settledTrades(trades).map((trade) => {
    total = Math.round((total + (trade.profitLoss as number)) * 100) / 100
    return { time: closedAt(trade), value: total }
  })
}

export type TradeSummary = {
  total: number
  wins: number
  losses: number
  ties: number
  /** Share of decided trades won, in percent; null when nothing settled. */
  winRate: number | null
  netPnl: number
  totalStaked: number
}

export function summarizeTrades(trades: Trade[]): TradeSummary {
  const settled = settledTrades(trades)
  let wins = 0
  let losses = 0
  let ties = 0
  let netPnl = 0
  let totalStaked = 0
  for (const trade of settled) {
    if (trade.status === 'won') wins += 1
    else if (trade.status === 'lost') losses += 1
    else ties += 1
    netPnl += trade.profitLoss as number
    totalStaked += trade.stake
  }
  const decided = wins + losses
  return {
    total: settled.length,
    wins,
    losses,
    ties,
    winRate: decided > 0 ? Math.round((wins / decided) * 10_000) / 100 : null,
    netPnl: Math.round(netPnl * 100) / 100,
    totalStaked: Math.round(totalStaked * 100) / 100,
  }
}
