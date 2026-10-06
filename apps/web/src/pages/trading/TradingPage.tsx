import { useEffect, useMemo, useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import {
  PriceChart,
  type ChartMode,
  type ChartPriceLine,
  type ChartSelection,
  type ChartStyle,
} from '@/components/chart/PriceChart'
import { initialChartMode } from '@/domain/chart-selection'
import { Card } from '@/components/ui'
import { DigitRow } from '@/features/trading/DigitRow'
import { MarketSelect } from '@/features/trading/MarketSelect'
import { TradeTicket } from '@/features/trading/TradeTicket'
import { WalletActions } from '@/features/trading/WalletActions'
import { useAccountMode } from '@/hooks/useAccountMode'
import { useLiveFeedStatus, useMarketSnapshot, useMarkets, useTickStream } from '@/hooks/useMarketData'
import { useMediaQuery } from '@/hooks/useMediaQuery'
import { useRealTradingConfig } from '@/hooks/useRealTradingConfig'
import { useTradeResultAnimation } from '@/hooks/useTradeResultAnimation'
import { useTrades } from '@/hooks/useTrades'
import { accountModeLabel } from '@/domain/account'
import { contractOptionLabel } from '@/domain/contracts'
import { PREDICTION_CLEARED } from '@/domain/prediction'
import { predictionStore } from '@/lib/prediction-store'
import { getAutoTradeSnapshot, stopAutoTrade } from '@/providers/bots/demo-auto-trader'
import { getMarketDataProviderId, isMarketDataProviderConfigured } from '@/providers/market-data/env'
import { defaultRealDerivSymbol } from '@/providers/market-data/deriv-symbols'
import type { ConnectionStatus, Timeframe } from '@/types'

const CHART_STYLE_KEY = 'sbb.chartStyle'

function storedChartStyle(): ChartStyle {
  try {
    const value = localStorage.getItem(CHART_STYLE_KEY)
    return value === 'candles' || value === 'ohlc' ? value : 'line'
  } catch {
    return 'line'
  }
}

export function TradingPage() {
  const { kind } = useAccountMode()
  const { markets, status: socketStatus } = useMarkets()
  const [params, setParams] = useSearchParams()
  const defaultSymbol = getMarketDataProviderId() === 'binance' ? 'BTCUSDT' : defaultRealDerivSymbol()

  // Reset market URL when switching DEMO ↔ REAL so stale symbols never leak across modes.
  useEffect(() => {
    if (params.get('symbol')) return
    const copy = new URLSearchParams(params)
    copy.set('symbol', defaultSymbol)
    setParams(copy, { replace: true })
    // Only on account mode change — not when defaultSymbol string identity is stable within a mode.
    // eslint-disable-next-line react-hooks/exhaustive-deps -- intentional: kind drives reset
  }, [kind])

  const symbolParam = params.get('symbol')
  const symbol = symbolParam || defaultSymbol
  const [chartStyle, setChartStyleState] = useState<ChartStyle>(storedChartStyle)
  const [chartMode, setChartMode] = useState<ChartMode>(() => initialChartMode(chartStyle))
  const timeframe: Timeframe = chartMode === 'ticks' ? '1m' : chartMode
  const compact = useMediaQuery('(max-width: 1023px)')
  const market = useMemo(() => {
    const found = markets.find((item) => item.symbol === symbol)
    if (found) return found
    return markets[0] ?? null
  }, [markets, symbol])
  const activeSymbol = market?.symbol ?? symbol
  const { snapshot, loading: snapLoading, error: snapError } = useMarketSnapshot(activeSymbol, timeframe, chartMode !== 'ticks')
  const { ticks, loading: ticksLoading } = useTickStream(activeSymbol)
  const { open: openTrades, history: tradeHistory } = useTrades(kind)
  const { enabled: realTradingEnabled } = useRealTradingConfig(kind)
  const allTrades = useMemo(() => [...openTrades, ...tradeHistory], [openTrades, tradeHistory])
  const tradeAnimation = useTradeResultAnimation({ kind, trades: allTrades, ticks, symbol: activeSymbol })
  const feedConfigured = isMarketDataProviderConfigured()

  // Auto Trade only runs while this page shows the same account mode and market it started on.
  useEffect(() => {
    const running = getAutoTradeSnapshot().session
    if (running?.status !== 'running') return
    if (running.account !== (kind === 'real' ? 'REAL' : 'DEMO')) stopAutoTrade(`Switched to ${kind === 'real' ? 'REAL' : 'DEMO'}`)
    else if (running.prediction.symbol !== activeSymbol) stopAutoTrade('Market changed')
  }, [kind, activeSymbol])
  useEffect(() => () => stopAutoTrade('Left the trading page'), [])

  function setChartSelection(next: ChartSelection) {
    setChartMode(next.mode)
    setChartStyleState(next.style)
    try {
      localStorage.setItem(CHART_STYLE_KEY, next.style)
    } catch {
      // preference not remembered
    }
  }

  const latestTick = ticks.length > 0 ? ticks[ticks.length - 1]! : null
  const liveTick =
    latestTick && !latestTick.isSimulated
      ? latestTick
      : snapshot?.lastTick && !snapshot.lastTick.isSimulated
        ? snapshot.lastTick
        : null
  // CONNECTED only while the socket is open and genuine ticks for this symbol keep arriving.
  const displayStatus: ConnectionStatus = useLiveFeedStatus(activeSymbol, socketStatus)
  const lastPrice = liveTick?.price ?? null
  const lastUpdateAt = liveTick?.timestamp ?? null
  const pipSize = liveTick?.pipSize ?? null

  const hasChartData = chartMode === 'ticks' ? ticks.length > 0 : (snapshot?.candles.length ?? 0) > 0
  const unavailableNote = !feedConfigured
    ? 'Live prices are not available right now.'
    : !hasChartData && (displayStatus === 'error' || displayStatus === 'disconnected')
      ? 'Live prices are temporarily unavailable. Retrying automatically.'
      : null

  const priceLines = useMemo<ChartPriceLine[]>(
    () =>
      openTrades
        .filter((trade) => trade.symbol === activeSymbol && trade.entryPrice != null)
        .slice(0, 5)
        .map((trade) => ({
          price: trade.entryPrice as number,
          label: `Entry ${contractOptionLabel(trade.contractOption)}`,
          tone: 'signal' as const,
        })),
    [openTrades, activeSymbol],
  )

  function selectSymbol(next: string) {
    const copy = new URLSearchParams(params)
    copy.set('symbol', next)
    setParams(copy, { replace: true })
  }

  /** A manual market change away from the loaded prediction clears it (the ticket must match what Auto Trade runs). */
  function selectSymbolByUser(next: string) {
    const loaded = predictionStore.getLoaded()
    if (loaded && loaded.symbol !== next) predictionStore.invalidate(PREDICTION_CLEARED)
    selectSymbol(next)
  }

  const marketLabel = market ? market.displayName : 'No market selected'

  return (
    <div
      className="flex min-h-0 flex-1 flex-col gap-3 overflow-x-hidden p-2 sm:p-3 lg:grid lg:grid-cols-[minmax(0,3fr)_minmax(21rem,1fr)] lg:overflow-hidden"
      data-testid="trading-desk"
    >
      <h1 className="sr-only">Trading terminal — {accountModeLabel(kind)}</h1>
      <WalletActions kind={kind} className="lg:hidden" />
      <section className="flex min-w-0 flex-col lg:min-h-0" aria-label="Chart">
        <PriceChart
          mode={chartMode}
          chartStyle={chartStyle}
          onSelectionChange={setChartSelection}
          ticks={ticks}
          candles={snapshot?.candles ?? []}
          status={displayStatus}
          pipSize={pipSize}
          loading={chartMode === 'ticks' ? ticksLoading : snapLoading}
          error={chartMode === 'ticks' ? null : snapError}
          compact={compact}
          marketLabel={marketLabel}
          symbol={activeSymbol}
          currentPrice={lastPrice}
          lastUpdateAt={lastUpdateAt}
          unavailableNote={unavailableNote}
          accountBadge={
            kind === 'demo'
              ? { label: 'DEMO FUNDS', tone: 'demo' }
              : { label: realTradingEnabled ? 'REAL MONEY' : 'REAL · VIEW ONLY', tone: 'live' }
          }
          priceLines={priceLines}
          toolbarStart={<MarketSelect markets={markets} selected={activeSymbol} onSelect={selectSymbolByUser} />}
          footer={<DigitRow ticks={ticks} symbol={activeSymbol} animation={tradeAnimation} />}
        />
      </section>

      <aside className="min-w-0 lg:min-h-0" aria-label="Trade ticket">
        <Card className="sbb-panel sbb-scroll lg:h-full lg:overflow-y-auto" padded={false}>
          <div className="p-3">
            <WalletActions kind={kind} className="mb-3 hidden lg:flex" />
            <TradeTicket
              market={market}
              kind={kind}
              liveTick={liveTick}
              ticks={ticks}
              markets={markets}
              onSelectSymbol={selectSymbol}
            />
          </div>
        </Card>
      </aside>
    </div>
  )
}
