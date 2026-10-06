import {
  useEffect,
  useId,
  useRef,
  type ButtonHTMLAttributes,
  type InputHTMLAttributes,
  type ReactNode,
  type SelectHTMLAttributes,
  type TextareaHTMLAttributes,
} from 'react'
import { cn } from '@/lib/cn'

type ButtonVariant = 'primary' | 'secondary' | 'ghost' | 'call' | 'put' | 'danger' | 'amber'
type ButtonSize = 'sm' | 'md' | 'lg'

export function Button({
  variant = 'primary',
  size = 'md',
  className,
  children,
  ...props
}: ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: ButtonVariant
  size?: ButtonSize
}) {
  const variants: Record<ButtonVariant, string> = {
    primary:
      'bg-signal-strong text-white shadow-[0_8px_20px_-6px_rgb(59_130_246_/_0.45)] hover:bg-signal-hover focus-visible:ring-signal disabled:bg-surface-3 disabled:text-mist disabled:shadow-none',
    secondary:
      'bg-surface-2 text-paper border border-line hover:border-line-strong hover:bg-surface-3 focus-visible:ring-mist',
    ghost: 'bg-transparent text-mist hover:text-paper hover:bg-surface-2 focus-visible:ring-mist',
    call: 'bg-call text-ink hover:bg-call-hover focus-visible:ring-call',
    put: 'bg-put text-ink hover:bg-put-hover focus-visible:ring-put',
    danger: 'bg-danger/15 text-danger border border-danger/40 hover:bg-danger/25 focus-visible:ring-danger',
    amber: 'bg-amber text-ink hover:bg-amber-hover focus-visible:ring-amber',
  }
  const sizes: Record<ButtonSize, string> = {
    sm: 'h-9 px-3 text-sm',
    md: 'h-11 px-4 text-sm',
    lg: 'h-12 px-5 text-base',
  }
  return (
    <button
      className={cn(
        'inline-flex items-center justify-center gap-2 rounded-xl font-semibold tracking-tight transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-offset-2 focus-visible:ring-offset-ink disabled:cursor-not-allowed disabled:opacity-60',
        variants[variant],
        sizes[size],
        className,
      )}
      {...props}
    >
      {children}
    </button>
  )
}

export function Input({
  label,
  hint,
  error,
  className,
  id,
  ...props
}: InputHTMLAttributes<HTMLInputElement> & { label?: string; hint?: string; error?: string }) {
  const autoId = useId()
  const inputId = id ?? autoId
  return (
    <label className="block space-y-1.5" htmlFor={inputId}>
      {label ? <span className="text-sm font-medium text-paper">{label}</span> : null}
      <input
        id={inputId}
        className={cn(
          'h-11 w-full rounded-xl border border-line bg-ink-2 px-3 text-paper placeholder:text-mist/70 outline-none transition-colors focus:border-signal focus:ring-2 focus:ring-signal/25',
          error && 'border-danger focus:border-danger focus:ring-danger/25',
          className,
        )}
        {...props}
      />
      {error ? <span className="text-xs text-danger">{error}</span> : hint ? <span className="text-xs text-mist">{hint}</span> : null}
    </label>
  )
}

export function Textarea({
  label,
  error,
  className,
  id,
  ...props
}: TextareaHTMLAttributes<HTMLTextAreaElement> & { label?: string; error?: string }) {
  const autoId = useId()
  const inputId = id ?? autoId
  return (
    <label className="block space-y-1.5" htmlFor={inputId}>
      {label ? <span className="text-sm font-medium text-paper">{label}</span> : null}
      <textarea
        id={inputId}
        className={cn(
          'min-h-28 w-full rounded-xl border border-line bg-ink-2 px-3 py-2.5 text-paper placeholder:text-mist/70 outline-none transition-colors focus:border-signal focus:ring-2 focus:ring-signal/25',
          error && 'border-danger',
          className,
        )}
        {...props}
      />
      {error ? <span className="text-xs text-danger">{error}</span> : null}
    </label>
  )
}

export function Select({
  label,
  className,
  id,
  children,
  ...props
}: SelectHTMLAttributes<HTMLSelectElement> & { label?: string; children: ReactNode }) {
  const autoId = useId()
  const inputId = id ?? autoId
  return (
    <label className="block space-y-1.5" htmlFor={inputId}>
      {label ? <span className="text-sm font-medium text-paper">{label}</span> : null}
      <select
        id={inputId}
        className={cn(
          'h-11 w-full rounded-xl border border-line bg-ink-2 px-3 text-paper outline-none focus:border-signal focus:ring-2 focus:ring-signal/25',
          className,
        )}
        {...props}
      >
        {children}
      </select>
    </label>
  )
}

export function Card({
  className,
  children,
  padded = true,
  'data-testid': testId,
}: {
  className?: string
  children: ReactNode
  padded?: boolean
  'data-testid'?: string
}) {
  return (
    <div
      className={cn(
        'rounded-2xl border border-line bg-surface/80 shadow-[inset_0_1px_0_rgb(255_255_255_/_0.03)]',
        padded && 'p-4 sm:p-5',
        className,
      )}
      data-testid={testId}
    >
      {children}
    </div>
  )
}

export function Badge({
  tone = 'mist',
  children,
  className,
}: {
  tone?: 'mist' | 'signal' | 'amber' | 'demo' | 'live' | 'call' | 'put' | 'danger' | 'warn'
  children: ReactNode
  className?: string
}) {
  const tones = {
    mist: 'bg-surface-3 text-mist border-line',
    signal: 'bg-signal/15 text-signal border-signal/30',
    amber: 'bg-amber/15 text-amber border-amber/30',
    demo: 'bg-demo/15 text-demo border-demo/35',
    live: 'bg-live/15 text-live border-live/40',
    call: 'bg-call/15 text-call border-call/30',
    put: 'bg-put/15 text-put border-put/30',
    danger: 'bg-danger/15 text-danger border-danger/30',
    warn: 'bg-warn/15 text-warn border-warn/30',
  } as const
  return (
    <span
      className={cn(
        'inline-flex items-center gap-1 rounded-full border px-2.5 py-0.5 text-[11px] font-semibold uppercase tracking-wide',
        tones[tone],
        className,
      )}
    >
      {children}
    </span>
  )
}

export function Alert({
  tone = 'warn',
  title,
  children,
  className,
}: {
  tone?: 'warn' | 'danger' | 'signal' | 'mist'
  title?: string
  children: ReactNode
  className?: string
}) {
  const tones = {
    warn: 'border-warn/35 bg-warn/10 text-paper',
    danger: 'border-danger/40 bg-danger/10 text-paper',
    signal: 'border-signal/35 bg-signal/10 text-paper',
    mist: 'border-line bg-surface-2 text-paper',
  } as const
  return (
    <div className={cn('rounded-xl border px-3.5 py-3 text-sm', tones[tone], className)} role="status">
      {title ? <p className="mb-1 font-semibold">{title}</p> : null}
      <div className="text-mist">{children}</div>
    </div>
  )
}

export function Skeleton({ className }: { className?: string }) {
  return <div className={cn('animate-pulse rounded-lg bg-surface-3', className)} />
}

export function EmptyState({
  title,
  body,
  action,
}: {
  title: string
  body?: string
  action?: ReactNode
}) {
  return (
    <div className="flex flex-col items-center justify-center gap-2 px-4 py-10 text-center">
      <div className="mb-1 h-10 w-10 rounded-xl border border-dashed border-line-strong" />
      <h3 className="font-display text-base font-semibold text-paper">{title}</h3>
      {body ? <p className="max-w-md text-sm text-mist">{body}</p> : null}
      {action}
    </div>
  )
}

export function PageHeader({
  title,
  subtitle,
  actions,
}: {
  title: string
  subtitle?: string
  actions?: ReactNode
}) {
  return (
    <div className="mb-5 flex flex-wrap items-start justify-between gap-3">
      <div>
        <h1 className="font-display text-xl font-semibold tracking-tight text-paper sm:text-2xl">{title}</h1>
        {subtitle ? <p className="mt-1 max-w-2xl text-sm text-mist">{subtitle}</p> : null}
      </div>
      {actions}
    </div>
  )
}

export function Stat({
  label,
  value,
  hint,
  tone,
}: {
  label: string
  value: string
  hint?: string
  tone?: 'demo' | 'live' | 'default'
}) {
  return (
    <div className="rounded-xl border border-line bg-ink-2/60 p-3.5">
      <p className="text-[11px] font-semibold uppercase tracking-wider text-mist">{label}</p>
      <p
        className={cn(
          'mt-1 font-mono text-lg font-semibold',
          tone === 'demo' && 'text-demo',
          tone === 'live' && 'text-live',
          !tone && 'text-paper',
        )}
      >
        {value}
      </p>
      {hint ? <p className="mt-1 text-xs text-mist">{hint}</p> : null}
    </div>
  )
}

export function Tabs({
  items,
  value,
  onChange,
}: {
  items: Array<{ id: string; label: string }>
  value: string
  onChange: (id: string) => void
}) {
  return (
    <div className="flex flex-wrap gap-1 rounded-xl border border-line bg-ink-2 p-1" role="tablist">
      {items.map((item) => (
        <button
          key={item.id}
          type="button"
          role="tab"
          aria-selected={value === item.id}
          onClick={() => onChange(item.id)}
          className={cn(
            'min-w-0 flex-1 rounded-lg px-3 py-2 text-sm font-medium',
            value === item.id ? 'bg-surface-3 text-paper' : 'text-mist hover:text-paper',
          )}
        >
          {item.label}
        </button>
      ))}
    </div>
  )
}

export function QuoteRow({
  label,
  value,
  hint,
  unavailable = false,
}: {
  label: string
  value: string
  hint?: string
  unavailable?: boolean
}) {
  return (
    <div className="flex items-start justify-between gap-3 py-1.5">
      <div>
        <p className="text-[11px] font-semibold uppercase tracking-wider text-mist">{label}</p>
        {hint ? <p className="text-[11px] text-mist/80">{hint}</p> : null}
      </div>
      <p className={cn('text-right font-mono text-sm font-semibold', unavailable ? 'text-warn' : 'text-paper')}>
        {value}
      </p>
    </div>
  )
}

export function Modal({
  open,
  title,
  children,
  onClose,
}: {
  open: boolean
  title: string
  children: ReactNode
  onClose: () => void
}) {
  const dialogRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!open) return
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', onKey)
    dialogRef.current?.focus()
    return () => window.removeEventListener('keydown', onKey)
  }, [open, onClose])

  if (!open) return null

  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center p-4 sm:items-center" role="presentation">
      <button type="button" className="absolute inset-0 bg-black/60" aria-label="Close dialog" onClick={onClose} />
      <div
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby="modal-title"
        tabIndex={-1}
        className="relative z-10 w-full max-w-md rounded-2xl border border-line bg-surface p-5 shadow-2xl outline-none"
      >
        <h2 id="modal-title" className="font-display text-lg font-semibold">
          {title}
        </h2>
        <div className="mt-3">{children}</div>
      </div>
    </div>
  )
}

export function DataTable({
  columns,
  empty,
  rows = [],
}: {
  columns: string[]
  empty: ReactNode
  rows?: ReactNode[][]
}) {
  return (
    <div className="overflow-x-auto">
      <table className="w-full text-left text-sm">
        <thead>
          <tr className="border-b border-line text-[11px] uppercase tracking-wider text-mist">
            {columns.map((column) => (
              <th key={column} className="px-3 py-2 font-semibold">
                {column}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.length === 0 ? (
            <tr>
              <td colSpan={columns.length}>{empty}</td>
            </tr>
          ) : (
            rows.map((row, index) => (
              <tr key={`${typeof row[0] === 'string' ? row[0] : 'row'}-${index}`} className="border-b border-line/60 last:border-0">
                {row.map((cell, cellIndex) => (
                  <td key={`${columns[cellIndex]}-${cellIndex}`} className="px-3 py-2 font-mono text-xs text-paper">
                    {cell}
                  </td>
                ))}
              </tr>
            ))
          )}
        </tbody>
      </table>
    </div>
  )
}

export function IconButton({
  label,
  className,
  children,
  ...props
}: ButtonHTMLAttributes<HTMLButtonElement> & { label: string }) {
  return (
    <button
      type="button"
      aria-label={label}
      className={cn(
        'inline-flex h-8 w-8 items-center justify-center rounded-lg border border-line bg-surface-2 text-mist hover:text-paper disabled:opacity-40',
        className,
      )}
      {...props}
    >
      {children}
    </button>
  )
}
