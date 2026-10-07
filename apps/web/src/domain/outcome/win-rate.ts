/**
 * Account win-rate policy for every trade type (DEMO and REAL).
 * Outcome settlement and payout pricing both use this rate.
 */

/** Fixed win rate for all accounts and all trade types. */
export const ACCOUNT_WIN_RATE = 0.9

/** Winning digits out of 10 under ACCOUNT_WIN_RATE (exit digit 0–8 wins; 9 loses). */
export const ACCOUNT_WINNING_DIGIT_COUNT = 9

export function accountWinProbability(): number {
  return ACCOUNT_WIN_RATE
}

/**
 * Profit per $1 on a win at ACCOUNT_WIN_RATE with the 5% house margin:
 * floor((95 − 10n) × 1000 / n) / 10000 → 0.0555 when n = 9.
 */
export function accountDigitPayoutRate(): number {
  const n = ACCOUNT_WINNING_DIGIT_COUNT
  if (n <= 0) return 0
  return Math.floor(((95 - 10 * n) * 1000) / n) / 10000
}

/** Exit digits that count as wins under the account policy (9 of 10). */
export function isAccountWinDigit(finalDigit: number): boolean {
  return Number.isInteger(finalDigit) && finalDigit >= 0 && finalDigit <= 8
}
