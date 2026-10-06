import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import {
  BarSeries,
  CandlestickSeries,
  ColorType,
  CrosshairMode,
  LineSeries,
  LineStyle,
  TickMarkType,
  createChart,
  type IChartApi,
  type IPriceLine,
  type ISeriesApi,
  type SeriesType,
  type Time,
  type UTCTimestamp,
} from 'lightweight-charts'
import { Badge } from '@/components/ui'
import { cn } from '@/lib/cn'
import { TIMEFRAMES } from '@/lib/constants'
import { formatQuote, pipDecimals } from '@/lib/format'
import { PALETTE } from '@/lib/palette'
import { candlesToChart, candlesToCloseLine, ticksToChartLine } from '@/domain/chart-data'
import {
  selectChartMode,
  selectChartStyle,
  type ChartMode,
  type ChartSelection,
  type ChartStyle,
} from '@/domain/chart-selection'
import type { Candle, ConnectionStatus, Tick } from '@/types'

export type { ChartMode, ChartSelection, ChartStyle }

const NOTICE_MS = 8000

export type ChartPriceLine = { price: number; label: string; tone: 'call' | 'put' | 'signal' }

const COLORS = {
  text: PALETTE.mist,
  grid: PALETTE.grid,
  border: PALETTE.line,
  signal: PALETTE.signal,
  call: PALETTE.call,
  put: PALETTE.put,
}

const CHART_STYLES: Array<{ id: ChartStyle; label: string }> = [
  { id: 'line', label: 'Line' },
  { id: 'candles', label: 'Candles' },
  { id: 'ohlc', label: 'OHLC' },
]

export function timeframeLabel(mode: ChartMode): string {
  if (mode === 'ticks') return 'Tick'
  if (mode === '1d') return '1D'
  return mode
}

function statusLabel(status: ConnectionStatus): string {
  switch (status) {
    case 'live':
      return 'CONNECTED'
    case 'connecting':
      return 'CONNECTING'
    default:
      return 'DISCONNECTED'
  }
}

function statusTone(status: ConnectionStatus): 'signal' | 'warn' | 'amber' {
  switch (status) {
    case 'live':
      return 'signal'
    case 'connecting':
      return 'amber'
    default:
      return 'warn'
  }
}

function toDate(time: Time): Date {
  if (typeof time === 'number') return new Date(time * 1000)
  if (typeof time === 'string') return new Date(time)
  return new Date(time.year, time.month - 1, time.day)
}

/** Axis labels in the viewer's local time (lightweight-charts defaults to UTC). */
function localTickMark(time: Time, type: TickMarkType): string {
  const date = toDate(time)
  switch (type) {
    case TickMarkType.Year:
      return String(date.getFullYear())
    case TickMarkType.Month:
      return date.toLocaleDateString(undefined, { month: 'short' })
    case TickMarkType.DayOfMonth:
      return date.toLocaleDateString(undefined, { day: 'numeric', month: 'short' })
    case TickMarkType.TimeWithSeconds:
      return date.toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit', second: '2-digit' })
    default:
      return date.toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' })
  }
}

/**
 * Market chart (TradingView lightweight-charts) for genuine Deriv data only:
 * Tick = line of real ticks at their Deriv epochs; timeframes = official Deriv OHLC candles drawn as
 * a close line, candlesticks or OHLC bars. No interpolation, smoothing or candles built from ticks.
 */
export function PriceChart({
  mode,
  chartStyle = 'line',
  onSelectionChange,
  ticks,
  candles,
  status,
  pipSize = null,
  loading = false,
  error = null,
  compact = false,
  marketLabel,
  symbol,
  currentPrice = null,
  lastUpdateAt = null,
  unavailableNote = null,
  accountBadge,
  priceLines = [],
  toolbarStart,
  footer,
}: {
  mode: ChartMode
  chartStyle?: ChartStyle
  /** Chart type and timeframe change together (Candles/OHLC cannot run on Tick). */
  onSelectionChange: (next: ChartSelection) => void
  ticks: Tick[]
  candles: Candle[]
  status: ConnectionStatus
  pipSize?: number | null
  loading?: boolean
  /** Honest reason the chart data could not be loaded. */
  error?: string | null
  compact?: boolean
  marketLabel?: string
  symbol?: string
  /** Latest Deriv tick quote. */
  currentPrice?: number | null
  /** Deriv epoch (ms) of the latest tick. */
  lastUpdateAt?: number | null
  unavailableNote?: string | null
  accountBadge?: { label: string; tone: 'demo' | 'live' }
  priceLines?: ChartPriceLine[]
  /** Rendered first in the toolbar (market selector). */
  toolbarStart?: ReactNode
  /** Rendered under the chart inside the same card (digit row). */
  footer?: ReactNode
}) {
  const wrapRef = useRef<HTMLDivElement>(null)
  const chartRef = useRef<IChartApi | null>(null)
  const lineRef = useRef<ISeriesApi<'Line'> | null>(null)
  const candleRef = useRef<ISeriesApi<'Candlestick'> | null>(null)
  const barRef = useRef<ISeriesApi<'Bar'> | null>(null)
  const linesRef = useRef<Array<{ series: ISeriesApi<SeriesType>; line: IPriceLine }>>([])
  const fittedKeyRef = useRef<string>('')
  const renderedRef = useRef<{ key: string; dataKey: string; firstTime: number; length: number }>({
    key: '',
    dataKey: '',
    firstTime: 0,
    length: 0,
  })
  const [notice, setNotice] = useState<string | null>(null)

  useEffect(() => {
    if (!notice) return
    const timer = window.setTimeout(() => setNotice(null), NOTICE_MS)
    return () => window.clearTimeout(timer)
  }, [notice])

  const isTicks = mode === 'ticks'
  // Ticks carry no OHLC, so Tick mode always draws a line.
  const effectiveStyle: ChartStyle = isTicks ? 'line' : chartStyle
  const decimals = pipDecimals(pipSize) ?? 2
  const lineData = useMemo(
    () => (isTicks ? ticksToChartLine(ticks) : effectiveStyle === 'line' ? candlesToCloseLine(candles) : []),
    [isTicks, effectiveStyle, ticks, candles],
  )
  const candleData = useMemo(() => (isTicks ? [] : candlesToChart(candles)), [isTicks, candles])
  const pointCount = isTicks ? lineData.length : candleData.length
  // Same market + timeframe = same data; only the chart type differs between Line, Candles and OHLC.
  const dataKey = `${mode}|${symbol ?? marketLabel ?? ''}`
  const seriesKey = `${dataKey}|${effectiveStyle}`

  function chooseStyle(style: ChartStyle) {
    const next = selectChartStyle({ mode, style: effectiveStyle }, style)
    if (next.mode !== mode) {
      setNotice(`${style === 'ohlc' ? 'OHLC' : 'Candles'} need a timeframe — switched Tick to ${timeframeLabel(next.mode)}`)
    }
    if (next.mode !== mode || next.style !== chartStyle) onSelectionChange(next)
  }

  function chooseMode(nextMode: ChartMode) {
    const next = selectChartMode({ mode, style: chartStyle }, nextMode)
    if (nextMode === 'ticks' && chartStyle !== 'line') setNotice('Tick shows a line chart — Deriv has no sub-minute candles')
    if (next.mode !== mode || next.style !== chartStyle) onSelectionChange(next)
  }

  useEffect(() => {
    const wrap = wrapRef.current
    if (!wrap) return
    const chart = createChart(wrap, {
      autoSize: true,
      layout: {
        background: { type: ColorType.Solid, color: 'transparent' },
        textColor: COLORS.text,
        fontSize: 11,
        attributionLogo: false,
      },
      grid: {
        vertLines: { color: COLORS.grid },
        horzLines: { color: COLORS.grid },
      },
      rightPriceScale: { borderColor: COLORS.border, scaleMargins: { top: 0.12, bottom: 0.08 } },
      timeScale: {
        borderColor: COLORS.border,
        timeVisible: true,
        secondsVisible: true,
        rightOffset: 4,
        tickMarkFormatter: localTickMark,
      },
      crosshair: { mode: CrosshairMode.Normal },
      localization: {
        timeFormatter: (time: Time) => toDate(time).toLocaleString(),
      },
    })
    chartRef.current = chart
    lineRef.current = chart.addSeries(LineSeries, {
      color: COLORS.signal,
      lineWidth: 2,
      priceLineColor: COLORS.signal,
      priceLineStyle: LineStyle.Dashed,
      lastValueVisible: true,
      priceLineVisible: true,
      lastPriceAnimation: 0,
      crosshairMarkerRadius: 3,
    })
    candleRef.current = chart.addSeries(CandlestickSeries, {
      upColor: COLORS.call,
      downColor: COLORS.put,
      borderUpColor: COLORS.call,
      borderDownColor: COLORS.put,
      wickUpColor: COLORS.call,
      wickDownColor: COLORS.put,
      priceLineStyle: LineStyle.Dashed,
      visible: false,
    })
    barRef.current = chart.addSeries(BarSeries, {
      upColor: COLORS.call,
      downColor: COLORS.put,
      thinBars: false,
      openVisible: true,
      priceLineStyle: LineStyle.Dashed,
      visible: false,
    })
    return () => {
      linesRef.current = []
      chart.remove()
      chartRef.current = null
      lineRef.current = null
      candleRef.current = null
      barRef.current = null
      fittedKeyRef.current = ''
      renderedRef.current = { key: '', dataKey: '', firstTime: 0, length: 0 }
    }
  }, [])

  useEffect(() => {
    const format = { type: 'price' as const, precision: decimals, minMove: 10 ** -decimals }
    lineRef.current?.applyOptions({ priceFormat: format })
    candleRef.current?.applyOptions({ priceFormat: format })
    barRef.current?.applyOptions({ priceFormat: format })
  }, [decimals])

  useEffect(() => {
    const chart = chartRef.current
    const line = lineRef.current
    const candle = candleRef.current
    const bar = barRef.current
    if (!chart || !line || !candle || !bar) return
    const data = effectiveStyle === 'line' ? lineData : candleData
    const prev = renderedRef.current
    const firstTime = data[0]?.time ?? 0
    // Chart type changed on the same data: swap series but keep the user's zoom/scroll.
    const keptRange =
      prev.dataKey === dataKey && prev.key !== seriesKey && prev.length > 0
        ? chart.timeScale().getVisibleLogicalRange()
        : null
    line.applyOptions({ visible: effectiveStyle === 'line' })
    candle.applyOptions({ visible: effectiveStyle === 'candles' })
    bar.applyOptions({ visible: effectiveStyle === 'ohlc' })
    // Live update: same series, same first point, at most one new point → update the tail only.
    const incremental =
      prev.key === seriesKey && prev.length > 0 && firstTime === prev.firstTime && data.length - prev.length <= 1 && data.length >= prev.length
    if (effectiveStyle === 'line') {
      if (incremental && lineData.length > 0) {
        const last = lineData[lineData.length - 1]!
        line.update({ time: last.time as UTCTimestamp, value: last.value })
      } else {
        line.setData(lineData.map((p) => ({ time: p.time as UTCTimestamp, value: p.value })))
        candle.setData([])
        bar.setData([])
      }
    } else {
      const target = effectiveStyle === 'candles' ? candle : bar
      if (incremental && candleData.length > 0) {
        const last = candleData[candleData.length - 1]!
        target.update({ ...last, time: last.time as UTCTimestamp })
      } else {
        target.setData(candleData.map((c) => ({ ...c, time: c.time as UTCTimestamp })))
        line.setData([])
        ;(effectiveStyle === 'candles' ? bar : candle).setData([])
      }
    }
    renderedRef.current = { key: seriesKey, dataKey, firstTime, length: data.length }

    if (keptRange && data.length > 0) {
      chart.timeScale().setVisibleLogicalRange(keptRange)
    } else if (pointCount > 1 && fittedKeyRef.current !== dataKey) {
      fittedKeyRef.current = dataKey
      const visible = isTicks ? 300 : 120
      if (pointCount > visible) {
        chart.timeScale().setVisibleLogicalRange({ from: pointCount - visible, to: pointCount + 4 })
      } else {
        chart.timeScale().fitContent()
      }
    }
  }, [effectiveStyle, isTicks, lineData, candleData, pointCount, seriesKey, dataKey])

  useEffect(() => {
    for (const { series, line } of linesRef.current) series.removePriceLine(line)
    linesRef.current = []
    const series: ISeriesApi<SeriesType> | null =
      effectiveStyle === 'line' ? lineRef.current : effectiveStyle === 'candles' ? candleRef.current : barRef.current
    if (!series) return
    for (const line of priceLines) {
      if (!Number.isFinite(line.price)) continue
      linesRef.current.push({
        series,
        line: series.createPriceLine({
          price: line.price,
          color: COLORS[line.tone],
          lineWidth: 1,
          lineStyle: LineStyle.Dotted,
          axisLabelVisible: true,
          title: line.label,
        }),
      })
    }
  }, [priceLines, effectiveStyle])

  const empty = pointCount === 0
  const showStaleWarning = !empty && status === 'disconnected'
  const emptyTitle = loading
    ? 'Loading live chart…'
    : error || status === 'disconnected'
      ? 'MARKET DATA UNAVAILABLE'
      : 'Waiting for live market data…'
  const emptyNote = loading ? null : (error ?? unavailableNote)
  const lastLine = lineData[lineData.length - 1]
  const lastCandle = candleData[candleData.length - 1]
  const firstCandle = candleData[0]

  return (
    <div
      className={cn(
        'flex min-h-0 flex-col overflow-hidden rounded-2xl border border-line sbb-chart',
        compact ? '' : 'h-full',
      )}
      data-testid="price-chart"
      data-mode={mode}
      data-style={effectiveStyle}
      data-symbol={symbol ?? ''}
      data-points={pointCount}
      data-last-time={effectiveStyle === 'line' ? (lastLine?.time ?? '') : (lastCandle?.time ?? '')}
      data-last-value={effectiveStyle === 'line' ? (lastLine?.value ?? '') : (lastCandle?.close ?? '')}
      data-first-candle={firstCandle ? JSON.stringify(firstCandle) : ''}
      data-second-candle={candleData[1] ? JSON.stringify(candleData[1]) : ''}
      data-last-candle={lastCandle ? JSON.stringify(lastCandle) : ''}
      data-status={status}
    >
      <div className="flex flex-wrap items-center gap-2 border-b border-line px-2.5 py-2">
        {toolbarStart}
        <div
          className="flex shrink-0 rounded-lg border border-line bg-ink-2 p-0.5"
          role="group"
          aria-label="Chart type"
        >
          {CHART_STYLES.map((item) => (
            <button
              key={item.id}
              type="button"
              aria-pressed={effectiveStyle === item.id}
              title={isTicks && item.id !== 'line' ? `${item.label} use 1m or longer — switches Tick to 1m` : undefined}
              onClick={() => chooseStyle(item.id)}
              className={cn(
                'rounded-md px-2 py-1 text-[11px] font-semibold transition-colors',
                effectiveStyle === item.id ? 'bg-signal/15 text-signal' : 'text-mist hover:text-paper',
              )}
            >
              {item.label}
            </button>
          ))}
        </div>
        <div
          className="sbb-scroll order-last flex w-full min-w-0 gap-0.5 overflow-x-auto"
          role="group"
          aria-label="Chart interval"
        >
          {(['ticks', ...TIMEFRAMES] as ChartMode[]).map((item) => (
            <button
              key={item}
              type="button"
              aria-pressed={mode === item}
              title={item === 'ticks' && effectiveStyle !== 'line' ? 'Tick shows a line chart (no sub-minute candles)' : undefined}
              onClick={() => chooseMode(item)}
              className={cn(
                'shrink-0 rounded-md px-2 py-1 font-mono text-[11px]',
                mode === item ? 'bg-signal/15 text-signal' : 'text-mist hover:text-paper',
              )}
            >
              {timeframeLabel(item)}
            </button>
          ))}
        </div>
        <div className="ml-auto flex shrink-0 items-center gap-2">
          <Badge tone={statusTone(status)}>{statusLabel(status)}</Badge>
          {accountBadge ? (
            <Badge tone={accountBadge.tone} className="hidden sm:inline-flex">
              {accountBadge.label}
            </Badge>
          ) : null}
          <span className="font-mono text-sm font-semibold text-paper" data-testid="current-price">
            {currentPrice != null ? formatQuote(currentPrice, pipSize) : '—'}
          </span>
          {lastUpdateAt ? (
            <span className="sr-only" data-testid="last-tick-time" data-epoch-ms={lastUpdateAt}>
              Last tick {new Date(lastUpdateAt).toLocaleTimeString()}
            </span>
          ) : null}
        </div>
        {notice ? (
          <p className="w-full text-[11px] text-signal" role="status" data-testid="chart-notice">
            {notice}
          </p>
        ) : null}
        {showStaleWarning ? (
          <p className="w-full text-[11px] text-warn">
            Feed not live — the last prices shown may be stale. Reconnecting automatically.
          </p>
        ) : null}
      </div>
      <div className={cn('relative min-h-0', compact ? 'h-[50vh] min-h-[260px]' : 'min-h-[300px] flex-1')}>
        <div ref={wrapRef} className="absolute inset-0" />
        {empty ? (
          <div className="pointer-events-none absolute inset-0 flex flex-col items-center justify-center px-6 text-center">
            <p className="font-display text-sm font-semibold text-paper">{emptyTitle}</p>
            {emptyNote ? <p className="mt-1 max-w-sm text-xs text-mist">{emptyNote}</p> : null}
          </div>
        ) : (
          <div className="pointer-events-none absolute bottom-7 left-3 z-10 rounded bg-ink/70 px-2 py-1 text-[10px] font-semibold uppercase tracking-wide text-mist">
            {isTicks ? `Live Deriv ticks · ${pointCount}` : `Deriv OHLC ${timeframeLabel(mode)} · ${pointCount} candles`}
          </div>
        )}
      </div>
      {footer ? <div className="border-t border-line">{footer}</div> : null}
    </div>
  )
}
