/** Theme colours for canvas/SVG code that cannot read Tailwind classes. Keep in sync with `@theme` in index.css. */
export const PALETTE = {
  mist: '#9ca3af',
  line: '#2a2f3d',
  signal: '#3b82f6',
  sky: '#38bdf8',
  call: '#10b981',
  put: '#f43f5e',
  grid: 'rgba(255, 255, 255, 0.04)',
} as const

export function withAlpha(hex: string, alpha: number): string {
  const value = Number.parseInt(hex.slice(1), 16)
  return `rgba(${(value >> 16) & 255}, ${(value >> 8) & 255}, ${value & 255}, ${alpha})`
}
