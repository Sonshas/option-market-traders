export function usd(value: number): string {
  return value.toLocaleString('en-US', { style: 'currency', currency: 'USD' })
}

export function kes(value: number): string {
  return `KES ${value.toLocaleString('en-KE', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
}

export function when(iso: string): string {
  return new Date(iso).toLocaleString('en-KE', {
    day: '2-digit',
    month: 'short',
    hour: '2-digit',
    minute: '2-digit',
  })
}
