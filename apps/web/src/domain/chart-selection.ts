import type { Timeframe } from '@/types'

export type ChartMode = 'ticks' | Timeframe
export type ChartStyle = 'line' | 'candles' | 'ohlc'
export type ChartSelection = { mode: ChartMode; style: ChartStyle }

/** Deriv serves no candles under one minute, so candle styles leave Tick for this timeframe. */
export const CANDLE_FALLBACK_TIMEFRAME: Timeframe = '1m'

/** Picking a chart type. Candles/OHLC on Tick move the timeframe to 1m instead of doing nothing. */
export function selectChartStyle(current: ChartSelection, style: ChartStyle): ChartSelection {
  if (style !== 'line' && current.mode === 'ticks') return { mode: CANDLE_FALLBACK_TIMEFRAME, style }
  return { mode: current.mode, style }
}

/** Picking a timeframe. Tick has no OHLC, so it always draws a line. */
export function selectChartMode(current: ChartSelection, mode: ChartMode): ChartSelection {
  return { mode, style: mode === 'ticks' ? 'line' : current.style }
}

/** Opening the desk with a remembered candle style starts on 1m so the chart matches the selected tab. */
export function initialChartMode(style: ChartStyle): ChartMode {
  return style === 'line' ? 'ticks' : CANDLE_FALLBACK_TIMEFRAME
}
