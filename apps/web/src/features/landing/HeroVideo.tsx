import { useEffect, useRef, useState } from 'react'

const MOBILE_QUERY = '(max-width: 767px)'
const REDUCED_MOTION_QUERY = '(prefers-reduced-motion: reduce)'

const variants = {
  desktop: {
    poster: '/media/images/hero-trading-desk-poster-v1.webp',
    sources: [
      { src: '/media/videos/hero-trading-desk-v1.webm', type: 'video/webm' },
      { src: '/media/videos/hero-trading-desk-v1.mp4', type: 'video/mp4' },
    ],
  },
  mobile: {
    poster: '/media/images/hero-trading-mobile-poster-v1.webp',
    sources: [
      { src: '/media/videos/hero-trading-mobile-v1.mp4', type: 'video/mp4' },
      { src: '/media/videos/hero-trading-mobile-v1.webm', type: 'video/webm' },
    ],
  },
} as const

type Variant = keyof typeof variants

function matches(query: string): boolean {
  return typeof window !== 'undefined' && typeof window.matchMedia === 'function' && window.matchMedia(query).matches
}

function useMediaQuery(query: string): boolean {
  const [value, setValue] = useState(() => matches(query))
  useEffect(() => {
    if (typeof window.matchMedia !== 'function') return
    const list = window.matchMedia(query)
    const onChange = () => setValue(list.matches)
    onChange()
    list.addEventListener('change', onChange)
    return () => list.removeEventListener('change', onChange)
  }, [query])
  return value
}

/**
 * Full-bleed background footage for the landing hero. Only one variant is ever mounted, so the
 * desktop and mobile files are never fetched together. Falls back to the poster when autoplay is
 * refused or the visitor prefers reduced motion.
 */
export function HeroVideo() {
  const variant: Variant = useMediaQuery(MOBILE_QUERY) ? 'mobile' : 'desktop'
  const reducedMotion = useMediaQuery(REDUCED_MOTION_QUERY)
  const [blocked, setBlocked] = useState(false)
  const videoRef = useRef<HTMLVideoElement>(null)
  const media = variants[variant]

  useEffect(() => {
    const video = videoRef.current
    if (!video || reducedMotion) return
    setBlocked(false)
    video.muted = true
    const attempt = video.play()
    if (attempt) attempt.catch(() => setBlocked(true))
  }, [variant, reducedMotion])

  const showPoster = reducedMotion || blocked

  return (
    <div className="absolute inset-0 overflow-hidden bg-ink-3" aria-hidden>
      {reducedMotion ? null : (
        <video
          key={variant}
          ref={videoRef}
          className="absolute inset-0 h-full w-full object-cover"
          poster={media.poster}
          autoPlay
          muted
          loop
          playsInline
          preload="auto"
          disablePictureInPicture
          disableRemotePlayback
          tabIndex={-1}
          data-hero-video={variant}
        >
          {media.sources.map((source) => (
            <source key={source.src} src={source.src} type={source.type} />
          ))}
        </video>
      )}
      {showPoster ? (
        <img
          src={media.poster}
          alt=""
          className="absolute inset-0 h-full w-full object-cover"
          fetchPriority="high"
          decoding="async"
          data-hero-poster
        />
      ) : null}
      <div className="absolute inset-0 bg-[linear-gradient(180deg,rgb(11_13_18_/_0.72)_0%,rgb(11_13_18_/_0.48)_38%,rgb(11_13_18_/_0.55)_70%,rgb(15_17_23_/_0.92)_100%)]" />
      <div className="absolute inset-0 bg-[radial-gradient(ellipse_at_center,rgb(11_13_18_/_0.25)_0%,transparent_70%)]" />
    </div>
  )
}
