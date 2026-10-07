import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { predictionLabel, scanResultFromRandomPick, volatilityLabelOf } from '@/domain/prediction'
import { randomDigitPick } from '@/domain/random-pick'
import { usePrediction } from '@/hooks/usePrediction'
import { createId } from '@/lib/ids'
import { predictionStore } from '@/lib/prediction-store'
import { isRealTradeSymbol } from '@/providers/trading/real-trading-provider'
import { isVolatilityIndex, volatilityRank } from '@/domain/market-sections'
import type { AccountMode, ContractType, Market } from '@/types'

const SCAN_STEP_MS = 60

const wait = (ms: number) => new Promise<void>((resolve) => window.setTimeout(resolve, ms))

export const AI_SCANNER_RANDOM_NOTE = 'Random pick: EVEN/ODD, MATCH/DIFFER or OVER/UNDER on a random volatility.'

/**
 * AI BOT SCANNER: picks ONE random digit contract (any of the six) on ONE random volatility. Each scan replaces the
 * previous result and clears the loaded prediction. LOAD PREDICTION stores the shown result as-is and never places a trade.
 */
export function DigitScanner({
  open,
  onClose,
  markets,
  kind,
  onLoad,
}: {
  open: boolean
  onClose: () => void
  markets: Market[]
  kind: AccountMode
  /** Contract type selected on the ticket; ignored — the pick is any of the six contracts. */
  contractType?: ContractType
  onLoad: () => void
}) {
  const { latest, scanning } = usePrediction()
  const [progress, setProgress] = useState<{ done: number; total: number } | null>(null)
  const runRef = useRef(0)
  const dialogRef = useRef<HTMLDivElement>(null)

  const symbols = useMemo(
    () =>
      markets
        .filter(isVolatilityIndex)
        .filter((market) => kind !== 'real' || isRealTradeSymbol(market.symbol))
        .sort((a, b) => {
          const [ga, na] = volatilityRank(a.symbol)
          const [gb, nb] = volatilityRank(b.symbol)
          return ga - gb || na - nb
        })
        .map((market) => market.symbol),
    [markets, kind],
  )
  const symbolKey = symbols.join('|')
  const displayNameOf = useCallback((symbol: string) => markets.find((market) => market.symbol === symbol)?.displayName, [markets])

  const runScan = useCallback(async () => {
    const list = symbolKey ? symbolKey.split('|') : []
    if (list.length === 0) return
    const run = ++runRef.current
    predictionStore.beginScan()
    setProgress({ done: 0, total: list.length })
    for (let i = 1; i <= list.length; i += 1) {
      await wait(SCAN_STEP_MS)
      if (run !== runRef.current) return
      setProgress({ done: i, total: list.length })
    }
    const pick = randomDigitPick(list)
    predictionStore.completeScan(
      pick ? scanResultFromRandomPick(pick, volatilityLabelOf(pick.symbol, displayNameOf(pick.symbol)), Date.now(), createId('scan')) : null,
    )
    setProgress(null)
  }, [symbolKey, displayNameOf])

  useEffect(() => {
    if (!open) {
      runRef.current += 1
      predictionStore.cancelScan()
      return
    }
    void runScan()
    // One scan per opening; Rescan starts another.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, symbolKey])

  useEffect(() => {
    if (!open) return
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', onKey)
    dialogRef.current?.focus()
    return () => window.removeEventListener('keydown', onKey)
  }, [open, onClose])

  if (!open) return null

  const result = !scanning ? latest : null

  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center sm:items-center sm:p-4" role="presentation">
      <button type="button" className="absolute inset-0 bg-black/60" aria-label="Close AI bot scanner" onClick={onClose} />
      <div
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby="ai-bot-scanner-title"
        tabIndex={-1}
        data-testid="ai-bot-scanner"
        className="relative z-10 flex max-h-[92svh] w-full max-w-sm flex-col rounded-t-2xl border border-line bg-surface p-4 shadow-2xl outline-none sm:rounded-2xl"
      >
        <div className="flex items-start justify-between gap-3">
          <h2 id="ai-bot-scanner-title" className="font-display text-lg font-bold tracking-wide text-signal-light">
            AI BOT SCANNER
          </h2>
          <button type="button" onClick={onClose} className="rounded-lg px-2 py-1 text-sm text-mist hover:text-paper" aria-label="Close">
            ✕
          </button>
        </div>

        <div className="mt-3">
          {symbols.length === 0 ? (
            <p className="py-6 text-center text-sm text-mist">Loading markets…</p>
          ) : scanning || progress ? (
            <div className="py-6 text-center" role="status" data-testid="ai-scanner-progress">
              <p className="text-sm font-semibold text-paper">Scanning {symbols.length} volatilities…</p>
              {progress ? (
                <div className="mx-auto mt-2 h-1.5 w-48 overflow-hidden rounded-full bg-ink-2">
                  <div className="h-full bg-signal transition-[width]" style={{ width: `${(progress.done / progress.total) * 100}%` }} />
                </div>
              ) : null}
            </div>
          ) : !result ? (
            <p className="py-6 text-center text-sm text-mist" data-testid="ai-scanner-empty">
              No pick yet. Try Rescan.
            </p>
          ) : (
            <section
              className="rounded-xl border-2 border-signal/70 bg-signal/10 p-3"
              data-testid="ai-scanner-result"
              data-id={result.id}
              data-symbol={result.symbol}
              data-contract={result.contract}
              data-option={result.side}
              data-target={result.digit ?? result.barrier ?? ''}
            >
              <p className="flex items-baseline justify-between gap-3 text-base">
                <span className="text-mist">Prediction:</span>
                <span className="font-mono text-lg font-bold text-signal-light" data-testid="ai-scanner-prediction">
                  {predictionLabel(result)}
                </span>
              </p>
              <p className="mt-1 flex items-baseline justify-between gap-3 text-base">
                <span className="text-mist">Volatility:</span>
                <span className="font-mono text-lg font-bold text-paper" data-testid="ai-scanner-volatility">
                  {result.volatilityLabel}
                </span>
              </p>
              {(result.digit != null || result.barrier != null) && (
                <p className="mt-1 flex items-baseline justify-between gap-3 text-sm">
                  <span className="text-mist">Target:</span>
                  <span className="font-mono font-semibold text-paper" data-testid="ai-scanner-target">
                    {result.digit ?? result.barrier}
                  </span>
                </p>
              )}
              <p className="mt-2 text-center text-[11px] text-mist">Scanner result only — click LOAD PREDICTION to use it.</p>
            </section>
          )}
        </div>

        <div className="mt-3 flex gap-2">
          <button
            type="button"
            onClick={onLoad}
            disabled={!result}
            className="flex h-12 flex-1 items-center justify-center rounded-xl bg-signal-strong text-sm font-bold tracking-wider text-white shadow-[0_8px_20px_-6px_rgb(59_130_246_/_0.45)] hover:bg-signal-hover focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-signal-light disabled:cursor-not-allowed disabled:bg-signal-strong/40 disabled:text-white/70 disabled:shadow-none"
            data-testid="ai-scanner-load-prediction"
            aria-label={result ? `LOAD PREDICTION ${predictionLabel(result)} on Volatility ${result.volatilityLabel}` : 'LOAD PREDICTION (waiting for the scan)'}
          >
            LOAD PREDICTION
          </button>
          <button
            type="button"
            onClick={() => void runScan()}
            disabled={scanning || progress != null || symbols.length === 0}
            className="h-12 rounded-xl border border-signal/60 px-3 text-xs font-bold text-signal-light hover:bg-signal/10 disabled:opacity-50"
            data-testid="ai-scanner-rescan"
          >
            Rescan
          </button>
        </div>

        <p className="mt-2 text-center text-[11px] text-mist" data-testid="scanner-disclaimer">
          {AI_SCANNER_RANDOM_NOTE}
        </p>
      </div>
    </div>
  )
}
