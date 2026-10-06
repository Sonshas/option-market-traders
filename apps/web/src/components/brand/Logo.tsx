import { useId } from 'react'
import { Link } from 'react-router-dom'
import { cn } from '@/lib/cn'
import { APP_NAME } from '@/lib/constants'
import { PALETTE } from '@/lib/palette'

export function Mark({ className }: { className?: string }) {
  const gradientId = `sbb-mark-${useId().replace(/[^a-zA-Z0-9_-]/g, '')}`
  return (
    <svg viewBox="0 0 32 32" className={cn('h-8 w-8', className)} aria-hidden>
      <defs>
        <linearGradient id={gradientId} x1="0" y1="0" x2="32" y2="32" gradientUnits="userSpaceOnUse">
          <stop stopColor={PALETTE.signal} />
          <stop offset="1" stopColor={PALETTE.sky} />
        </linearGradient>
      </defs>
      <rect width="32" height="32" rx="9" fill={`url(#${gradientId})`} />
      <path d="M9 21V14" stroke="#fff" strokeWidth="2.4" strokeLinecap="round" />
      <path d="M14 22.5V10" stroke="#fff" strokeWidth="2.4" strokeLinecap="round" />
      <path d="M19 20V12.5" stroke="#fff" strokeOpacity="0.85" strokeWidth="2.4" strokeLinecap="round" />
      <path d="M24 21.5V9.5" stroke="#fff" strokeWidth="2.4" strokeLinecap="round" />
    </svg>
  )
}

export function Logo({
  to = '/',
  compact = false,
  className,
}: {
  to?: string
  compact?: boolean
  className?: string
}) {
  return (
    <Link to={to} className={cn('inline-flex items-center gap-2.5 text-paper no-underline', className)}>
      <Mark />
      {compact ? (
        <span className="font-display text-sm font-bold tracking-tight">SBB</span>
      ) : (
        <span className="font-display text-[15px] font-bold tracking-tight">
          SmartBase<span className="sbb-gradient-text">Binary</span>
        </span>
      )}
      <span className="sr-only">{APP_NAME}</span>
    </Link>
  )
}
