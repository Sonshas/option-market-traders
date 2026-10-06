import { useEffect, useMemo, useRef } from 'react'
import {
  AreaSeries,
  BaselineSeries,
  ColorType,
  createChart,
  type IChartApi,
  type ISeriesApi,
  type UTCTimestamp,
} from 'lightweight-charts'
import { toChartLine, type SeriesPoint } from '@/domain/chart-data'
import { PALETTE, withAlpha } from '@/lib/palette'

/**
 * Small time-series chart for account history (balance / cumulative P&L).
 * `baseline` mode colours values above zero green and below zero red.
 */
export function SeriesChart({
  points,
  variant = 'area',
  height = 220,
  ariaLabel,
}: {
  points: SeriesPoint[]
  variant?: 'area' | 'baseline'
  height?: number
  ariaLabel: string
}) {
  const wrapRef = useRef<HTMLDivElement>(null)
  const chartRef = useRef<IChartApi | null>(null)
  const seriesRef = useRef<ISeriesApi<'Area'> | ISeriesApi<'Baseline'> | null>(null)
  const data = useMemo(() => toChartLine(points), [points])

  useEffect(() => {
    const wrap = wrapRef.current
    if (!wrap) return
    const chart = createChart(wrap, {
      autoSize: true,
      layout: {
        background: { type: ColorType.Solid, color: 'transparent' },
        textColor: PALETTE.mist,
        fontSize: 11,
        attributionLogo: false,
      },
      grid: {
        vertLines: { color: 'rgba(255, 255, 255, 0.05)' },
        horzLines: { color: 'rgba(255, 255, 255, 0.05)' },
      },
      rightPriceScale: { borderColor: PALETTE.line },
      timeScale: { borderColor: PALETTE.line, timeVisible: true, secondsVisible: false },
      handleScroll: false,
      handleScale: false,
    })
    chartRef.current = chart
    const priceFormat = { type: 'price' as const, precision: 2, minMove: 0.01 }
    seriesRef.current =
      variant === 'baseline'
        ? chart.addSeries(BaselineSeries, {
            baseValue: { type: 'price', price: 0 },
            topLineColor: PALETTE.call,
            topFillColor1: withAlpha(PALETTE.call, 0.28),
            topFillColor2: withAlpha(PALETTE.call, 0.02),
            bottomLineColor: PALETTE.put,
            bottomFillColor1: withAlpha(PALETTE.put, 0.02),
            bottomFillColor2: withAlpha(PALETTE.put, 0.28),
            lineWidth: 2,
            priceFormat,
          })
        : chart.addSeries(AreaSeries, {
            lineColor: PALETTE.signal,
            topColor: withAlpha(PALETTE.signal, 0.3),
            bottomColor: withAlpha(PALETTE.sky, 0.02),
            lineWidth: 2,
            priceFormat,
          })
    return () => {
      chart.remove()
      chartRef.current = null
      seriesRef.current = null
    }
  }, [variant])

  useEffect(() => {
    seriesRef.current?.setData(data.map((p) => ({ time: p.time as UTCTimestamp, value: p.value })))
    if (data.length > 0) chartRef.current?.timeScale().fitContent()
  }, [data])

  return <div ref={wrapRef} role="img" aria-label={ariaLabel} style={{ height }} className="w-full" />
}
