export function formatMoney(value: number | null | undefined, currency = 'USD'): string {
  if (value === null || value === undefined) return '—'
  return new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency,
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(value)
}

export function formatPrice(value: number | null | undefined): string {
  if (value === null || value === undefined) return 'Unavailable'
  return new Intl.NumberFormat('en-US', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 5,
  }).format(value)
}

/** Decimal places implied by a pip size (0.01 → 2); null when unknown. */
export function pipDecimals(pipSize: number | null | undefined): number | null {
  if (pipSize == null || !Number.isFinite(pipSize) || pipSize <= 0) return null
  if (Number.isInteger(pipSize) && pipSize >= 1 && pipSize <= 8) return pipSize
  return Math.max(0, Math.min(8, Math.round(-Math.log10(pipSize))))
}

/** Quote at full provider precision so the displayed last digit matches the contract digit. */
export function formatQuote(value: number | null | undefined, pipSize?: number | null): string {
  if (value === null || value === undefined || !Number.isFinite(value)) return 'Unavailable'
  const decimals = pipDecimals(pipSize)
  if (decimals == null) return formatPrice(value)
  return new Intl.NumberFormat('en-US', {
    minimumFractionDigits: decimals,
    maximumFractionDigits: decimals,
  }).format(value)
}

export function formatPercent(value: number | null | undefined): string {
  if (value === null || value === undefined) return '—'
  return `${(value * 100).toFixed(2)}%`
}

export function isValidEmail(email: string): boolean {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim())
}
