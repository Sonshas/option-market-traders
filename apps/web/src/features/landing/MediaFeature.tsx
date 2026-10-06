import type { ReactNode } from 'react'
import { cn } from '@/lib/cn'

const WIDTHS = [640, 1024, 1600] as const

export interface MediaFeatureProps {
  id?: string
  eyebrow: string
  title: string
  body: ReactNode
  points?: string[]
  /** Base name under /media/images; files exist as `<image>-<width>.webp`. */
  image: string
  alt: string
  /** Puts the photo on the right at desktop widths. */
  reverse?: boolean
  /** `wide` gives the photo more of the row; `tall` uses a portrait crop on desktop. */
  layout?: 'balanced' | 'wide' | 'tall'
  className?: string
  children?: ReactNode
}

export function MediaFeature({
  id,
  eyebrow,
  title,
  body,
  points,
  image,
  alt,
  reverse = false,
  layout = 'balanced',
  className,
  children,
}: MediaFeatureProps) {
  const grid =
    layout === 'wide' ? 'lg:grid-cols-[minmax(0,1.35fr)_minmax(0,1fr)]' : 'lg:grid-cols-2'
  const aspect = layout === 'tall' ? 'aspect-[4/3] lg:aspect-[4/5]' : layout === 'wide' ? 'aspect-[16/10]' : 'aspect-[4/3]'
  const sizes = layout === 'wide' ? '(min-width: 1024px) 640px, 100vw' : '(min-width: 1024px) 560px, 100vw'

  return (
    <section id={id} className={cn('border-t border-line', className)}>
      <div className={cn('mx-auto grid max-w-6xl items-center gap-8 px-4 py-16 sm:py-20 lg:gap-14', grid)}>
        <figure className={cn('relative min-w-0', reverse && 'lg:order-2')}>
          <div className={cn('relative overflow-hidden rounded-3xl border border-line bg-surface-2 shadow-[0_40px_80px_-40px_rgb(0_0_0_/_0.9)]', aspect)}>
            <img
              src={`/media/images/${image}-1024.webp`}
              srcSet={WIDTHS.map((w) => `/media/images/${image}-${w}.webp ${w}w`).join(', ')}
              sizes={sizes}
              alt={alt}
              width={1600}
              height={1067}
              loading="lazy"
              decoding="async"
              className="absolute inset-0 h-full w-full object-cover"
            />
            <div className="pointer-events-none absolute inset-0 bg-[linear-gradient(180deg,transparent_55%,rgb(11_13_18_/_0.45)_100%)]" />
          </div>
        </figure>
        <div className="min-w-0">
          <p className="text-xs font-bold uppercase tracking-[0.18em] text-signal">{eyebrow}</p>
          <h2 className="mt-3 font-display text-3xl font-bold tracking-tight sm:text-[2.5rem] sm:leading-tight">{title}</h2>
          <div className="mt-4 space-y-3 text-mist">{body}</div>
          {points && points.length > 0 ? (
            <ul className="mt-6 space-y-2.5">
              {points.map((point) => (
                <li key={point} className="flex items-start gap-3 text-sm text-paper/90">
                  <span className="mt-1.5 h-2 w-2 shrink-0 rounded-full bg-signal" aria-hidden />
                  {point}
                </li>
              ))}
            </ul>
          ) : null}
          {children}
        </div>
      </div>
    </section>
  )
}
