import { describe, expect, it } from 'vitest'
import { initialChartMode, selectChartMode, selectChartStyle } from '@/domain/chart-selection'

describe('chart type / timeframe selection', () => {
  it('Candles and OHLC on Tick switch the timeframe to 1m', () => {
    expect(selectChartStyle({ mode: 'ticks', style: 'line' }, 'candles')).toEqual({ mode: '1m', style: 'candles' })
    expect(selectChartStyle({ mode: 'ticks', style: 'line' }, 'ohlc')).toEqual({ mode: '1m', style: 'ohlc' })
  })

  it('switching chart type on a timeframe keeps the timeframe', () => {
    for (const mode of ['1m', '5m', '15m', '30m', '1h', '4h', '1d'] as const) {
      expect(selectChartStyle({ mode, style: 'candles' }, 'ohlc')).toEqual({ mode, style: 'ohlc' })
      expect(selectChartStyle({ mode, style: 'ohlc' }, 'candles')).toEqual({ mode, style: 'candles' })
      expect(selectChartStyle({ mode, style: 'ohlc' }, 'line')).toEqual({ mode, style: 'line' })
    }
  })

  it('Line stays on Tick', () => {
    expect(selectChartStyle({ mode: 'ticks', style: 'line' }, 'line')).toEqual({ mode: 'ticks', style: 'line' })
  })

  it('Tick always draws a line; other timeframes keep the chart type', () => {
    expect(selectChartMode({ mode: '5m', style: 'candles' }, 'ticks')).toEqual({ mode: 'ticks', style: 'line' })
    expect(selectChartMode({ mode: '5m', style: 'ohlc' }, '1h')).toEqual({ mode: '1h', style: 'ohlc' })
  })

  it('a remembered candle style opens on 1m', () => {
    expect(initialChartMode('line')).toBe('ticks')
    expect(initialChartMode('candles')).toBe('1m')
    expect(initialChartMode('ohlc')).toBe('1m')
  })
})
