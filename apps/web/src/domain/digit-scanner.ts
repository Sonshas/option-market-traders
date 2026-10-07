import { calculateTradeResult } from '@/domain/digit-contracts'
import type { ContractOption, ContractType } from '@/types'

/** Digit Scanner: past-tick counts only (no percentages, no predictions of the next tick). */

export const SCANNER_DISCLAIMER =
  'Based on past ticks; digits are random and past frequency does not predict the next tick.'

export const AI_SCANNER_NOTE =
  'Ranks volatilities by recent tick patterns for the selected contract (counts only). Past ticks do not predict the next tick.'

export const AI_SCANNER_SAMPLES = [100, 500, 1000] as const

export interface DigitScan {
  sampleSize: number
  /** Digits by count, most frequent first; ties broken by the smaller digit. */
  ranked: Array<{ digit: number; count: number }>
  /** Every digit sharing the highest count. */
  hottest: number[]
  /** Every digit sharing the lowest count. */
  coldest: number[]
  evenCount: number
  oddCount: number
  barrier: number
  overCount: number
  underCount: number
  equalCount: number
  /** Ticks that would settle won under the platform settlement policy (for stats only). */
  settlementWinCount: number
  /** Ticks that would settle lost under the platform settlement policy (for stats only). */
  settlementLossCount: number
}

export function scanDigits(digits: readonly number[], window: number, barrier = 5): DigitScan {
  const sample = window > 0 ? digits.slice(-window) : [...digits]
  const counts = Array.from({ length: 10 }, () => 0)
  let even = 0
  let over = 0
  let under = 0
  let equal = 0
  let settlementWin = 0
  let settlementLoss = 0
  let total = 0
  for (const digit of sample) {
    if (!Number.isInteger(digit) || digit < 0 || digit > 9) continue
    counts[digit]! += 1
    total += 1
    if (digit <= 8) settlementWin += 1
    else settlementLoss += 1
    if (calculateTradeResult('EVEN', null, digit) === 'WIN') even += 1
    if (calculateTradeResult('OVER', barrier, digit) === 'WIN') over += 1
    else if (calculateTradeResult('UNDER', barrier, digit) === 'WIN') under += 1
    else equal += 1
  }
  const ranked = counts
    .map((count, digit) => ({ digit, count }))
    .sort((a, b) => b.count - a.count || a.digit - b.digit)
  const max = total > 0 ? ranked[0]!.count : 0
  const min = total > 0 ? ranked[ranked.length - 1]!.count : 0
  return {
    sampleSize: total,
    ranked,
    hottest: total > 0 ? ranked.filter((item) => item.count === max).map((item) => item.digit) : [],
    coldest:
      total > 0
        ? ranked
            .filter((item) => item.count === min)
            .map((item) => item.digit)
            .sort((a, b) => a - b)
        : [],
    evenCount: even,
    oddCount: total - even,
    barrier,
    overCount: over,
    underCount: under,
    equalCount: equal,
    settlementWinCount: settlementWin,
    settlementLossCount: settlementLoss,
  }
}

/** One-line plain-text summary (counts only) used by the scanner rows and tests. */
export function describeScan(scan: DigitScan): string {
  if (scan.sampleSize === 0) return 'No ticks yet'
  const hot = scan.hottest.map((d) => `${d} (${scan.ranked.find((r) => r.digit === d)!.count})`).join(', ')
  const cold = scan.coldest.map((d) => `${d} (${scan.ranked.find((r) => r.digit === d)!.count})`).join(', ')
  return `Most frequent ${hot} · Least frequent ${cold} · ${scan.sampleSize} ticks`
}

/** Strongest setup of one volatility for one contract type, from past-tick counts. */
export interface ScannerPick {
  symbol: string
  contractType: ContractType
  contractOption: ContractOption
  selectedDigit: number | null
  barrier: number | null
  /** Ticks in the sample on which this setup would have won under natural contract rules. */
  hits: number
  /** Hits a uniform digit distribution would give for this sample size. */
  expected: number
  sampleSize: number
  /** Standardised distance of `hits` above `expected`; used only for ordering, never displayed. */
  deviation: number
  /** Plain counts behind the pick, e.g. "EVEN 534 / ODD 466 in last 1000 ticks". */
  countsLine: string
}

interface Candidate {
  contractOption: ContractOption
  selectedDigit: number | null
  barrier: number | null
  hits: number
  /** Chance of winning per tick if digits were uniform. */
  p: number
}

function deviationOf(hits: number, n: number, p: number): number {
  const sd = Math.sqrt(n * p * (1 - p))
  return sd > 0 ? (hits - n * p) / sd : 0
}

function sumCounts(counts: number[], from: number, toExclusive: number): number {
  let total = 0
  for (let d = from; d < toExclusive; d += 1) total += counts[d] ?? 0
  return total
}

/** Candidates ranked by natural EVEN/ODD/MATCH/DIFFER/OVER/UNDER hit counts (not settlement policy). */
function candidatesFor(contractType: ContractType, counts: number[], n: number): Candidate[] {
  if (contractType === 'EVEN_ODD') {
    const even = (counts[0] ?? 0) + (counts[2] ?? 0) + (counts[4] ?? 0) + (counts[6] ?? 0) + (counts[8] ?? 0)
    const odd = n - even
    return [
      { contractOption: 'even', selectedDigit: null, barrier: null, hits: even, p: 0.5 },
      { contractOption: 'odd', selectedDigit: null, barrier: null, hits: odd, p: 0.5 },
    ]
  }
  if (contractType === 'OVER_UNDER') {
    const out: Candidate[] = []
    for (let b = 0; b <= 9; b += 1) {
      const under = sumCounts(counts, 0, b)
      const over = n - under - counts[b]!
      if (b <= 8) out.push({ contractOption: 'over', selectedDigit: null, barrier: b, hits: over, p: (9 - b) / 10 })
      if (b >= 1) out.push({ contractOption: 'under', selectedDigit: null, barrier: b, hits: under, p: b / 10 })
    }
    return out
  }
  const out: Candidate[] = []
  for (let d = 0; d <= 9; d += 1) {
    out.push({ contractOption: 'match', selectedDigit: d, barrier: null, hits: counts[d]!, p: 0.1 })
    out.push({ contractOption: 'differ', selectedDigit: d, barrier: null, hits: n - counts[d]!, p: 0.9 })
  }
  return out
}

function countsLineFor(contractType: ContractType, best: Candidate, counts: number[], n: number): string {
  const tail = `in last ${n} ticks`
  if (contractType === 'EVEN_ODD') {
    const even = best.contractOption === 'even' ? best.hits : n - best.hits
    return `EVEN ${even} / ODD ${n - even} ${tail}`
  }
  if (contractType === 'OVER_UNDER') {
    const b = best.barrier!
    const under = counts.slice(0, b).reduce((sum, c) => sum + c, 0)
    const over = n - under - counts[b]!
    const sides = [b <= 8 ? `OVER ${b}: ${over}` : null, b >= 1 ? `UNDER ${b}: ${under}` : null, `EQUAL ${b}: ${counts[b]}`]
    return `${sides.filter(Boolean).join(' / ')} ${tail}`
  }
  const d = best.selectedDigit!
  return `Digit ${d} appeared ${counts[d]} times ${tail} (${Math.round(n / 10)} expected)`
}

/**
 * Strongest setup on one market: the candidate whose past hit count sits furthest above what uniform
 * digits would give. Raw hit counts alone would always pick OVER 0 / UNDER 9 / DIFFER, so the ordering
 * is by deviation from the expected count. Ties pick the first candidate (smallest digit / barrier).
 */
export function strongestSetup(
  symbol: string,
  digits: readonly number[],
  contractType: ContractType,
  window: number,
): ScannerPick | null {
  const sample = window > 0 ? digits.slice(-window) : [...digits]
  const counts = Array.from({ length: 10 }, () => 0)
  let n = 0
  for (const digit of sample) {
    if (!Number.isInteger(digit) || digit < 0 || digit > 9) continue
    counts[digit]! += 1
    n += 1
  }
  if (n === 0) return null
  let best: Candidate | null = null
  let bestDeviation = -Infinity
  for (const candidate of candidatesFor(contractType, counts, n)) {
    const deviation = deviationOf(candidate.hits, n, candidate.p)
    if (deviation > bestDeviation + 1e-9) {
      best = candidate
      bestDeviation = deviation
    }
  }
  if (!best) return null
  return {
    symbol,
    contractType,
    contractOption: best.contractOption,
    selectedDigit: best.selectedDigit,
    barrier: best.barrier,
    hits: best.hits,
    expected: Math.round(n * best.p),
    sampleSize: n,
    deviation: bestDeviation,
    countsLine: countsLineFor(contractType, best, counts, n),
  }
}

/**
 * Cross-market ranking: the strongest setup per volatility, ordered by how far it deviates from its
 * expected count (largest first). Markets without ticks are dropped; ties keep the input order.
 */
export function rankVolatilities(
  markets: ReadonlyArray<{ symbol: string; digits: readonly number[] }>,
  contractType: ContractType,
  window: number,
): ScannerPick[] {
  return markets
    .map((market, index) => ({ index, pick: strongestSetup(market.symbol, market.digits, contractType, window) }))
    .filter((item): item is { index: number; pick: ScannerPick } => item.pick != null)
    .sort((a, b) => b.pick.deviation - a.pick.deviation || a.index - b.index)
    .map((item) => item.pick)
}

/**
 * The one setup the AI BOT SCANNER shows: the strongest pick across every volatility and every sample size
 * (largest sample first, so it wins ties). Null when no market has ticks.
 */
export function bestScanPick(
  markets: ReadonlyArray<{ symbol: string; digits: readonly number[] }>,
  contractType: ContractType,
  samples: readonly number[] = [...AI_SCANNER_SAMPLES].sort((a, b) => b - a),
): ScannerPick | null {
  let best: ScannerPick | null = null
  for (const window of samples) {
    const top = rankVolatilities(markets, contractType, window)[0]
    if (top && (!best || top.deviation > best.deviation + 1e-9)) best = top
  }
  return best
}

/** Short label for a pick, e.g. "EVEN", "OVER 3", "MATCH 7". */
export function pickLabel(pick: Pick<ScannerPick, 'contractOption' | 'selectedDigit' | 'barrier'>): string {
  const side = pick.contractOption.toUpperCase()
  if (pick.selectedDigit != null) return `${side} ${pick.selectedDigit}`
  if (pick.barrier != null) return `${side} ${pick.barrier}`
  return side
}
