export type AccountOutcome = 'won' | 'lost'
export type AccountContractResult = 'WIN' | 'LOSS'

function assertDigit(finalDigit: number): number {
  if (typeof finalDigit !== 'number' || !Number.isInteger(finalDigit) || finalDigit < 0 || finalDigit > 9) {
    throw new RangeError('finalDigit must be an integer from 0 to 9')
  }
  return finalDigit
}

function isValidDigit(value: unknown): value is number {
  return typeof value === 'number' && Number.isInteger(value) && value >= 0 && value <= 9
}

/**
 * Natural contract outcome from a final digit (shared DEMO / REAL result engine).
 * Prefer {@link settleDigitContract} when the full selection is available.
 */
export function resolveAccountOutcome(
  finalDigit: number,
  contractOption?: string | null,
  selectedDigit?: number | null,
  barrier?: number | null,
): AccountOutcome {
  const digit = assertDigit(finalDigit)
  const option = String(contractOption ?? '').toLowerCase()
  if (option === 'even') return digit % 2 === 0 ? 'won' : 'lost'
  if (option === 'odd') return digit % 2 === 1 ? 'won' : 'lost'
  if (option === 'match') {
    if (!isValidDigit(selectedDigit)) throw new RangeError('MATCH needs a target digit from 0 to 9')
    return digit === selectedDigit ? 'won' : 'lost'
  }
  if (option === 'differ') {
    if (!isValidDigit(selectedDigit)) throw new RangeError('DIFFER needs a target digit from 0 to 9')
    return digit !== selectedDigit ? 'won' : 'lost'
  }
  if (option === 'over') {
    if (!isValidDigit(barrier)) throw new RangeError('OVER needs a barrier digit from 0 to 9')
    return digit > barrier ? 'won' : 'lost'
  }
  if (option === 'under') {
    if (!isValidDigit(barrier)) throw new RangeError('UNDER needs a barrier digit from 0 to 9')
    return digit < barrier ? 'won' : 'lost'
  }
  throw new RangeError(`Unknown contract option ${String(contractOption)}`)
}

/** WIN / LOSS form of {@link resolveAccountOutcome} (history, animations). */
export function calculateAccountTradeResult(
  finalDigit: number,
  contractOption?: string | null,
  selectedDigit?: number | null,
  barrier?: number | null,
): AccountContractResult {
  return resolveAccountOutcome(finalDigit, contractOption, selectedDigit, barrier) === 'won' ? 'WIN' : 'LOSS'
}

export function lastDigitOfPrice(price: number): number {
  const raw = Math.abs(price).toFixed(5).replace('.', '').replace(/0+$/, '')
  const digits = raw.length ? raw : '0'
  return Number(digits[digits.length - 1] ?? '0')
}

export { isValidDigit }

/**
 * Settles a digit contract for DEMO and REAL using natural EVEN/ODD/MATCH/DIFFER/OVER/UNDER rules.
 * Prefer `exitDigit` from the genuine quote + pip size; fall back to the price string.
 */
export function settleDigitContract(input: {
  contractType?: string
  contractOption?: string
  selectedDigit?: number | null
  barrier?: number | null
  exitPrice: number
  exitDigit?: number | null
}): AccountOutcome {
  const digit = isValidDigit(input.exitDigit) ? input.exitDigit : lastDigitOfPrice(input.exitPrice)
  return resolveAccountOutcome(digit, input.contractOption, input.selectedDigit, input.barrier)
}
