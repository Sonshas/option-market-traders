// Pure digit-contract rules shared by the DEMO engine, the REAL web client and the Supabase Edge Functions.
// supabase/functions/_shared/digit-contracts.ts must stay byte-identical to this file (enforced by digit-contracts.test.ts).

export type DigitContractType = 'EVEN_ODD' | 'MATCH_DIFFER' | 'OVER_UNDER'
export type DigitContractOption = 'even' | 'odd' | 'match' | 'differ' | 'over' | 'under'
export type DigitOutcome = 'won' | 'lost' | 'tie'

export const DIGIT_CONTRACT_OPTIONS: Record<DigitContractType, DigitContractOption[]> = {
  EVEN_ODD: ['even', 'odd'],
  MATCH_DIFFER: ['match', 'differ'],
  OVER_UNDER: ['over', 'under'],
}

/** Share of the fair price kept by the house on every contract (DEMO and REAL). */
export const HOUSE_MARGIN = 0.05
/** Highest profit rate any contract can have (MATCH, P = 0.1). */
export const MAX_PAYOUT_RATE = 8.5
export const CANNOT_WIN_WARNING = 'This contract cannot win — 0% chance'

export interface DigitContractSelection {
  contractType: DigitContractType
  contractOption: DigitContractOption
  selectedDigit: number | null
  barrier: number | null
}

/**
 * Winning digits out of 10 (P(win) × 10, an exact integer 0–9).
 * OVER b wins on digits strictly above b, UNDER b strictly below; the barrier digit itself loses.
 */
export function winningDigitCount(selection: DigitContractSelection): number {
  if (selection.contractType === 'EVEN_ODD') return 5
  if (selection.contractType === 'MATCH_DIFFER') return selection.contractOption === 'match' ? 1 : 9
  const barrier = isValidDigit(selection.barrier) ? selection.barrier : 5
  return selection.contractOption === 'over' ? 9 - barrier : barrier
}

export function winProbability(selection: DigitContractSelection): number {
  return winningDigitCount(selection) / 10
}

export function contractCanWin(selection: DigitContractSelection): boolean {
  return winningDigitCount(selection) > 0
}

/**
 * Profit per $1 on a win: (1 − HOUSE_MARGIN) / P(win) − 1, rounded down to 4 decimals so the margin never
 * drops below 5%. Contracts that cannot win have rate 0.
 * Integer form with n winning digits: floor((95 − 10n) × 1000 / n) / 10000.
 */
export function digitPayoutRate(selection: DigitContractSelection): number {
  const n = winningDigitCount(selection)
  if (n <= 0) return 0
  return Math.floor(((95 - 10 * n) * 1000) / n) / 10000
}

/** Legacy time-based durations: still accepted for trades opened before tick durations and by old tabs. */
export const TRADE_DURATIONS = [
  { label: '15s', ms: 15_000 },
  { label: '30s', ms: 30_000 },
  { label: '1m', ms: 60_000 },
  { label: '2m', ms: 120_000 },
  { label: '5m', ms: 300_000 },
] as const

/** Contract length in Deriv ticks (DEMO and REAL). */
export const TICK_DURATION_MIN = 1
export const TICK_DURATION_MAX = 10
export const TICK_DURATION_DEFAULT = 5

export function isValidTickDuration(value: unknown): value is number {
  return (
    typeof value === 'number' && Number.isInteger(value) && value >= TICK_DURATION_MIN && value <= TICK_DURATION_MAX
  )
}

/** Deriv's nominal tick spacing: 1HZ… indices tick every second, R_… indices every 2 seconds; null when unknown. */
export function nominalTickIntervalMs(symbol: string): number | null {
  if (/^1HZ\d+V$/.test(symbol)) return 1_000
  if (/^R_\d+$/.test(symbol)) return 2_000
  return null
}

/**
 * REAL tick contracts count ticks strictly after the later of the entry tick and the placement second, so a
 * slightly stale entry tick can never make an already-published tick the exit tick.
 */
export function tickAnchorMs(entryEpochMs: number, placedAtMs: number): number {
  return Math.max(entryEpochMs, Math.floor(placedAtMs / 1000) * 1000)
}

/** Expected (not authoritative) settlement time of a tick contract, used for countdowns and sweeps. */
export function estimatedTickExpiryMs(anchorMs: number, ticks: number, symbol: string): number {
  return anchorMs + ticks * (nominalTickIntervalMs(symbol) ?? 2_000)
}

/**
 * The Nth genuine tick strictly after `anchorMs` in epoch order (duplicates by epoch ignored, input order
 * irrelevant), with the epochs of ticks 1…N. Null while fewer than N ticks exist.
 */
export function selectNthTickAfter<T extends PriceTick>(
  ticks: readonly T[],
  anchorMs: number,
  n: number,
): { exit: T; epochsMs: number[] } | null {
  if (!Number.isInteger(n) || n < 1 || !Number.isFinite(anchorMs)) return null
  const byEpoch = new Map<number, T>()
  for (const tick of ticks) {
    if (!Number.isFinite(tick.epochMs) || !Number.isFinite(tick.price) || tick.epochMs <= anchorMs) continue
    if (!byEpoch.has(tick.epochMs)) byEpoch.set(tick.epochMs, tick)
  }
  if (byEpoch.size < n) return null
  const epochsMs = [...byEpoch.keys()].sort((a, b) => a - b).slice(0, n)
  return { exit: byEpoch.get(epochsMs[n - 1]!)!, epochsMs }
}

/** Deriv digit indices accepted for REAL trades (must also exist in public.markets). */
export const REAL_TRADE_SYMBOLS = [
  'R_10',
  'R_25',
  'R_50',
  'R_75',
  'R_100',
  '1HZ10V',
  '1HZ25V',
  '1HZ50V',
  '1HZ75V',
  '1HZ100V',
] as const

export const REAL_STAKE_MIN = 1
export const REAL_STAKE_MAX = 500
export const REAL_MAX_OPEN_TRADES = 5
/** Default only — the live value is public.trading_settings 'REAL_DAILY_PROFIT_LIMIT_USD'. */
export const REAL_DAILY_PROFIT_LIMIT_USD = 1000
export const REAL_DAILY_LIMIT_TIMEZONE = 'Africa/Nairobi'
export const DAILY_LIMIT_MESSAGE = 'Daily REAL limit reached — trading resumes tomorrow.'
/** The server only opens a REAL trade against a Deriv tick at most this old. */
export const REAL_ENTRY_MAX_AGE_MS = 3_500
/** Exit ticks are searched in [expiry − 1s, expiry + 60s]. */
export const EXIT_WINDOW_MS = 60_000
/** No genuine exit tick this long after expiry → the stake is refunded (never guessed). */
export const REFUND_AFTER_MS = 10 * 60_000

export interface PriceTick {
  /** Provider epoch in milliseconds. */
  epochMs: number
  price: number
}

/**
 * Deriv may return `pip_size` as a pip value (0.01) or as decimal places (2).
 */
export function normalizePipSize(pipSize: number): number {
  if (!Number.isFinite(pipSize) || pipSize <= 0) return 0.01
  if (Number.isInteger(pipSize) && pipSize >= 1 && pipSize <= 8) {
    return 10 ** -pipSize
  }
  return pipSize
}

/** Final displayed digit of a genuine quote given its pip size; null when inputs are invalid. */
export function extractLastDigit(quote: number, pipSize: number): number | null {
  if (!Number.isFinite(quote) || !Number.isFinite(pipSize) || pipSize <= 0) return null
  const pip = normalizePipSize(pipSize)
  if (pip <= 0) return null
  const scaled = Math.round(Math.abs(quote) / pip)
  if (!Number.isFinite(scaled)) return null
  return scaled % 10
}

/** Last digit from a price string — fallback when no pip size is known. */
export function lastDigitOfPrice(price: number): number {
  const raw = Math.abs(price).toFixed(5).replace('.', '').replace(/0+$/, '')
  const digits = raw.length ? raw : '0'
  return Number(digits[digits.length - 1] ?? '0')
}

export function isValidDigit(value: unknown): value is number {
  return typeof value === 'number' && Number.isInteger(value) && value >= 0 && value <= 9
}

/** The six digit contracts by name. */
export type DigitContractKind = 'EVEN' | 'ODD' | 'MATCH' | 'DIFFER' | 'OVER' | 'UNDER'
export type ContractResult = 'WIN' | 'LOSS'
export const DIGIT_CONTRACT_KINDS: readonly DigitContractKind[] = ['EVEN', 'ODD', 'MATCH', 'DIFFER', 'OVER', 'UNDER']

export function contractKindOf(option: DigitContractOption): DigitContractKind {
  return option.toUpperCase() as DigitContractKind
}

export function contractNeedsTarget(kind: DigitContractKind): boolean {
  return kind !== 'EVEN' && kind !== 'ODD'
}

/** Ticket selection for a contract name and its target digit (ignored for EVEN / ODD). */
export function selectionForKind(kind: DigitContractKind, target: number | null): DigitContractSelection {
  const contractOption = kind.toLowerCase() as DigitContractOption
  if (kind === 'EVEN' || kind === 'ODD') return { contractType: 'EVEN_ODD', contractOption, selectedDigit: null, barrier: null }
  if (kind === 'MATCH' || kind === 'DIFFER') return { contractType: 'MATCH_DIFFER', contractOption, selectedDigit: target, barrier: null }
  return { contractType: 'OVER_UNDER', contractOption, selectedDigit: null, barrier: target }
}

/** Target digit of a selection: the MATCH / DIFFER digit or the OVER / UNDER barrier; null for EVEN / ODD. */
export function selectionTarget(selection: DigitContractSelection): number | null {
  if (selection.contractType === 'MATCH_DIFFER') return selection.selectedDigit
  if (selection.contractType === 'OVER_UNDER') return selection.barrier
  return null
}

/**
 * The single WIN / LOSS rule for every digit contract (DEMO, REAL, Auto Trade, history, scanner).
 * public.settle_real_trade re-checks REAL outcomes with the same rule in SQL.
 * EVEN wins on 0/2/4/6/8, ODD on 1/3/5/7/9, MATCH on final = target, DIFFER on final ≠ target,
 * OVER on final > target, UNDER on final < target.
 */
export function calculateTradeResult(
  contractType: DigitContractKind,
  selectedDigit: number | null,
  finalDigit: number,
): ContractResult {
  if (!isValidDigit(finalDigit)) throw new RangeError('finalDigit must be an integer from 0 to 9')
  if (contractType === 'EVEN') return finalDigit % 2 === 0 ? 'WIN' : 'LOSS'
  if (contractType === 'ODD') return finalDigit % 2 === 1 ? 'WIN' : 'LOSS'
  if (!isValidDigit(selectedDigit)) throw new RangeError(`${contractType} needs a target digit from 0 to 9`)
  switch (contractType) {
    case 'MATCH':
      return finalDigit === selectedDigit ? 'WIN' : 'LOSS'
    case 'DIFFER':
      return finalDigit !== selectedDigit ? 'WIN' : 'LOSS'
    case 'OVER':
      return finalDigit > selectedDigit ? 'WIN' : 'LOSS'
    case 'UNDER':
      return finalDigit < selectedDigit ? 'WIN' : 'LOSS'
    default:
      throw new RangeError(`Unknown contract ${String(contractType)}`)
  }
}

export function settleDigitContract(input: {
  contractType: DigitContractType
  contractOption: DigitContractOption
  selectedDigit: number | null
  barrier: number | null
  exitPrice: number
  /** Digit derived from the genuine quote with its pip size; preferred over price-string parsing. */
  exitDigit?: number | null
}): DigitOutcome {
  const digit = isValidDigit(input.exitDigit) ? input.exitDigit : lastDigitOfPrice(input.exitPrice)
  const target =
    input.contractType === 'MATCH_DIFFER'
      ? (input.selectedDigit ?? 0)
      : input.contractType === 'OVER_UNDER'
        ? (input.barrier ?? 5)
        : null
  return calculateTradeResult(contractKindOf(input.contractOption), target, digit) === 'WIN' ? 'won' : 'lost'
}

/**
 * Amount credited back at settlement: win → stake × (1 + rate) rounded down to the cent; tie/refund → stake;
 * loss → 0. The 1e-6 absorbs float error (e.g. 1.15 × 1.8 = 2.0699999…) without ever rounding a real fraction up.
 */
export function payoutFor(stake: number, payoutRate: number, outcome: DigitOutcome | 'cancelled'): number {
  if (outcome === 'won') return Math.floor(stake * (1 + payoutRate) * 100 + 1e-6) / 100
  if (outcome === 'tie' || outcome === 'cancelled') return stake
  return 0
}

/** Amount shown as "potential payout" on the ticket; $0.00 for contracts that cannot win. */
export function potentialPayout(stake: number, selection: DigitContractSelection): number {
  if (!contractCanWin(selection)) return 0
  return payoutFor(stake, digitPayoutRate(selection), 'won')
}

/** First genuine tick at or after expiry — the settlement tick. Input order does not matter. */
export function selectExitTick<T extends PriceTick>(ticks: readonly T[], expiryMs: number): T | null {
  let best: T | null = null
  for (const tick of ticks) {
    if (!Number.isFinite(tick.epochMs) || !Number.isFinite(tick.price) || tick.epochMs < expiryMs) continue
    if (!best || tick.epochMs < best.epochMs) best = tick
  }
  return best
}

/** Validates the contract selection only (type, option, digit, barrier). Returns an error message or null. */
export function validateContractSelection(input: {
  contractType?: unknown
  contractOption?: unknown
  selectedDigit?: unknown
  barrier?: unknown
}): string | null {
  const type = input.contractType as DigitContractType
  const options = typeof type === 'string' ? DIGIT_CONTRACT_OPTIONS[type] : undefined
  if (!options || !options.includes(input.contractOption as DigitContractOption)) {
    return 'Select a contract type and option.'
  }
  if (type === 'MATCH_DIFFER' && !isValidDigit(input.selectedDigit)) {
    return 'Select a digit from 0 to 9 for MATCH / DIFFER.'
  }
  if (type === 'OVER_UNDER' && !isValidDigit(input.barrier)) {
    return 'Select a barrier digit from 0 to 9 for OVER / UNDER.'
  }
  return null
}

/** Returns an error message for a REAL stake, or null when it is acceptable. */
export function validateRealStake(stake: unknown, availableBalance?: number | null): string | null {
  if (typeof stake !== 'number' || !Number.isFinite(stake)) return 'Enter a stake amount.'
  if (Math.abs(Math.round(stake * 100) - stake * 100) > 1e-6) return 'Stake can have at most 2 decimal places.'
  if (stake < REAL_STAKE_MIN) return `Minimum stake is $${REAL_STAKE_MIN}.`
  if (stake > REAL_STAKE_MAX) return `Maximum stake is $${REAL_STAKE_MAX}.`
  if (availableBalance != null && stake > availableBalance) return 'Insufficient REAL balance for this stake.'
  return null
}

export interface RealTradeRequest {
  /** Must be 'REAL': the client states which account the order is for and the server refuses anything else. */
  accountMode: 'REAL'
  symbol: (typeof REAL_TRADE_SYMBOLS)[number]
  contractType: DigitContractType
  contractOption: DigitContractOption
  selectedDigit: number | null
  barrier: number | null
  stake: number
  /** Tick contracts (current ticket). */
  durationTicks: number | null
  /** Legacy time-based contracts (old tabs); null for tick contracts. */
  durationMs: number | null
  idempotencyKey: string
}

const IDEMPOTENCY_KEY_RE = /^[A-Za-z0-9_-]{8,100}$/

/** Validates an untrusted REAL trade request body (snake_case, as sent to the real-trade Edge Function). */
export function validateRealTradeRequest(
  body: Record<string, unknown>,
): { ok: true; value: RealTradeRequest } | { ok: false; error: string } {
  if (body.account_mode !== 'REAL') {
    return { ok: false, error: 'This order is not marked for the REAL account. Reload the page and try again.' }
  }
  const symbol = String(body.symbol ?? '')
  if (!(REAL_TRADE_SYMBOLS as readonly string[]).includes(symbol)) {
    return { ok: false, error: 'This market is not available for REAL trading.' }
  }
  const contractType = body.contract_type as DigitContractType
  const selection = validateContractSelection({
    contractType,
    contractOption: body.contract_option,
    selectedDigit: body.selected_digit,
    barrier: body.barrier,
  })
  if (selection) return { ok: false, error: selection }
  const stakeError = validateRealStake(body.stake)
  if (stakeError) return { ok: false, error: stakeError }
  let durationTicks: number | null = null
  let durationMs: number | null = null
  if (body.duration_ticks !== undefined && body.duration_ticks !== null) {
    if (!isValidTickDuration(body.duration_ticks)) {
      return { ok: false, error: `Select a duration of ${TICK_DURATION_MIN}–${TICK_DURATION_MAX} ticks.` }
    }
    durationTicks = body.duration_ticks
  } else {
    if (!TRADE_DURATIONS.some((item) => item.ms === body.duration)) {
      return { ok: false, error: 'Select a valid duration.' }
    }
    durationMs = body.duration as number
  }
  const idempotencyKey = String(body.idempotency_key ?? '')
  if (!IDEMPOTENCY_KEY_RE.test(idempotencyKey)) return { ok: false, error: 'Invalid request.' }
  return {
    ok: true,
    value: {
      accountMode: 'REAL',
      symbol: symbol as RealTradeRequest['symbol'],
      contractType,
      contractOption: body.contract_option as DigitContractOption,
      selectedDigit: contractType === 'MATCH_DIFFER' ? (body.selected_digit as number) : null,
      barrier: contractType === 'OVER_UNDER' ? (body.barrier as number) : null,
      stake: body.stake as number,
      durationTicks,
      durationMs,
      idempotencyKey,
    },
  }
}
