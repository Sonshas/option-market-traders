import type { ReactNode } from 'react'

export const btn =
  'inline-flex items-center justify-center rounded-full bg-signal-strong px-4 py-2.5 text-sm font-semibold text-paper transition hover:bg-signal-hover disabled:cursor-not-allowed disabled:opacity-50'
export const btnQuiet =
  'inline-flex items-center justify-center rounded-full border border-line-strong bg-surface-3 px-4 py-2.5 text-sm font-semibold text-paper transition hover:border-signal disabled:cursor-not-allowed disabled:opacity-50'
export const btnDanger =
  'inline-flex items-center justify-center rounded-full border border-put/40 px-4 py-2.5 text-sm font-semibold text-put transition hover:bg-put/10 disabled:cursor-not-allowed disabled:opacity-50'

export function Banner({ tone, children }: { tone: 'info' | 'warning' | 'error'; children: ReactNode }) {
  const toneClass =
    tone === 'error'
      ? 'border-put/40 text-paper'
      : tone === 'warning'
        ? 'border-warn/40 text-paper'
        : 'border-signal/40 text-paper'
  return (
    <div role={tone === 'error' ? 'alert' : 'status'} className={`rounded-2xl border bg-surface-2 px-4 py-3 text-sm ${toneClass}`}>
      {children}
    </div>
  )
}
