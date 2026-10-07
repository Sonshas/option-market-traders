import { useEffect, useMemo, useRef, useState } from 'react'
import { ConfirmDialog } from '@/components/ConfirmDialog'
import { Icon } from '@/components/icons'
import { REAL_TRADE_LABEL } from '@/domain/account'
import { CONTRACT_OPTIONS, CONTRACT_TYPES, defaultOptionFor, formatContractTicket } from '@/domain/contracts'
import { usePracticeBook } from '@/hooks/usePracticeBook'
import {
  CANNOT_WIN_WARNING,
  DAILY_LIMIT_MESSAGE,
  REAL_STAKE_MAX,
  REAL_STAKE_MIN,
  TICK_DURATION_DEFAULT,
  TICK_DURATION_MAX,
  TICK_DURATION_MIN,
  contractCanWin,
  potentialPayout,
  validateRealStake,
  type DigitContractSelection,
} from '@/domain/digit-contracts'
import { clampTicks, directionPayoutLabel, payoutSummary, tickHint } from '@/domain/ticket'
import { AutoTradePanel } from '@/features/trading/AutoTradePanel'
import { DigitScanner } from '@/features/trading/DigitScanner'
import { PREDICTION_CLEARED, loadedPredictionText, predictionLabel, ticketMatchesPrediction } from '@/domain/prediction'
import { TicketTrades } from '@/features/trading/TicketTrades'
import { useAutoTrade } from '@/hooks/useAutoTrade'
import { usePrediction } from '@/hooks/usePrediction'
import { useRealTradingConfig } from '@/hooks/useRealTradingConfig'
import { useWallet } from '@/hooks/useWallet'
import { STAKE_PRESETS } from '@/lib/constants'
import { cn } from '@/lib/cn'
import { formatMoney } from '@/lib/format'
import { predictionStore } from '@/lib/prediction-store'
import { ticketChartStore } from '@/lib/ticket-chart-store'
import { ordinalSuffix } from '@/providers/trading/demo-trading-provider'
import { isRealTradeSymbol, newIdempotencyKey } from '@/providers/trading/real-trading-provider'
import { tradingProvider } from '@/services/trades'
import type { AccountMode, ContractOption, ContractType, Market, Tick } from '@/types'

const DIGITS = [0, 1, 2, 3, 4, 5, 6, 7, 8, 9] as const
const REAL_RISK_ACK_KEY = 'sbb.realRiskAck'
function realRiskAcknowledged(): boolean {
  try {
    return sessionStorage.getItem(REAL_RISK_ACK_KEY) === '1'
  } catch {
    return false
  }
}

function acknowledgeRealRisk(): void {
  try {
    sessionStorage.setItem(REAL_RISK_ACK_KEY, '1')
  } catch {
    // session storage unavailable — the warning will show again next time
  }
}

function optionLabel(option: ContractOption, digit: number, barrier: number): string {
  const base = option.toUpperCase()
  if (option === 'match' || option === 'differ') return `${base} ${digit}`
  if (option === 'over' || option === 'under') return `${base} ${barrier}`
  return base
}

function SparkleIcon() {
  return (
    <svg viewBox="0 0 24 24" className="h-4 w-4 shrink-0" fill="currentColor" aria-hidden>
      <path d="M10 2.5l1.9 5.1 5.1 1.9-5.1 1.9L10 16.5l-1.9-5.1L3 9.5l5.1-1.9L10 2.5zM18 13l.95 2.55L21.5 16.5l-2.55.95L18 20l-.95-2.55L14.5 16.5l2.55-.95L18 13z" />
    </svg>
  )
}

function SectionLabel({ children }: { children: string }) {
  return <p className="mb-1 text-[11px] font-semibold uppercase tracking-wider text-mist">{children}</p>
}

function Stepper({
  label,
  value,
  onChange,
  onStep,
  disabled,
  min,
  max,
  step,
  inputMode = 'decimal',
}: {
  label: string
  value: string
  onChange: (value: string) => void
  onStep: (delta: number) => void
  disabled?: boolean
  min?: number
  max?: number
  step: number
  inputMode?: 'decimal' | 'numeric'
}) {
  return (
    <div className="flex h-9 items-stretch overflow-hidden rounded-lg border border-line bg-ink-2 focus-within:border-signal focus-within:ring-2 focus-within:ring-signal/25">
      <button
        type="button"
        aria-label={`Decrease ${label}`}
        disabled={disabled}
        onClick={() => onStep(-step)}
        className="flex w-9 items-center justify-center text-mist hover:bg-surface-3 hover:text-paper disabled:opacity-40"
      >
        <Icon name="minus" />
      </button>
      <input
        type="number"
        aria-label={label}
        inputMode={inputMode}
        min={min}
        max={max}
        step={step}
        value={value}
        disabled={disabled}
        onChange={(event) => onChange(event.target.value)}
        className="min-w-0 flex-1 border-x border-line bg-transparent text-center font-mono text-sm text-paper outline-none disabled:opacity-60"
      />
      <button
        type="button"
        aria-label={`Increase ${label}`}
        disabled={disabled}
        onClick={() => onStep(step)}
        className="flex w-9 items-center justify-center text-mist hover:bg-surface-3 hover:text-paper disabled:opacity-40"
      >
        <Icon name="plus" />
      </button>
    </div>
  )
}

function DigitPicker({
  label,
  value,
  onChange,
  disabled,
}: {
  label: string
  value: number
  onChange: (digit: number) => void
  disabled?: boolean
}) {
  return (
    <div>
      <div className="mb-1 flex items-baseline justify-between">
        <p className="text-[11px] font-semibold uppercase tracking-wider text-mist">{label}</p>
        <p className="text-xs text-mist" data-testid="target-digit">
          Target <span className="font-mono text-base font-bold text-signal-light">{value}</span>
        </p>
      </div>
      <div className="grid grid-cols-10 gap-1" role="group" aria-label={label}>
        {DIGITS.map((digit) => (
          <button
            key={digit}
            type="button"
            aria-pressed={value === digit}
            disabled={disabled}
            className={cn(
              'h-8 rounded-md border font-mono text-sm transition-none disabled:cursor-not-allowed',
              value === digit
                ? 'border-signal-light bg-signal-strong font-bold text-white ring-2 ring-signal-light/50'
                : 'border-line text-mist hover:text-paper disabled:opacity-50',
            )}
            onClick={() => onChange(digit)}
          >
            {digit}
          </button>
        ))}
      </div>
    </div>
  )
}

export function TradeTicket({
  market,
  kind,
  liveTick = null,
  ticks = [],
  markets = [],
  onSelectSymbol,
}: {
  market: Market | null
  kind: AccountMode
  /** Genuine tick only — never pass invented ticks here. */
  liveTick?: Tick | null
  /** Genuine ticks of the selected market (tick-spacing hint). */
  ticks?: Tick[]
  /** Markets for the Digit Scanner. */
  markets?: Market[]
  onSelectSymbol?: (symbol: string) => void
}) {
  const isDemo = kind === 'demo'
  const { wallet } = useWallet(kind)
  const realTrading = useRealTradingConfig(kind)
  const auto = useAutoTrade()
  const [contractType, setContractType] = useState<ContractType>('EVEN_ODD')
  const [selectedDigit, setSelectedDigit] = useState(5)
  const [barrier, setBarrier] = useState(5)
  const [stake, setStake] = useState(isDemo ? '10' : '1')
  const [durationTicks, setDurationTicks] = useState(String(TICK_DURATION_DEFAULT))
  const [pendingOption, setPendingOption] = useState<ContractOption>('even')
  const [open, setOpen] = useState(false)
  const [riskOpen, setRiskOpen] = useState(false)
  const [scannerOpen, setScannerOpen] = useState(false)
  const { book } = usePracticeBook()
  const { loaded: loadedPrediction, notice: predictionNotice } = usePrediction()
  /** Id of the loaded prediction already written into the ticket (it waits for the market switch first). */
  const [appliedId, setAppliedId] = useState<string | null>(null)
  const [orderKey, setOrderKey] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)
  const placingRef = useRef(false)
  const [message, setMessage] = useState<string | null>(null)
  const [stakeError, setStakeError] = useState<string | undefined>()

  useEffect(() => {
    setStake(kind === 'demo' ? '10' : String(REAL_STAKE_MIN))
    setStakeError(undefined)
    setMessage(null)
  }, [kind])

  useEffect(() => {
    setStakeError(undefined)
    setMessage(null)
  }, [book])

  useEffect(() => {
    if (isDemo || !realTrading.config) return
    const min = realTrading.config.stakeMin
    const max = realTrading.config.stakeMax
    setStake((current) => {
      const n = Number(current)
      if (!Number.isFinite(n) || n < min) return String(min)
      if (n > max) return String(max)
      return current
    })
  }, [isDemo, realTrading.config?.stakeMin, realTrading.config?.stakeMax])

  useEffect(() => {
    ticketChartStore.set({
      contractType,
      contractOption: pendingOption,
      selectedDigit,
      barrier,
    })
  }, [contractType, pendingOption, selectedDigit, barrier])

  const autoRunning = auto.session?.status === 'running'
  const stakeNumber = Number(stake)
  const validStake = Number.isFinite(stakeNumber) && stakeNumber > 0
  const ticksNumber = clampTicks(Number(durationTicks), TICK_DURATION_MIN, TICK_DURATION_MAX)
  const options = CONTRACT_OPTIONS[contractType]
  const symbol = market?.symbol ?? ''
  const tickEpochs = useMemo(() => ticks.slice(-50).map((tick) => tick.timestamp), [ticks])
  const hint = tickHint(symbol, tickEpochs)

  const selectionFor = (option: ContractOption): DigitContractSelection => ({
    contractType,
    contractOption: option,
    selectedDigit: contractType === 'MATCH_DIFFER' ? selectedDigit : null,
    barrier: contractType === 'OVER_UNDER' ? barrier : null,
  })
  const pendingSelection = selectionFor(pendingOption)
  const pendingLabel = formatContractTicket(contractType, pendingOption, { digit: selectedDigit, barrier })
  const canWinPending = contractCanWin(pendingSelection)

  const realQuote = liveTick && !liveTick.isSimulated ? liveTick.price : null
  const realAvailable = !isDemo && wallet && !wallet.isSimulated ? wallet.availableBalance : null
  const realBlockReason = isDemo
    ? null
    : realTrading.loading
      ? 'Checking real trading…'
      : !realTrading.config
        ? (realTrading.error ?? 'Real trading is temporarily unavailable.')
        : !realTrading.enabled
          ? (realTrading.config.message ?? 'Real trading is paused right now.')
          : realTrading.config.dailyLimitReached
            ? DAILY_LIMIT_MESSAGE
            : !market || !isRealTradeSymbol(market.symbol)
              ? 'This market is not available for REAL trading.'
              : realAvailable == null
                ? 'REAL balance unavailable.'
                : null
  const tradingDisabled = !isDemo && realBlockReason != null
  const waitingForLivePrice = realQuote == null && !tradingDisabled
  const inputsLocked = tradingDisabled || autoRunning

  /** A manual ticket change away from the loaded prediction clears it, so the ticket never differs from Auto Trade. */
  function clearPredictionIf(changed: boolean) {
    if (changed && loadedPrediction) predictionStore.invalidate(PREDICTION_CLEARED)
  }

  function selectContractType(next: ContractType) {
    clearPredictionIf(loadedPrediction != null && next !== loadedPrediction.contract)
    setContractType(next)
    setPendingOption(defaultOptionFor(next))
    setMessage(null)
  }

  function selectDigit(digit: number) {
    clearPredictionIf(loadedPrediction?.contract === 'MATCH_DIFFER' && digit !== loadedPrediction.digit)
    setSelectedDigit(digit)
  }

  function selectBarrier(digit: number) {
    clearPredictionIf(loadedPrediction?.contract === 'OVER_UNDER' && digit !== loadedPrediction.barrier)
    setBarrier(digit)
  }

  function requestTrade(option: ContractOption) {
    clearPredictionIf(loadedPrediction != null && option !== loadedPrediction.side)
    setPendingOption(option)
    if (tradingDisabled) {
      setMessage(realBlockReason)
      return
    }
    const error = isDemo
      ? !validStake
        ? 'Enter a stake greater than zero.'
        : undefined
      : (validateRealStake(validStake ? stakeNumber : Number.NaN, realAvailable, {
          min: realTrading.config?.stakeMin ?? REAL_STAKE_MIN,
          max: realTrading.config?.stakeMax ?? REAL_STAKE_MAX,
        }) ?? undefined)
    setStakeError(error)
    if (error) return
    setMessage(null)
    if (isDemo) {
      void placeTrade(option)
      return
    }
    setOrderKey(newIdempotencyKey())
    if (!realRiskAcknowledged()) {
      setRiskOpen(true)
      return
    }
    setOpen(true)
  }

  async function placeTrade(option: ContractOption) {
    if (!market || !validStake || tradingDisabled || placingRef.current) return
    placingRef.current = true
    setLoading(true)
    try {
      const result = await tradingProvider.place({
        symbol: market.symbol,
        contractType,
        contractOption: option,
        selectedDigit: contractType === 'MATCH_DIFFER' ? selectedDigit : null,
        barrier: contractType === 'OVER_UNDER' ? barrier : null,
        stake: stakeNumber,
        durationMs: 0,
        durationTicks: ticksNumber,
        kind,
        accountMode: kind,
        idempotencyKey: isDemo ? undefined : (orderKey ?? undefined),
      })
      setMessage(isDemo && result.connected && result.data ? null : result.message)
      if (!isDemo && result.connected && result.data) {
        window.setTimeout(() => setOpen(false), 900)
      }
    } catch {
      setMessage('Could not place the trade. Please try again.')
    } finally {
      placingRef.current = false
      setLoading(false)
    }
  }

  function bumpStake(delta: number) {
    const current = validStake ? stakeNumber : 0
    const rounded = Math.round((current + delta) * 100) / 100
    const stakeMin = realTrading.config?.stakeMin ?? REAL_STAKE_MIN
    const stakeMax = realTrading.config?.stakeMax ?? REAL_STAKE_MAX
    const next = isDemo ? Math.max(1, rounded) : Math.min(stakeMax, Math.max(stakeMin, rounded))
    setStake(String(next))
    setStakeError(undefined)
  }

  function loadPrediction() {
    const loaded = predictionStore.load()
    setScannerOpen(false)
    if (loaded && loaded.symbol !== symbol) onSelectSymbol?.(loaded.symbol)
  }

  useEffect(() => {
    if (!loadedPrediction) {
      setAppliedId(null)
      return
    }
    if (appliedId === loadedPrediction.id || loadedPrediction.symbol !== symbol) return
    setContractType(loadedPrediction.contract)
    setPendingOption(loadedPrediction.side)
    if (loadedPrediction.digit != null) setSelectedDigit(loadedPrediction.digit)
    if (loadedPrediction.barrier != null) setBarrier(loadedPrediction.barrier)
    setMessage(null)
    setAppliedId(loadedPrediction.id)
  }, [loadedPrediction, appliedId, symbol])

  const loadedActive =
    loadedPrediction != null &&
    appliedId === loadedPrediction.id &&
    ticketMatchesPrediction(loadedPrediction, { symbol, contractType, side: pendingOption, selectedDigit, barrier })

  const payoutLines = useMemo(() => {
    const [first, second] = options as [ContractOption, ContractOption]
    const a = payoutSummary(validStake ? stakeNumber : Number.NaN, selectionFor(first))
    const b = payoutSummary(validStake ? stakeNumber : Number.NaN, selectionFor(second))
    if (a === b) return [{ label: null as string | null, text: a }]
    return [
      { label: optionLabel(first, selectedDigit, barrier), text: a },
      { label: optionLabel(second, selectedDigit, barrier), text: b },
    ]
    // selectionFor depends on these
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [options, stakeNumber, validStake, contractType, selectedDigit, barrier])

  const durationText = `${ticksNumber} tick${ticksNumber === 1 ? '' : 's'}`
  const potentialReturn = validStake ? formatMoney(potentialPayout(stakeNumber, pendingSelection)) : '—'
  const potentialProfit = validStake
    ? formatMoney(Math.max(0, Number((potentialPayout(stakeNumber, pendingSelection) - stakeNumber).toFixed(2))))
    : '—'

  return (
    <div className="space-y-3" data-testid="trade-ticket" data-kind={kind}>
      <div className="grid grid-cols-3 gap-1 rounded-xl border border-line bg-ink-2 p-1" role="tablist" aria-label="Contract types">
        {CONTRACT_TYPES.map((item) => (
          <button
            key={item.id}
            type="button"
            role="tab"
            aria-selected={contractType === item.id}
            aria-label={item.label}
            disabled={autoRunning}
            className={cn(
              'rounded-lg px-1 py-1.5 text-center text-[11px] font-bold transition-none disabled:cursor-not-allowed',
              contractType === item.id
                ? 'bg-signal-strong text-white shadow-sm ring-1 ring-signal-light/60'
                : 'text-mist hover:bg-surface-3 hover:text-paper disabled:opacity-50',
            )}
            onClick={() => selectContractType(item.id)}
          >
            {item.shortLabel}
          </button>
        ))}
      </div>

      <div className="space-y-1.5">
        <AutoTradePanel
          kind={kind}
          prediction={loadedPrediction}
          symbol={symbol}
          ticketReady={loadedActive}
          baseStake={validStake ? stakeNumber : Number.NaN}
          durationTicks={ticksNumber}
          blockReason={realBlockReason}
          waitingForPrice={waitingForLivePrice}
        />
        <button
          type="button"
          onClick={() => setScannerOpen(true)}
          disabled={autoRunning}
          title={autoRunning ? 'Stop Auto Trade to scan again' : undefined}
          className="flex h-11 w-full items-center justify-center gap-2 rounded-lg bg-linear-to-r from-bot to-bot-accent text-sm font-bold tracking-wide text-white shadow-[0_8px_20px_-6px_rgb(124_58_237_/_0.5)] transition-colors hover:from-bot-hover hover:to-bot-accent-hover active:translate-y-px active:brightness-90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-bot-accent focus-visible:ring-offset-2 focus-visible:ring-offset-ink disabled:cursor-not-allowed disabled:opacity-50 disabled:shadow-none"
          data-testid="ai-bot-scanner-open"
        >
          <SparkleIcon />
          AI BOT SCANNER
        </button>
        {loadedPrediction && loadedActive ? (
          <p
            className="rounded-lg border border-bot-accent/50 bg-bot-accent/10 px-2.5 py-1.5 text-center text-xs font-bold tracking-wide text-paper"
            role="status"
            data-testid="prediction-loaded"
            data-id={loadedPrediction.id}
            data-symbol={loadedPrediction.symbol}
            data-option={loadedPrediction.side}
          >
            {loadedPredictionText(loadedPrediction)}
          </p>
        ) : loadedPrediction ? (
          <p className="text-center text-xs text-mist" role="status" data-testid="prediction-loading">
            {appliedId === loadedPrediction.id
              ? `Prediction ${predictionLabel(loadedPrediction)} · Volatility ${loadedPrediction.volatilityLabel} is not on this market`
              : 'Loading prediction…'}
          </p>
        ) : predictionNotice ? (
          <p className="text-center text-xs text-amber" role="status" data-testid="prediction-cleared">
            {predictionNotice}
          </p>
        ) : null}
      </div>

      <div>
        <SectionLabel>Stake amount</SectionLabel>
        <div className="mb-1.5 grid grid-cols-6 gap-1">
          {STAKE_PRESETS.map((preset) => {
            const stakeMin = realTrading.config?.stakeMin ?? REAL_STAKE_MIN
            const stakeMax = realTrading.config?.stakeMax ?? REAL_STAKE_MAX
            const blocked = !isDemo && (preset < stakeMin || preset > stakeMax)
            return (
              <button
                key={preset}
                type="button"
                disabled={inputsLocked || blocked}
                className={cn(
                  'h-7 rounded-md border font-mono text-[11px] disabled:opacity-40',
                  Number(stake) === preset ? 'border-signal/60 bg-signal/15 text-signal' : 'border-line text-mist hover:text-paper',
                )}
                onClick={() => {
                  setStake(String(preset))
                  setStakeError(undefined)
                }}
              >
                ${preset}
              </button>
            )
          })}
        </div>
        <Stepper
          label="Stake"
          value={stake}
          step={1}
          min={isDemo ? 0.5 : (realTrading.config?.stakeMin ?? REAL_STAKE_MIN)}
          max={isDemo ? undefined : (realTrading.config?.stakeMax ?? REAL_STAKE_MAX)}
          disabled={inputsLocked}
          onChange={(value) => {
            setStake(value)
            setStakeError(undefined)
          }}
          onStep={bumpStake}
        />
        {stakeError ? <p className="mt-1 text-xs text-danger">{stakeError}</p> : null}
      </div>

      <div className="rounded-lg border border-line bg-ink-2 px-2.5 py-1.5" data-testid="payout-line">
        {payoutLines.map((line) => (
          <p key={line.label ?? 'payout'} className="flex items-baseline justify-between gap-2 text-xs">
            <span className="text-mist">Payout{line.label ? ` · ${line.label}` : ''}</span>
            <span className="font-mono font-semibold text-paper">{line.text}</span>
          </p>
        ))}
      </div>

      {contractType === 'MATCH_DIFFER' ? (
        <DigitPicker label="Digit (0–9)" value={selectedDigit} onChange={selectDigit} disabled={autoRunning} />
      ) : null}
      {contractType === 'OVER_UNDER' ? (
        <DigitPicker label="Barrier digit (0–9)" value={barrier} onChange={selectBarrier} disabled={autoRunning} />
      ) : null}

      <div>
        <SectionLabel>Duration (ticks)</SectionLabel>
        <Stepper
          label="Duration in ticks"
          value={durationTicks}
          step={1}
          min={TICK_DURATION_MIN}
          max={TICK_DURATION_MAX}
          inputMode="numeric"
          disabled={inputsLocked}
          onChange={setDurationTicks}
          onStep={(delta) => setDurationTicks(String(clampTicks(ticksNumber + delta, TICK_DURATION_MIN, TICK_DURATION_MAX)))}
        />
        <p className="mt-1 text-[11px] text-mist" data-testid="tick-hint">
          {hint} · settles on the {ticksNumber}
          {ordinalSuffix(ticksNumber)} tick after entry
        </p>
      </div>

      {!contractCanWin(selectionFor(options[0]!)) || !contractCanWin(selectionFor(options[1]!)) ? (
        <p
          className="rounded-lg border border-amber/50 bg-amber/10 px-2.5 py-1.5 text-center text-[11px] font-semibold text-amber"
          role="alert"
          data-testid="cannot-win-warning"
        >
          {CANNOT_WIN_WARNING} ({optionLabel(contractCanWin(selectionFor(options[0]!)) ? options[1]! : options[0]!, selectedDigit, barrier)})
        </p>
      ) : null}

      <div className="grid grid-cols-2 gap-2">
        {options.map((option, index) => (
          <button
            key={option}
            type="button"
            disabled={!market || waitingForLivePrice || tradingDisabled || autoRunning || loading}
            aria-busy={loading && pendingOption === option ? true : undefined}
            onClick={() => requestTrade(option)}
            data-testid={`direction-${option}`}
            data-loaded={loadedActive && loadedPrediction?.side === option ? 'true' : undefined}
            aria-label={`${optionLabel(option, selectedDigit, barrier)} — ${directionPayoutLabel(validStake ? stakeNumber : Number.NaN, selectionFor(option))}`}
            className={cn(
              'relative flex h-14 flex-col items-center justify-center rounded-xl text-sm font-bold disabled:cursor-not-allowed disabled:opacity-50',
              index === 0
                ? 'bg-signal-strong text-white shadow-[0_8px_20px_-6px_rgb(59_130_246_/_0.45)] hover:bg-signal-hover disabled:shadow-none'
                : 'border-2 border-put text-put hover:bg-put/10',
              loadedActive && loadedPrediction?.side === option && 'ring-2 ring-bot-accent ring-offset-2 ring-offset-surface',
            )}
          >
            {loadedActive && loadedPrediction?.side === option ? (
              <span className="absolute -top-2 right-2 rounded-full bg-linear-to-r from-bot to-bot-accent px-1.5 text-[9px] font-bold tracking-wider text-white">
                LOADED
              </span>
            ) : null}
            <span>{optionLabel(option, selectedDigit, barrier)}</span>
            <span className="text-[11px] font-medium opacity-90">
              {directionPayoutLabel(validStake ? stakeNumber : Number.NaN, selectionFor(option))}
            </span>
          </button>
        ))}
      </div>

      {tradingDisabled ? (
        <p className="text-center text-xs text-live" data-testid="real-trade-status">
          {realBlockReason}
        </p>
      ) : waitingForLivePrice ? (
        <p className="text-center text-xs text-amber">Waiting for a live price…</p>
      ) : null}
      {!open && !riskOpen && message ? (
        <p className="text-center text-xs text-mist" role="status" data-testid="ticket-message">
          {message}
        </p>
      ) : null}

      <TicketTrades kind={kind} />

      <DigitScanner
        open={scannerOpen}
        onClose={() => setScannerOpen(false)}
        markets={markets}
        kind={kind}
        contractType={contractType}
        onLoad={loadPrediction}
      />

      {!isDemo ? (
        <>
          <ConfirmDialog
            open={riskOpen}
            title="Before your first REAL trade"
            body={`REAL trades use your real balance. If a contract loses, the whole stake is lost. Payouts are not guaranteed and past results do not predict future outcomes. Only trade money you can afford to lose. Stakes are ${formatMoney(realTrading.config?.stakeMin ?? REAL_STAKE_MIN)} – ${formatMoney(realTrading.config?.stakeMax ?? REAL_STAKE_MAX)} per trade.`}
            confirmLabel="I understand"
            onClose={() => setRiskOpen(false)}
            onConfirm={() => {
              acknowledgeRealRisk()
              setRiskOpen(false)
              setOpen(true)
            }}
          />
          <ConfirmDialog
            open={open}
            title={`${REAL_TRADE_LABEL} · REAL MONEY TRADE`}
            body={`Confirm REAL ${pendingLabel} on ${market?.displayName ?? 'this market'} for ${validStake ? formatMoney(stakeNumber) : '—'} over ${durationText}. ${validStake ? formatMoney(stakeNumber) : 'The stake'} is taken from your REAL balance now. ${canWinPending ? `If the contract wins you receive ${potentialReturn} (profit ${potentialProfit}); if it loses you lose the stake.` : `${CANNOT_WIN_WARNING}: this trade will lose the whole stake.`} Settles on the ${ticksNumber}${ordinalSuffix(ticksNumber)} Deriv tick after your trade opens.`}
            confirmLabel="Confirm REAL trade"
            loading={loading}
            resultMessage={message}
            onClose={() => setOpen(false)}
            onConfirm={() => void placeTrade(pendingOption)}
          />
        </>
      ) : null}
    </div>
  )
}
