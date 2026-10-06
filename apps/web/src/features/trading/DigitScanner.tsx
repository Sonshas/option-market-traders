import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { digitsFromTicks } from '@/domain/digit-stats'
import { AI_SCANNER_NOTE, bestScanPick } from '@/domain/digit-scanner'
import { predictionLabel, scanResultFromPick, volatilityLabelOf } from '@/domain/prediction'
import { usePrediction } from '@/hooks/usePrediction'
import { createId } from '@/lib/ids'
import { predictionStore } from '@/lib/prediction-store'
import { isRealTradeSymbol } from '@/providers/trading/real-trading-provider'
import { isVolatilityIndex, volatilityRank } from '@/domain/market-sections'
import { getMarketDataProvider } from '@/services/market-data'
import { getBufferedTicks, getLastReceivedAt } from '@/providers/market-data/tick-buffer'
import type { AccountMode, ContractType, Market } from '@/types'

/** Largest sample fetched once per volatility; smaller samples slice it client-side. */
const FETCH_COUNT = 1000
/** ticks_history requests in flight at once on the shared socket, and the pause between batches. */
const BATCH_SIZE = 2
const BATCH_GAP_MS = 350
/** Wait before each ticks_history attempt for one symbol (first attempt immediate). */
const RETRY_DELAYS_MS = [0, 1500, 3500]
/** A volatility refreshed this recently (live stream or a previous scan) is not fetched again — Deriv rate limits ticks_history. */
const FRESH_BUFFER_MS = 15_000

const wait = (ms: number) => new Promise<void>((resolve) => window.setTimeout(resolve, ms))

/**
 * AI BOT SCANNER: ranks every volatility index by its strongest setup for the ticket's contract in recent genuine
 * Deriv ticks (counts only) and shows exactly one result. Each scan replaces the previous result and clears the
 * loaded prediction; LOAD PREDICTION stores the shown result as is and never places a trade.
 */
export function DigitScanner({
  open,
  onClose,
  markets,
  kind,
  contractType,
  onLoad,
}: {
  open: boolean
  onClose: () => void
  markets: Market[]
  kind: AccountMode
  /** Contract type selected on the ticket; the prediction is for this contract. */
  contractType: ContractType
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
    const provider = getMarketDataProvider(kind)
    const found: Array<{ symbol: string; digits: number[] }> = []
    setProgress({ done: 0, total: list.length })
    for (let i = 0; i < list.length; i += BATCH_SIZE) {
      if (i > 0) await wait(BATCH_GAP_MS)
      if (run !== runRef.current) return
      await Promise.all(
        list.slice(i, i + BATCH_SIZE).map(async (symbol) => {
          let fresh =
            getBufferedTicks(symbol).length >= FETCH_COUNT && Date.now() - getLastReceivedAt(symbol) < FRESH_BUFFER_MS
          for (let attempt = 0; !fresh && attempt < RETRY_DELAYS_MS.length && provider.getTickHistory; attempt += 1) {
            try {
              if (attempt > 0) await wait(RETRY_DELAYS_MS[attempt]!)
              if (run !== runRef.current) return
              await provider.getTickHistory(symbol, FETCH_COUNT)
              fresh = true
            } catch {
              // Deriv rate limits ticks_history; back off and retry
            }
          }
          const digits = digitsFromTicks(getBufferedTicks(symbol)).slice(-FETCH_COUNT)
          if (digits.length > 0) found.push({ symbol, digits })
        }),
      )
      if (run !== runRef.current) return
      setProgress({ done: Math.min(i + BATCH_SIZE, list.length), total: list.length })
    }
    const ordered = list.flatMap((symbol) => found.filter((item) => item.symbol === symbol))
    const pick = bestScanPick(ordered, contractType)
    predictionStore.completeScan(
      pick ? scanResultFromPick(pick, volatilityLabelOf(pick.symbol, displayNameOf(pick.symbol)), Date.now(), createId('scan')) : null,
    )
    setProgress(null)
  }, [symbolKey, kind, contractType, displayNameOf])

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
              No real ticks received yet. Try Rescan.
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
          {AI_SCANNER_NOTE}
        </p>
      </div>
    </div>
  )
}
