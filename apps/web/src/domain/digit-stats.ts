import { lastDigitOfPrice } from '@/domain/contracts'
import { extractLastDigit } from '@/providers/market-data/deriv-digits'
import type { Tick } from '@/types'

export type DigitStats = {
  /** Requested window (most recent N ticks). */
  window: number
  /** Number of ticks the statistics were computed from (≤ window when fewer are available). */
  sampleSize: number
  /** Occurrences of each digit 0–9. */
  counts: number[]
  /** Share of each digit 0–9 in percent (0 when no sample). */
  percentages: number[]
  evenCount: number
  oddCount: number
  /** Relative to `barrier`: counts of digits strictly over / under / equal. */
  overCount: number
  underCount: number
  equalCount: number
  evenPct: number
  oddPct: number
  /** Relative to `barrier`: digits strictly over / under / equal. */
  overPct: number
  underPct: number
  equalPct: number
  barrier: number
  lastDigit: number | null
  mostFrequent: number | null
  leastFrequent: number | null
}

/** Digit of a genuine tick — provider digit first, then quote ÷ pip size, then string fallback. */
export function digitOfTick(tick: Tick): number | null {
  if (tick.lastDigit != null && Number.isInteger(tick.lastDigit)) return tick.lastDigit
  if (tick.pipSize != null) {
    const digit = extractLastDigit(tick.price, tick.pipSize)
    if (digit != null) return digit
  }
  return Number.isFinite(tick.price) ? lastDigitOfPrice(tick.price) : null
}

/** Digits in chronological order (oldest first); simulated ticks are ignored. */
export function digitsFromTicks(ticks: Tick[]): number[] {
  const digits: number[] = []
  for (const tick of ticks) {
    if (tick.isSimulated) continue
    const digit = digitOfTick(tick)
    if (digit != null) digits.push(digit)
  }
  return digits
}

function pct(part: number, total: number): number {
  if (total <= 0) return 0
  return Math.round((part / total) * 10_000) / 100
}

/** Statistics over the most recent `window` digits. */
export function computeDigitStats(digits: number[], window = 100, barrier = 5): DigitStats {
  const sample = window > 0 ? digits.slice(-window) : digits
  const counts = Array.from({ length: 10 }, () => 0)
  let even = 0
  let over = 0
  let under = 0
  let equal = 0
  for (const digit of sample) {
    if (!Number.isInteger(digit) || digit < 0 || digit > 9) continue
    counts[digit]! += 1
    if (digit % 2 === 0) even += 1
    if (digit > barrier) over += 1
    else if (digit < barrier) under += 1
    else equal += 1
  }
  const total = counts.reduce((sum, value) => sum + value, 0)
  let mostFrequent: number | null = null
  let leastFrequent: number | null = null
  if (total > 0) {
    mostFrequent = 0
    leastFrequent = 0
    for (let digit = 1; digit < 10; digit += 1) {
      if (counts[digit]! > counts[mostFrequent]!) mostFrequent = digit
      if (counts[digit]! < counts[leastFrequent]!) leastFrequent = digit
    }
  }
  return {
    window,
    sampleSize: total,
    counts,
    percentages: counts.map((count) => pct(count, total)),
    evenCount: even,
    oddCount: total - even,
    overCount: over,
    underCount: under,
    equalCount: equal,
    evenPct: pct(even, total),
    oddPct: pct(total - even, total),
    overPct: pct(over, total),
    underPct: pct(under, total),
    equalPct: pct(equal, total),
    barrier,
    lastDigit: sample.length > 0 ? sample[sample.length - 1]! : null,
    mostFrequent,
    leastFrequent,
  }
}

/** Length of the current run of same-parity digits at the end of the series. */
export function currentParityStreak(digits: number[]): { parity: 'even' | 'odd' | null; length: number } {
  if (digits.length === 0) return { parity: null, length: 0 }
  const last = digits[digits.length - 1]!
  const parity = last % 2 === 0 ? 'even' : 'odd'
  let length = 0
  for (let i = digits.length - 1; i >= 0; i -= 1) {
    if ((digits[i]! % 2 === 0 ? 'even' : 'odd') !== parity) break
    length += 1
  }
  return { parity, length }
}
