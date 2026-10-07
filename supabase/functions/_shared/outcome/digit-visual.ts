import { ACCOUNT_WIN_RATE, isAccountWinDigit } from './win-rate.ts'

/** Count ticks that would settle as a win under the account outcome policy (exit digit 0–8). */
export function settlementWinCount(digits: readonly number[]): number {
  let wins = 0
  for (const digit of digits) {
    if (Number.isInteger(digit) && digit >= 0 && digit <= 9 && isAccountWinDigit(digit)) wins += 1
  }
  return wins
}

/** Count ticks that would settle as a loss (exit digit 9). */
export function settlementLossCount(digits: readonly number[]): number {
  let losses = 0
  for (const digit of digits) {
    if (digit === 9) losses += 1
  }
  return losses
}

/** Share of sample ticks that would settle won (0 when empty). */
export function settlementWinRate(digits: readonly number[]): number {
  const wins = settlementWinCount(digits)
  const losses = settlementLossCount(digits)
  const total = wins + losses
  return total > 0 ? wins / total : 0
}

/** Expected wins in a sample of `n` ticks at {@link ACCOUNT_WIN_RATE}. */
export function expectedSettlementWins(n: number): number {
  return Math.round(n * ACCOUNT_WIN_RATE)
}
