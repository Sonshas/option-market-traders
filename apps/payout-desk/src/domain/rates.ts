export interface PayoutRates {
  minWithdrawUsd: number
  kesPerUsdWithdrawal: number
  mpesaCapKes: number
}

/** Matches the defaults installed in supabase/migrations. The live row wins after sign-in. */
export const FALLBACK_RATES: PayoutRates = {
  minWithdrawUsd: 1,
  kesPerUsdWithdrawal: 134,
  mpesaCapKes: 400_000,
}

export function roundMoney(value: number): number {
  return Math.round((value + Number.EPSILON) * 100) / 100
}

/** Withdrawals carry no fee: the member receives the full amount at the payout rate. */
export function withdrawalQuote(amountUsd: number, rates: PayoutRates) {
  const grossUsd = roundMoney(Math.max(0, amountUsd))
  const kesPayout = roundMoney(grossUsd * rates.kesPerUsdWithdrawal)
  return { grossUsd, kesPayout }
}

export function displayPhone(national: string): string {
  const digits = national.replace(/\D/g, '')
  if (digits.startsWith('254')) return digits
  return `254${digits}`
}
