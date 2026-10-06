import { useEffect, useState } from 'react'
import { ConfirmDialog } from '@/components/ConfirmDialog'
import {
  AUTO_HIDDEN_DEFAULTS,
  AUTO_MULTIPLIER_MAX,
  AUTO_MULTIPLIER_MIN,
  AUTO_TRADE_DEFAULTS,
  REAL_AUTO_CONFIRM_TEXT,
  type AutoAccount,
  type AutoTradeSettings,
} from '@/domain/auto-trade'
import { LOAD_PREDICTION_FIRST, predictionLabel, type LoadedPrediction } from '@/domain/prediction'
import { useAuthSession } from '@/hooks/useAuth'
import { useAutoTrade } from '@/hooks/useAutoTrade'
import { useLiveQuote } from '@/hooks/useLiveQuote'
import { cn } from '@/lib/cn'
import { formatMoney, formatPrice } from '@/lib/format'
import { PREDICTION_CHANGED_STOP, autoTradeEngine, dismissAutoTrade, stopAutoTrade } from '@/providers/bots/auto-trader'
import { REAL_CONNECTION_INACTIVE } from '@/providers/bots/auto-trade-executors'
import type { AccountMode } from '@/types'

const AUTO_TAB =
  'flex h-11 w-full items-center justify-center gap-2 rounded-lg text-sm font-bold tracking-wide text-white transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-signal focus-visible:ring-offset-2 focus-visible:ring-offset-ink'
const FIELD =
  'h-8 w-full rounded-md border border-line bg-ink-2 px-2 font-mono text-xs text-paper outline-none focus:border-signal focus:ring-2 focus:ring-signal/25 disabled:opacity-60'

function PlayIcon() {
  return (
    <svg viewBox="0 0 24 24" className="h-3.5 w-3.5 shrink-0" fill="currentColor" aria-hidden>
      <path d="M7 4.5v15a1 1 0 0 0 1.52.85l12-7.5a1 1 0 0 0 0-1.7l-12-7.5A1 1 0 0 0 7 4.5z" />
    </svg>
  )
}

function accountOf(kind: AccountMode): AutoAccount {
  return kind === 'real' ? 'REAL' : 'DEMO'
}

/**
 * Auto Trade (DEMO and REAL): start/stop tab, live run panel, settings and the start confirmation. It trades only
 * the loaded prediction (shown read-only) and cannot start without one.
 */
export function AutoTradePanel({
  kind,
  prediction,
  ticketReady,
  baseStake,
  durationTicks,
  blockReason,
  waitingForPrice,
}: {
  kind: AccountMode
  /** The loaded prediction — the only thing Auto Trade executes. */
  prediction: LoadedPrediction | null
  /** The ticket shows exactly the loaded prediction (market switched, contract and side applied). */
  ticketReady: boolean
  /** NaN when the ticket stake is invalid. */
  baseStake: number
  durationTicks: number
  /** Why REAL trading is unavailable right now (connection, paused, daily limit, market), or null. */
  blockReason: string | null
  waitingForPrice: boolean
}) {
  const account = accountOf(kind)
  const isReal = account === 'REAL'
  const auto = useAutoTrade()
  const { isSignedIn } = useAuthSession()
  const [targetProfit, setTargetProfit] = useState(String(AUTO_TRADE_DEFAULTS.targetProfit))
  const [stopLoss, setStopLoss] = useState(String(AUTO_TRADE_DEFAULTS.stopLoss))
  const [multiplier, setMultiplier] = useState(String(AUTO_TRADE_DEFAULTS.multiplier))
  const [confirmOpen, setConfirmOpen] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const session = auto.session
  const running = session?.status === 'running'
  const current = running ? session.current : null
  const liveQuote = useLiveQuote(current?.symbol ?? null)

  useEffect(() => {
    if (prediction) setError(null)
    if (running && prediction?.id !== session.prediction.id) stopAutoTrade(PREDICTION_CHANGED_STOP)
  }, [prediction, running, session?.prediction.id])

  // Nothing carries over between modes; REAL never runs unattended.
  useEffect(() => {
    autoTradeEngine.stopIfNotMode(account, `Switched to ${account}`)
    setError(null)
  }, [account])
  useEffect(() => {
    if (!running) return
    const onHidden = () => {
      if (document.visibilityState === 'hidden' && session.account === 'REAL') {
        stopAutoTrade('Stopped because the page was hidden — REAL Auto Trade never runs unattended')
      }
    }
    const onOffline = () => stopAutoTrade('Stopped because the connection was lost')
    const onPageHide = () => stopAutoTrade('Stopped because the page was closed or reloaded')
    document.addEventListener('visibilitychange', onHidden)
    window.addEventListener('offline', onOffline)
    window.addEventListener('pagehide', onPageHide)
    return () => {
      document.removeEventListener('visibilitychange', onHidden)
      window.removeEventListener('offline', onOffline)
      window.removeEventListener('pagehide', onPageHide)
    }
  }, [running, session?.account])
  useEffect(() => {
    if (running && session.account === 'REAL' && !isSignedIn) stopAutoTrade('Signed out')
  }, [running, session?.account, isSignedIn])

  function settings(): AutoTradeSettings {
    return {
      account,
      ...AUTO_HIDDEN_DEFAULTS,
      durationTicks,
      baseStake,
      targetProfit: Number(targetProfit),
      stopLoss: Number(stopLoss),
      multiplier: Number(multiplier),
      maxLossStreak: AUTO_TRADE_DEFAULTS.maxLossStreak,
      maxStake: AUTO_TRADE_DEFAULTS.maxStake,
    }
  }

  function start(realConfirmed: boolean) {
    const result = autoTradeEngine.start(settings(), account, { realConfirmed, prediction })
    setConfirmOpen(false)
    setError(result.ok ? null : result.error)
  }

  function requestStart() {
    if (!prediction) {
      setError(LOAD_PREDICTION_FIRST)
      return
    }
    setError(null)
    setConfirmOpen(true)
  }

  const noPrediction = prediction == null
  const startDisabled = !noPrediction && (!ticketReady || blockReason != null || waitingForPrice)
  const blockText =
    blockReason && /unavailable|Sign in/i.test(blockReason) ? REAL_CONNECTION_INACTIVE : (blockReason ?? '')
  const showSettings = !isReal || blockReason == null || running
  const pnl = auto.progress.realizedPnl
  const pnlText = `${pnl >= 0 ? '+' : '−'}$${Math.abs(pnl).toFixed(2)}`
  const stakeText = Number.isFinite(baseStake) && baseStake > 0 ? formatMoney(baseStake) : '—'
  const shownPrediction = running ? session.prediction : prediction
  const pickText = prediction ? `${predictionLabel(prediction)} on Volatility ${prediction.volatilityLabel}` : 'the loaded prediction'
  const summaryText = `Trades ${pickText} from ${stakeText}, stake ×${Number(multiplier) || 1} after a loss. Stops at +$${Number(targetProfit).toFixed(2)} profit or −$${Number(stopLoss).toFixed(2)} loss.`

  const value =
    liveQuote.status === 'live'
      ? formatPrice(liveQuote.price)
      : liveQuote.status === 'error'
        ? 'Unavailable'
        : current
          ? 'Loading…'
          : '—'
  const rows: Array<[string, string]> = [
    ['PREDICTION', session ? predictionLabel(session.prediction) : '—'],
    ['VOLATILITY', session ? `${session.prediction.volatilityLabel} · ${current?.symbol ?? session.prediction.symbol}` : '—'],
    ['VALUE', value],
    ['CONTRACT', current?.contract ?? '—'],
    ['TARGET', current?.target != null ? String(current.target) : current ? '—' : '—'],
    ['STAKE', current ? formatMoney(current.stake) : '—'],
    ['STATUS', session?.statusText ?? '—'],
  ]

  return (
    <div className="space-y-1.5" data-testid="auto-trade-panel" data-account={account}>
      {running ? (
        <button
          type="button"
          onClick={() => stopAutoTrade()}
          className={cn(AUTO_TAB, 'bg-signal-dim ring-1 ring-signal-light/50 hover:bg-signal-hover active:bg-signal-dim/80')}
          data-testid="auto-trade-stop"
          aria-label="Stop Auto Trade"
        >
          <span className="relative flex h-2.5 w-2.5" aria-hidden>
            <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-signal-soft opacity-75" />
            <span className="relative inline-flex h-2.5 w-2.5 rounded-full bg-white" />
          </span>
          STOP AUTO TRADE
        </button>
      ) : isReal && blockReason != null ? (
        <button
          type="button"
          disabled
          title={blockReason}
          className="flex h-11 w-full cursor-not-allowed flex-col items-center justify-center rounded-lg border border-signal/25 bg-signal/15 text-signal-soft/70"
          data-testid="auto-trade-disabled"
        >
          <span className="flex items-center gap-1.5 text-sm font-bold">
            <PlayIcon />
            AUTO TRADE
          </span>
          <span className="px-2 text-[10px] text-mist" data-testid="auto-trade-unavailable">
            {blockText}
          </span>
        </button>
      ) : (
        <button
          type="button"
          onClick={requestStart}
          disabled={startDisabled}
          aria-disabled={noPrediction || startDisabled ? true : undefined}
          data-blocked={noPrediction ? 'no-prediction' : undefined}
          className={cn(
            AUTO_TAB,
            'bg-signal-strong shadow-[0_8px_20px_-6px_rgb(59_130_246_/_0.45)] hover:bg-signal-hover active:translate-y-px active:bg-signal-dim disabled:translate-y-0 disabled:cursor-not-allowed disabled:bg-signal-strong/40 disabled:text-white/70 disabled:shadow-none',
            noPrediction && 'cursor-not-allowed bg-signal-strong/40 text-white/70 shadow-none hover:bg-signal-strong/40 active:translate-y-0',
          )}
          data-testid="auto-trade-start"
        >
          <PlayIcon />
          AUTO TRADE
        </button>
      )}

      {session && (running || session.status === 'stopped') ? (
        <div
          className={cn(
            'rounded-lg border px-2.5 py-2 text-xs',
            running ? 'border-signal/40 bg-signal/10' : 'border-line bg-ink-2',
          )}
          data-testid={running ? 'auto-trade-status' : 'auto-trade-summary'}
          role="status"
        >
          <dl className="grid grid-cols-[auto_minmax(0,1fr)] gap-x-3 gap-y-0.5">
            {rows.map(([label, text]) => (
              <div key={label} className="contents">
                <dt className="text-[10px] font-semibold tracking-wider text-mist">{label}</dt>
                <dd
                  className="truncate font-mono text-paper"
                  data-testid={`auto-${label.toLowerCase()}`}
                >
                  {text}
                </dd>
              </div>
            ))}
          </dl>
          <p className="mt-1.5 text-[11px] text-mist">
            {running ? '' : `Stopped: ${session.stopReason ?? 'stopped'} · `}
            P/L <span className={cn('font-mono font-semibold', pnl >= 0 ? 'text-call' : 'text-put')}>{pnlText}</span> ·{' '}
            {auto.progress.tradesPlaced} trades · {auto.progress.wins}W / {auto.progress.losses}L
            {session.lastResult ? ` · last ${session.lastResult.prediction} → ${session.lastResult.result}` : ''}
            {!running ? (
              <button type="button" onClick={() => dismissAutoTrade()} className="ml-2 underline hover:text-paper">
                Clear
              </button>
            ) : null}
          </p>
        </div>
      ) : null}
      {error ? (
        <p className="text-xs text-warn" role="alert" data-testid="auto-trade-error">
          {error}
        </p>
      ) : null}

      {showSettings ? (
        <div className="rounded-xl border border-line p-2.5" data-testid="risk-settings">
          <p className="flex items-baseline gap-1.5 text-[11px]" data-testid="auto-direction">
            <span className="text-mist">Direction</span>
            {shownPrediction ? (
              <span
                className="font-mono font-semibold text-signal"
                data-option={shownPrediction.side}
                data-symbol={shownPrediction.symbol}
              >
                {predictionLabel(shownPrediction)} · Volatility {shownPrediction.volatilityLabel}
              </span>
            ) : (
              <span className="text-mist">No prediction loaded</span>
            )}
          </p>
          <div className="mt-1.5 grid grid-cols-3 gap-1.5">
            {[
              { label: 'Multiplier ×', value: multiplier, set: setMultiplier, step: '0.1', min: AUTO_MULTIPLIER_MIN, max: AUTO_MULTIPLIER_MAX },
              { label: 'Target Profit $', value: targetProfit, set: setTargetProfit, step: '1', min: 1 },
              { label: 'Stop Loss $', value: stopLoss, set: setStopLoss, step: '1', min: 1 },
            ].map((field) => (
              <label key={field.label} className="block">
                <span className="block text-[10px] text-mist">{field.label}</span>
                <input
                  type="number"
                  value={field.value}
                  step={field.step}
                  min={field.min}
                  max={field.max}
                  disabled={running}
                  onChange={(event) => field.set(event.target.value)}
                  className={FIELD}
                />
              </label>
            ))}
          </div>
        </div>
      ) : null}

      {isReal ? (
        <ConfirmDialog
          open={confirmOpen}
          title="Start REAL Auto Trade? · REAL MONEY"
          body={`${REAL_AUTO_CONFIRM_TEXT} A losing trade loses its whole stake. ${summaryText} It also stops if you switch account, change market, hide or leave this page, or lose connection. Results are random; no profit is promised.`}
          confirmLabel="Start REAL Auto Trade"
          resultMessage={error}
          onClose={() => setConfirmOpen(false)}
          onConfirm={() => start(true)}
        />
      ) : (
        <ConfirmDialog
          open={confirmOpen}
          title="Start DEMO Auto Trade?"
          body={`DEMO, virtual funds. ${summaryText} Results are random; no profit is promised.`}
          confirmLabel="Start DEMO Auto Trade"
          resultMessage={error}
          onClose={() => setConfirmOpen(false)}
          onConfirm={() => start(false)}
        />
      )}
    </div>
  )
}
