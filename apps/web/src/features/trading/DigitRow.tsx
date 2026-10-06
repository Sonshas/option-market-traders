import { useMemo, useState } from 'react'
import { cn } from '@/lib/cn'
import { currentParityStreak, digitsFromTicks } from '@/domain/digit-stats'
import { scanDigits } from '@/domain/digit-scanner'
import { predictionLabel, type TradeResultAnimationState } from '@/features/trading/trade-result-animation'
import { formatMoney } from '@/lib/format'
import type { Tick } from '@/types'

const DIGITS = [0, 1, 2, 3, 4, 5, 6, 7, 8, 9] as const
const SAMPLE_WINDOW = 100

/**
 * Compact last-digit row under the chart: counts only (no percentages). Most frequent digits are blue,
 * least frequent red, and a marker sits under the latest tick's digit. Extra stats live under "More stats".
 * While a trade animates, a single cursor + circle replaces the latest-digit marker.
 */
export function DigitRow({
  ticks,
  symbol,
  animation,
}: {
  ticks: Tick[]
  symbol: string
  animation?: TradeResultAnimationState
}) {
  const [barrier, setBarrier] = useState(5)
  const anim = animation && animation.status !== 'idle' && animation.symbol === symbol ? animation : null
  const digits = useMemo(() => digitsFromTicks(ticks), [ticks])
  const scan = useMemo(() => scanDigits(digits, SAMPLE_WINDOW, barrier), [digits, barrier])
  const lastDigit = digits.length > 0 ? digits[digits.length - 1]! : null
  const counts = useMemo(() => {
    const map = new Map(scan.ranked.map((item) => [item.digit, item.count]))
    return DIGITS.map((digit) => map.get(digit) ?? 0)
  }, [scan])
  const uniform = scan.hottest.length === 10
  const recent = digits.slice(-20)
  const streak = currentParityStreak(digits)

  return (
    <section
      aria-label="Digit statistics"
      className="px-2.5 py-2"
      data-testid="digit-sample"
      data-sample={scan.sampleSize}
      data-window={SAMPLE_WINDOW}
      data-symbol={symbol}
      data-first-epoch={ticks[Math.max(0, ticks.length - SAMPLE_WINDOW)]?.epoch ?? ''}
      data-last-epoch={ticks[ticks.length - 1]?.epoch ?? ''}
    >
      <div className="relative">
      <div className="grid grid-cols-10 gap-1" data-testid="digit-distribution">
        {DIGITS.map((digit) => {
          const count = counts[digit] ?? 0
          const hot = scan.sampleSize > 0 && !uniform && scan.hottest.includes(digit)
          const cold = scan.sampleSize > 0 && !uniform && scan.coldest.includes(digit)
          const isCurrent = !anim && lastDigit === digit
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
                  'flex h-8 w-8 items-center justify-center rounded-full border-2 font-display text-sm font-semibold sm:h-9 sm:w-9',
                  hot ? 'border-signal text-signal' : cold ? 'border-put text-put' : 'border-line-strong text-paper',
                  isCurrent && 'bg-surface-3',
                )}
              >
                {digit}
              </span>
              <span className="mt-0.5 font-mono text-[10px] tabular-nums text-mist">{count}</span>
              <span aria-hidden="true" className={cn('h-2 text-[8px] leading-none', isCurrent ? 'text-signal' : 'text-transparent')}>
                ▲
              </span>
            </div>
          )
        })}
      </div>
      {anim && anim.cursorDigit != null ? <DigitCursor animation={anim} digit={anim.cursorDigit} /> : null}
      </div>

      <div className="mt-1 flex items-start gap-2">
      <details className="min-w-0 flex-1 text-[11px] text-mist">
        <summary className="cursor-pointer select-none hover:text-paper">More stats</summary>
        <div className="mt-1.5 grid gap-1.5 sm:grid-cols-2">
          <p className="rounded-lg border border-line bg-ink-2 px-2.5 py-1.5 font-mono text-paper">
            Even {scan.evenCount} · Odd {scan.oddCount}
          </p>
          <label className="flex items-center gap-1.5 rounded-lg border border-line bg-ink-2 px-2.5 py-1.5">
            <span>Barrier</span>
            <select
              value={barrier}
              onChange={(event) => setBarrier(Number(event.target.value))}
              className="rounded border border-line bg-ink px-1 font-mono text-paper"
              aria-label="Over/under barrier digit"
            >
              {DIGITS.map((digit) => (
                <option key={digit} value={digit}>
                  {digit}
                </option>
              ))}
            </select>
            <span className="ml-auto font-mono text-paper">
              Over {scan.overCount} · Under {scan.underCount} · Equal {scan.equalCount}
            </span>
          </label>
          <p className="rounded-lg border border-line bg-ink-2 px-2.5 py-1.5 font-mono text-paper">
            Parity streak {streak.parity ? `${streak.parity.toUpperCase()} × ${streak.length}` : '—'}
          </p>
          <p className="break-all rounded-lg border border-line bg-ink-2 px-2.5 py-1.5 font-mono tracking-[0.25em]" data-testid="recent-digits">
            {recent.map((digit, index) => (
              <span key={`${index}-${digit}`} className={index === recent.length - 1 ? 'text-signal' : 'text-paper'}>
                {digit}
              </span>
            ))}
          </p>
        </div>
      </details>
      {anim ? <TradeAnimationStatusLine animation={anim} /> : null}
      </div>
    </section>
  )
}

const CURSOR_TONE: Record<TradeResultAnimationState['status'], { ring: string; line: string }> = {
  idle: { ring: '', line: '' },
  running: { ring: 'border-amber shadow-[0_0_10px_rgba(251,191,36,0.55)]', line: 'bg-amber' },
  settling: { ring: 'border-amber shadow-[0_0_12px_rgba(251,191,36,0.75)]', line: 'bg-amber' },
  won: { ring: 'border-call shadow-[0_0_12px_rgba(16,185,129,0.7)]', line: 'bg-call' },
  lost: { ring: 'border-put shadow-[0_0_12px_rgba(244,63,94,0.7)]', line: 'bg-put' },
  refunded: { ring: 'border-mist', line: 'bg-mist' },
}

/** One column wide; translateX moves it whole columns (column width + the 0.25rem grid gap). */
function DigitCursor({ animation, digit }: { animation: TradeResultAnimationState; digit: number }) {
  const tone = CURSOR_TONE[animation.status]
  return (
    <div
      aria-hidden="true"
      data-testid="digit-cursor"
      data-digit={digit}
      data-status={animation.status}
      data-trade-id={animation.tradeId ?? ''}
      className="pointer-events-none absolute inset-y-0 left-0 z-10 will-change-transform motion-safe:transition-transform motion-safe:duration-300 motion-safe:ease-out"
      style={{ width: 'calc((100% - 2.25rem) / 10)', transform: `translateX(calc(${digit} * (100% + 0.25rem)))` }}
    >
      <span
        data-testid="digit-cursor-circle"
        data-digit={digit}
        className={cn('absolute left-1/2 top-[-2px] h-9 w-9 -translate-x-1/2 rounded-full border-[3px] sm:h-10 sm:w-10', tone.ring)}
      />
      <span className={cn('absolute bottom-[-2px] left-1/2 top-9 w-0.5 -translate-x-1/2 rounded-full opacity-80 sm:top-10', tone.line)} />
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
