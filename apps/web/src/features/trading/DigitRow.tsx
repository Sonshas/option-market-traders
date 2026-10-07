import { useMemo } from 'react'
import { cn } from '@/lib/cn'
import { scanDigits } from '@/domain/digit-scanner'
import { digitsFromTicks } from '@/domain/digit-stats'
import { predictionLabel, type TradeResultAnimationState } from '@/features/trading/trade-result-animation'
import { useTicketChartSelection } from '@/hooks/useTicketChartSelection'
import { formatMoney } from '@/lib/format'
import type { Tick } from '@/types'

const DIGITS = [0, 1, 2, 3, 4, 5, 6, 7, 8, 9] as const
const SAMPLE_WINDOW = 100

/** Live last-digit frequency for the last {@link SAMPLE_WINDOW} ticks (counts only; not a prediction). */
export function DigitRow({
  ticks,
  symbol,
  animation,
}: {
  ticks: Tick[]
  symbol: string
  animation?: TradeResultAnimationState
}) {
  const ticket = useTicketChartSelection()
  const anim = animation && animation.status !== 'idle' && animation.symbol === symbol ? animation : null
  const digits = useMemo(() => digitsFromTicks(ticks), [ticks])
  const scanBarrier = ticket.contractType === 'OVER_UNDER' ? ticket.barrier : 5
  const scan = useMemo(() => scanDigits(digits, SAMPLE_WINDOW, scanBarrier), [digits, scanBarrier])
  const lastDigit = digits.length > 0 ? digits[digits.length - 1]! : null
  const counts = useMemo(() => {
    const map = new Map(scan.ranked.map((item) => [item.digit, item.count]))
    return DIGITS.map((digit) => map.get(digit) ?? 0)
  }, [scan])
  const uniform = scan.hottest.length === 10
  /** The single blue cursor: the live digit, or the trade's digit (held on the settled digit while the result shows). */
  const cursorDigit = anim ? anim.cursorDigit : lastDigit

  return (
    <section
      aria-label="Digit statistics"
      className="px-2.5 py-2"
      data-testid="digit-sample"
      data-sample={scan.sampleSize}
      data-window={SAMPLE_WINDOW}
      data-symbol={symbol}
      data-contract-type={ticket.contractType}
      data-contract-option={ticket.contractOption}
      data-barrier={ticket.contractType === 'OVER_UNDER' ? ticket.barrier : ''}
      data-digit={ticket.contractType === 'MATCH_DIFFER' ? ticket.selectedDigit : ''}
      data-first-epoch={ticks[Math.max(0, ticks.length - SAMPLE_WINDOW)]?.epoch ?? ''}
      data-last-epoch={ticks[ticks.length - 1]?.epoch ?? ''}
    >
      <div className={cn('relative', anim && (anim.status === 'won' || anim.status === 'lost') && 'mb-10')}>
        <div className="relative grid grid-cols-10 gap-1" data-testid="digit-distribution">
          {DIGITS.map((digit) => {
            const count = counts[digit] ?? 0
            const hot = scan.sampleSize > 0 && !uniform && scan.hottest.includes(digit)
            const cold = scan.sampleSize > 0 && !uniform && scan.coldest.includes(digit)
            const isCurrent = !anim && lastDigit === digit
            const cursorHere = cursorDigit === digit
            return (
              <div
                key={digit}
                data-testid={`digit-card-${digit}`}
                data-count={count}
                data-current={isCurrent ? 'true' : 'false'}
                data-hot={hot ? 'true' : 'false'}
                data-cold={cold ? 'true' : 'false'}
                aria-label={`Digit ${digit}: ${count} of ${scan.sampleSize} ticks${hot ? ', most frequent' : cold ? ', least frequent' : ''}${isCurrent ? ', latest digit' : ''}`}
                className="flex flex-col items-center"
              >
                <span
                  className={cn(
                    'relative z-[1] flex h-8 w-8 items-center justify-center rounded-full border-2 border-line bg-ink/80 font-display text-sm font-semibold sm:h-9 sm:w-9',
                    cursorHere ? 'text-signal' : 'text-paper',
                  )}
                >
                  {digit}
                </span>
                <span className="relative z-[1] mt-1 font-mono text-[10px] tabular-nums text-mist">{count}</span>
                <span aria-hidden="true" className="h-2" />
              </div>
            )
          })}
        </div>
        {cursorDigit != null ? (
          <DigitCursor
            status={anim?.status ?? 'idle'}
            tradeId={anim?.tradeId ?? null}
            digit={cursorDigit}
            profitLoss={anim?.profitLoss ?? null}
          />
        ) : null}
      </div>

      {anim ? (
        <div className="mt-1 flex justify-end">
          <TradeAnimationStatusLine animation={anim} />
        </div>
      ) : null}
    </section>
  )
}

/**
 * The one blue circle and its pointer, moved together as a single element. One column wide; translateX moves it
 * whole columns (column width + the 0.25rem grid gap).
 */
function DigitCursor({
  status,
  tradeId,
  digit,
  profitLoss,
}: {
  status: TradeResultAnimationState['status']
  tradeId: string | null
  digit: number
  profitLoss: number | null
}) {
  const holding = status === 'settling' || status === 'won' || status === 'lost' || status === 'refunded'
  return (
    <div
      aria-hidden="true"
      data-testid="digit-cursor"
      data-digit={digit}
      data-status={status}
      data-trade-id={tradeId ?? ''}
      className="pointer-events-none absolute inset-y-0 left-0 z-10 will-change-transform motion-safe:transition-transform motion-safe:duration-300 motion-safe:ease-out"
      style={{ width: 'calc((100% - 2.25rem) / 10)', transform: `translateX(calc(${digit} * (100% + 0.25rem)))` }}
    >
      <span
        data-testid="digit-cursor-circle"
        data-digit={digit}
        className={cn(
          'absolute left-1/2 top-[-2px] h-9 w-9 -translate-x-1/2 rounded-full border-[3px] border-signal sm:h-10 sm:w-10',
          holding ? 'shadow-[0_0_14px_rgba(59,130,246,0.85)]' : 'shadow-[0_0_8px_rgba(59,130,246,0.5)]',
        )}
      />
      <span className="absolute bottom-[-2px] left-1/2 top-9 w-0.5 -translate-x-1/2 rounded-full bg-signal opacity-80 sm:top-10" />
      {status === 'won' || status === 'lost' ? (
        <span
          key={tradeId ?? status}
          data-testid="digit-result-badge"
          data-result={status}
          data-digit={digit}
          className={cn(
            'sbb-pop absolute left-1/2 top-full mt-1 -translate-x-1/2 whitespace-nowrap rounded-md border px-1.5 py-0.5 text-center font-mono text-[10px] font-bold leading-tight shadow-lg',
            status === 'won' ? 'border-call/60 bg-call/15 text-call' : 'border-put/60 bg-put/15 text-put',
          )}
        >
          {status === 'won' ? 'WON' : 'LOST'}
          {profitLoss != null ? (
            <span className="block text-[9px] font-semibold">
              {profitLoss >= 0 ? '+' : '−'}
              {formatMoney(Math.abs(profitLoss))}
            </span>
          ) : null}
        </span>
      ) : null}
    </div>
  )
}

function TradeAnimationStatusLine({ animation }: { animation: TradeResultAnimationState }) {
  const prediction = animation.selection ? predictionLabel(animation.selection) : ''
  const final = animation.settledDigit
  let text: string
  let tone = 'text-paper'
  switch (animation.status) {
    case 'running':
      text = `Running · Prediction ${prediction}`
      break
    case 'settling':
      text = `Final digit: ${final ?? '—'}`
      tone = 'text-amber'
      break
    case 'won':
      text = `WON · Final digit ${final ?? '—'} · Prediction ${prediction} · Payout ${formatMoney(animation.payout)}`
      tone = 'text-call'
      break
    case 'lost':
      text = `LOST · Final digit ${final ?? '—'} · Prediction ${prediction} · Loss ${formatMoney(animation.stake)}`
      tone = 'text-put'
      break
    default:
      text = `REFUNDED · Stake ${formatMoney(animation.stake)} returned`
      tone = 'text-mist'
  }
  const isResult = animation.status === 'won' || animation.status === 'lost' || animation.status === 'refunded'
  return (
    <p
      role="status"
      aria-live="polite"
      data-testid={isResult ? 'trade-anim-result' : 'trade-anim-status'}
      data-status={animation.status}
      data-trade-id={animation.tradeId ?? ''}
      data-settled-digit={final ?? ''}
      className={cn('max-w-[75%] shrink-0 text-right font-mono text-[11px] font-semibold leading-4', tone)}
    >
      {text}
    </p>
  )
}
