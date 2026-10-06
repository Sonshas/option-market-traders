import { useMemo, useState, type ReactNode } from 'react'
import { Link } from 'react-router-dom'
import { Icon, type NavIconName } from '@/components/icons'
import { HeroVideo } from '@/features/landing/HeroVideo'
import { MediaFeature } from '@/features/landing/MediaFeature'
import { changePctOf, useLiveTicker } from '@/features/landing/useLiveTicker'
import { digitOfTick } from '@/domain/digit-stats'
import { RISK_DISCLAIMER } from '@/lib/constants'
import { cn } from '@/lib/cn'
import { formatMoney, pipDecimals } from '@/lib/format'
import { PALETTE } from '@/lib/palette'
import { DEMO_STARTING_BALANCE } from '@/providers/config'
import type { ConnectionStatus, Market, Tick } from '@/types'

const primaryCta =
  'inline-flex h-12 items-center justify-center gap-2 rounded-xl bg-signal-strong px-6 text-sm font-semibold text-white no-underline shadow-[0_14px_28px_-10px_rgb(59_130_246_/_0.6)] transition-colors hover:bg-signal-hover focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-signal focus-visible:ring-offset-2 focus-visible:ring-offset-ink'
const outlineCta =
  'inline-flex h-12 items-center justify-center gap-2 rounded-xl border border-line-strong bg-ink-2/60 px-6 text-sm font-semibold text-paper no-underline transition-colors hover:border-mist focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-mist'

const heroChips = ['Live Deriv ticks', '3 digit contract families', 'Practise in DEMO first', 'Settles on the genuine exit tick']

const contracts = [
  {
    no: '01',
    title: 'Even / Odd',
    body: 'Call whether the final digit of the exit tick lands on an even or an odd number.',
    winners: [0, 2, 4, 6, 8],
    caption: 'Example: EVEN wins on 0, 2, 4, 6, 8',
  },
  {
    no: '02',
    title: 'Match / Differ',
    body: 'Pick one digit from 0 to 9, then say whether the exit tick will match it or land on anything else.',
    winners: [7],
    caption: 'Example: MATCH 7 wins only on 7',
  },
  {
    no: '03',
    title: 'Over / Under',
    body: 'Set a barrier digit and predict whether the exit digit finishes above or below it.',
    winners: [5, 6, 7, 8, 9],
    caption: 'Example: OVER 4 wins on 5 to 9',
  },
]

const tradeSteps = [
  {
    title: 'Pick a market and contract',
    body: 'Choose a volatility index and one of the three digit contract families.',
  },
  {
    title: 'Set your stake and duration',
    body: 'Enter the amount you are prepared to risk and how many seconds the contract runs.',
  },
  {
    title: 'Review the ticket',
    body: 'Check the prediction, stake and payout shown on the ticket before anything is placed.',
  },
  {
    title: 'Confirm and watch the exit tick',
    body: 'The contract settles on the first genuine tick at expiry. The result is recorded in your history.',
  },
]

const tools: Array<{ icon: NavIconName; title: string; body: string }> = [
  {
    icon: 'trade',
    title: 'Tick and candle charts',
    body: 'Up to 1,000 genuine ticks backfilled on load, then streamed live. Switch to 1m–1h candles any time.',
  },
  {
    icon: 'markets',
    title: 'Last-digit analytics',
    body: 'Digit distribution, parity streaks and over/under ratios computed from the ticks on your screen.',
  },
  {
    icon: 'lock',
    title: 'Separate DEMO and REAL',
    body: 'Balances, trades and history never mix. REAL stays clearly marked and disabled until it is connected.',
  },
  {
    icon: 'copy',
    title: 'Copy with caps',
    body: 'Allocation limits and a daily loss ceiling come first. DEMO traders are always labelled as DEMO.',
  },
  {
    icon: 'admin',
    title: 'Honest data states',
    body: 'If the feed drops, you see it. Prices, balances and results are never filled in with made-up numbers.',
  },
]

const startSteps = [
  { title: 'Create your account', body: 'Sign up with an email address. It takes about a minute.' },
  { title: 'Open the DEMO workspace', body: 'Your DEMO balance is ready to use straight away, at no cost.' },
  { title: 'Trade digits on live ticks', body: 'Place EVEN/ODD, MATCH/DIFFER or OVER/UNDER contracts and review every result.' },
]

const faqs = [
  {
    q: 'Are the prices on SmartBaseBinary real?',
    a: 'Yes. Charts, the ticker and digit statistics use the public Deriv tick stream. If the stream is unavailable we show that state instead of inventing prices.',
  },
  {
    q: 'What can I trade?',
    a: 'Digit contracts only: EVEN / ODD, MATCH / DIFFER and OVER / UNDER on Deriv volatility indices.',
  },
  {
    q: 'Is the DEMO account free?',
    a: `Yes. DEMO uses ${formatMoney(DEMO_STARTING_BALANCE)} of virtual funds on the same genuine ticks. Nothing you do in DEMO touches real money.`,
  },
  {
    q: 'Can I trade with real money?',
    a: 'You can deposit to your REAL wallet with M-Pesa and withdraw back to your M-Pesa number once you have completed at least one REAL trade. A withdrawal is only marked completed after the money has actually been sent.',
  },
  {
    q: 'Does copy trading guarantee profits?',
    a: 'No. They follow the limits you set and can lose money. We never publish win rates or returns we cannot verify.',
  },
]

function formatTickPrice(tick: Tick | undefined): string {
  if (!tick) return '—'
  return tick.price.toFixed(pipDecimals(tick.pipSize) ?? 2)
}

function shortName(market: Market): string {
  return market.displayName.replace('Volatility', 'Vol')
}

export function LandingPage() {
  const { markets, ticks, status, settled } = useLiveTicker(8, 120)
  const featured = markets[0]
  const featuredTicks = featured ? ticks[featured.symbol] : undefined

  return (
    <main>
      <Hero />
      <LiveTicker markets={markets.slice(0, 8)} ticks={ticks} status={status} settled={settled} />

      <MediaFeature
        id="experience"
        eyebrow="Real trading experience"
        title="Watch genuine ticks, not a simulation of them"
        image="trader-monitoring-laptops"
        alt="A trader at a desk watching live market charts on two laptops"
        layout="wide"
        body={
          <p>
            Every price, chart and digit on SmartBaseBinary comes from the public Deriv tick stream. DEMO and REAL use the
            same feed, so what you practise on is what the market is actually doing.
          </p>
        }
        points={[
          'Live prices with a visible connection state',
          'Up to 1,000 recent ticks loaded the moment you open a market',
          'Every result settles on the genuine exit tick',
        ]}
      />

      <TerminalPreview market={featured} ticks={featuredTicks} status={status} settled={settled} />

      <p className="border-y border-line bg-ink-2 px-4 py-4 text-center text-sm text-mist">
        The same digit contracts in DEMO and REAL. REAL execution stays switched off until a licensed provider is connected.
      </p>

      <section id="contracts" className="mx-auto max-w-6xl px-4 py-16 sm:py-20">
        <Eyebrow>Last-digit contracts</Eyebrow>
        <h2 className="mt-3 font-display text-3xl font-bold tracking-tight sm:text-[2.75rem] sm:leading-tight">
          Three ways to call the next digit
        </h2>
        <p className="mt-3 max-w-2xl text-mist">Every contract settles on the final digit of a genuine exit tick.</p>
        <div className="mt-8 grid gap-4 md:grid-cols-3">
          {contracts.map((item) => (
            <article key={item.no} className="rounded-2xl border border-line bg-surface-2 p-5 transition-colors hover:border-signal/50">
              <p className="font-mono text-sm font-bold text-signal">{item.no}</p>
              <h3 className="mt-2 font-display text-xl font-bold">{item.title}</h3>
              <p className="mt-2 text-sm text-mist">{item.body}</p>
              <DigitRow highlight={item.winners} className="mt-5" />
              <p className="mt-2 text-xs text-mist">{item.caption}</p>
            </article>
          ))}
        </div>
      </section>

      <HowItWorks />

      <MediaFeature
        id="analysis"
        eyebrow="Market analysis"
        title="Read the data before you place a stake"
        image="trader-multi-monitor-analysis"
        alt="A trader studying price charts across several monitors"
        reverse
        layout="tall"
        body={
          <p>
            Digit distribution, parity streaks and over/under ratios are calculated from the ticks on your screen. They
            describe what has happened; they do not predict the next digit, and we never present them as if they do.
          </p>
        }
        points={['Tick and 1m–1h candle charts', 'Last-digit frequency across recent ticks', 'Even/odd and over/under ratios']}
      />

      <section id="tools" className="border-y border-line bg-surface">
        <div className="mx-auto max-w-6xl px-4 py-16 sm:py-20">
          <div className="text-center">
            <Eyebrow>Platform</Eyebrow>
            <h2 className="mt-3 font-display text-3xl font-bold tracking-tight sm:text-[2.75rem] sm:leading-tight">
              Built for traders who read the data
            </h2>
          </div>
          <div className="mt-10 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {tools.map((tool) => (
              <article key={tool.title} className="rounded-2xl border border-line bg-surface-2 p-5 hover:border-line-strong">
                <span className="sbb-gradient inline-flex h-10 w-10 items-center justify-center rounded-xl text-white">
                  <Icon name={tool.icon} className="h-5 w-5" />
                </span>
                <h3 className="mt-4 font-display text-lg font-bold">{tool.title}</h3>
                <p className="mt-1.5 text-sm text-mist">{tool.body}</p>
              </article>
            ))}
          </div>
        </div>
      </section>

      <MediaFeature
        id="anywhere"
        eyebrow="Trade from anywhere"
        title="Desk, sofa or commute: the same workspace"
        image="trade-anywhere-phone-laptop"
        alt="A person checking a market chart on a phone next to a laptop"
        className="border-t-0"
        body={
          <p>
            The trading desk adapts to phones, tablets and laptops in the browser, with nothing to install. Your DEMO and
            REAL balances, open contracts and history follow your account, not your device.
          </p>
        }
        points={['Works in any modern mobile or desktop browser', 'Same ticket, charts and history on every screen']}
      />

      <MediaFeature
        id="environment"
        eyebrow="Professional trading environment"
        title="A focused desk built around risk control"
        image="trading-desk-environment"
        alt="A trader reviewing charts on a tablet in front of a multi-monitor desk"
        reverse
        layout="wide"
        className="bg-ink-2"
        body={
          <p>
            Stakes, durations and payouts are shown on the ticket before you confirm. DEMO and REAL are kept apart and
            clearly labelled. Digit contracts carry a real risk of loss, so start with virtual funds and set your own
            limits.
          </p>
        }
        points={['Clear DEMO / REAL separation', 'Payout shown before every confirmation', 'No guaranteed returns, ever']}
      >
        <Link to="/register" className={cn(primaryCta, 'mt-7')}>
          Create free account
        </Link>
      </MediaFeature>

      <FactsBand marketCount={markets.length} />

      <section className="sbb-accent-band">
        <div className="mx-auto flex max-w-6xl flex-col items-center gap-4 px-4 py-12 text-center text-white">
          <h2 className="font-display text-2xl font-bold tracking-tight sm:text-4xl">
            Practise with {formatMoney(DEMO_STARTING_BALANCE)} in DEMO funds
          </h2>
          <p className="max-w-2xl text-sm text-white/90 sm:text-base">
            Same genuine ticks, same contracts, virtual money. Learn how digit contracts behave before you ever think about risking your own.
          </p>
          <Link
            to="/register"
            className="inline-flex h-11 items-center rounded-full bg-white px-6 text-sm font-semibold text-signal-dim no-underline hover:bg-white/90"
          >
            Open a DEMO account
          </Link>
        </div>
      </section>

      <section id="start" className="mx-auto max-w-6xl px-4 py-16 sm:py-20">
        <div className="text-center">
          <Eyebrow>Get started</Eyebrow>
          <h2 className="mt-3 font-display text-3xl font-bold tracking-tight sm:text-[2.75rem] sm:leading-tight">
            From sign-up to first contract in three steps
          </h2>
        </div>
        <ol className="mt-10 grid gap-4 md:grid-cols-3">
          {startSteps.map((step, index) => (
            <li key={step.title} className="relative rounded-2xl border border-line bg-surface-2 p-6 text-center">
              <span className="sbb-gradient mx-auto flex h-11 w-11 items-center justify-center rounded-full font-display text-lg font-bold text-white">
                {index + 1}
              </span>
              <h3 className="mt-4 font-display text-lg font-bold">{step.title}</h3>
              <p className="mt-1.5 text-sm text-mist">{step.body}</p>
            </li>
          ))}
        </ol>
      </section>

      <section id="faq" className="border-t border-line">
        <div className="mx-auto max-w-3xl px-4 py-16 sm:py-20">
          <div className="text-center">
            <Eyebrow>FAQ</Eyebrow>
            <h2 className="mt-3 font-display text-3xl font-bold tracking-tight sm:text-[2.75rem] sm:leading-tight">
              Plain answers
            </h2>
          </div>
          <div className="mt-8 divide-y divide-line rounded-2xl border border-line bg-surface-2">
            {faqs.map((item) => (
              <details key={item.q} className="group px-5 py-4">
                <summary className="flex cursor-pointer list-none items-center justify-between gap-4 font-semibold text-paper [&::-webkit-details-marker]:hidden">
                  {item.q}
                  <Icon name="plus" className="h-4 w-4 text-mist transition-transform group-open:rotate-45" />
                </summary>
                <p className="mt-2 text-sm text-mist">{item.a}</p>
              </details>
            ))}
          </div>
        </div>
      </section>

      <section className="mx-auto max-w-6xl px-4 pb-16">
        <div className="sbb-cta-band relative overflow-hidden rounded-3xl px-6 py-14 text-center text-white sm:px-12">
          <div className="sbb-grid pointer-events-none absolute inset-0 opacity-60" />
          <div className="relative">
            <h2 className="font-display text-3xl font-bold tracking-tight sm:text-4xl">Ready to read the next digit?</h2>
            <p className="mx-auto mt-3 max-w-xl text-white/85">
              Create a free account, open the DEMO workspace and trade digit contracts on genuine market ticks.
            </p>
            <div className="mt-7 flex flex-wrap justify-center gap-3">
              <Link
                to="/register"
                className="inline-flex h-12 items-center rounded-xl bg-white px-7 text-sm font-semibold text-signal-dim no-underline hover:bg-white/90"
              >
                Create free account
              </Link>
              <Link
                to="/login"
                className="inline-flex h-12 items-center rounded-xl border border-white/40 px-7 text-sm font-semibold text-white no-underline hover:bg-white/10"
              >
                Log in
              </Link>
            </div>
          </div>
        </div>
      </section>

      <section id="risk" className="border-t border-line bg-ink-2">
        <div className="mx-auto max-w-6xl px-4 py-10">
          <h2 className="font-display text-lg font-bold">Risk disclosure</h2>
          <p className="mt-2 max-w-3xl text-sm leading-relaxed text-mist">{RISK_DISCLAIMER}</p>
          <Link to="/legal/risk" className="mt-3 inline-flex text-sm font-semibold text-amber hover:underline">
            Read the full risk notice
          </Link>
        </div>
      </section>

      <div className="fixed inset-x-0 bottom-0 z-30 border-t border-line bg-ink/95 p-3 pb-[max(0.75rem,env(safe-area-inset-bottom))] backdrop-blur-md md:hidden">
        <Link to="/register" className={cn(primaryCta, 'w-full')}>
          Create free account
        </Link>
      </div>
    </main>
  )
}

function Eyebrow({ children }: { children: ReactNode }) {
  return <p className="text-xs font-bold uppercase tracking-[0.18em] text-signal">{children}</p>
}

function Hero() {
  return (
    <section aria-label="Introduction" className="relative isolate flex min-h-[calc(100svh-4rem)] items-center overflow-hidden">
      <HeroVideo />
      <div className="relative mx-auto w-full max-w-4xl px-4 py-16 text-center [text-shadow:0_2px_18px_rgb(0_0_0_/_0.55)] sm:py-24">
        <span className="inline-flex items-center gap-2 rounded-full border border-signal/40 bg-ink-3/60 px-3.5 py-1.5 text-xs font-semibold text-signal-soft backdrop-blur-sm">
          <span className="h-1.5 w-1.5 rounded-full bg-sky" aria-hidden />
          Digit contracts on genuine Deriv ticks
        </span>
        <h1 className="mt-6 font-display text-[2.6rem] font-extrabold leading-[1.05] tracking-[-0.03em] text-paper sm:text-6xl lg:text-7xl">
          Read the last digit.
          <br />
          <span className="sbb-gradient-text [text-shadow:none]">Trade it with clarity.</span>
        </h1>
        <p className="mx-auto mt-5 max-w-2xl text-base text-paper/85 sm:text-lg">
          EVEN / ODD, MATCH / DIFFER and OVER / UNDER on one clean ticket, with live charts and digit analytics.
          Start in DEMO with virtual funds and stay in control of every stake.
        </p>
        <div className="mt-8 flex flex-col justify-center gap-3 sm:flex-row">
          <Link to="/register" className={primaryCta}>
            Create free account <span aria-hidden>→</span>
          </Link>
          <Link to="/login" className={outlineCta}>
            <svg viewBox="0 0 24 24" className="h-4 w-4" fill="currentColor" aria-hidden>
              <path d="M8 5.5v13a1 1 0 0 0 1.52.85l10.4-6.5a1 1 0 0 0 0-1.7L9.52 4.65A1 1 0 0 0 8 5.5z" />
            </svg>
            Try the DEMO
          </Link>
        </div>
        <ul className="mt-8 flex flex-wrap justify-center gap-2">
          {heroChips.map((chip) => (
            <li key={chip} className="rounded-full border border-white/15 bg-ink-3/55 px-3 py-1.5 text-xs font-medium text-paper/90 backdrop-blur-sm">
              {chip}
            </li>
          ))}
        </ul>
      </div>
    </section>
  )
}

function LiveTicker({
  markets,
  ticks,
  status,
  settled,
}: {
  markets: Market[]
  ticks: Record<string, Tick[]>
  status: ConnectionStatus
  settled: boolean
}) {
  const items = markets.filter((m) => (ticks[m.symbol]?.length ?? 0) > 0)
  return (
    <section id="markets" aria-label="Live market ticker" className="border-y border-line bg-ink-2/80">
      {items.length === 0 ? (
        <p className="px-4 py-3.5 text-center text-xs text-mist">
          {settled && markets.length === 0
            ? 'Live market data is unavailable right now. Prices are never shown unless they are genuine.'
            : status === 'error'
              ? 'Live market data is unavailable right now.'
              : 'Connecting to live Deriv market data…'}
        </p>
      ) : (
        <div className="sbb-fade-x overflow-hidden">
          <div className="sbb-marquee py-3">
            {[0, 1].map((copy) => (
              <ul key={copy} className="flex shrink-0" aria-hidden={copy === 1 || undefined}>
                {items.map((market) => {
                  const series = ticks[market.symbol]!
                  const last = series[series.length - 1]
                  const change = changePctOf(series)
                  const digit = last ? digitOfTick(last) : null
                  return (
                    <li key={market.symbol} className="flex items-center gap-2.5 border-r border-line px-5 text-sm">
                      <span className="sbb-gradient flex h-6 w-6 items-center justify-center rounded-md font-mono text-[10px] font-bold text-white">
                        {digit ?? '–'}
                      </span>
                      <span className="whitespace-nowrap font-semibold text-paper">{shortName(market)}</span>
                      <span className="font-mono text-mist">{formatTickPrice(last)}</span>
                      {change != null ? (
                        <span className={cn('font-mono text-xs font-semibold', change >= 0 ? 'text-call' : 'text-put')}>
                          {change >= 0 ? '+' : ''}
                          {change.toFixed(3)}%
                        </span>
                      ) : null}
                    </li>
                  )
                })}
              </ul>
            ))}
          </div>
        </div>
      )}
      {items.length > 0 ? (
        <p className="sr-only">
          Live prices from the Deriv public tick stream. Change is measured across the most recent ticks received.
        </p>
      ) : null}
    </section>
  )
}

function areaPaths(values: number[], width: number, height: number) {
  if (values.length < 2) return null
  const min = Math.min(...values)
  const max = Math.max(...values)
  const span = max - min || 1
  const step = width / (values.length - 1)
  const points = values.map((v, i) => [i * step, height - 8 - ((v - min) / span) * (height - 16)] as const)
  const line = points.map(([x, y], i) => `${i === 0 ? 'M' : 'L'}${x.toFixed(1)},${y.toFixed(1)}`).join(' ')
  return { line, area: `${line} L${width},${height} L0,${height} Z`, last: points[points.length - 1]! }
}

function TerminalPreview({
  market,
  ticks,
  status,
  settled,
}: {
  market: Market | undefined
  ticks: Tick[] | undefined
  status: ConnectionStatus
  settled: boolean
}) {
  const series = ticks ?? []
  const last = series[series.length - 1]
  const change = changePctOf(series)
  const digits = useMemo(
    () => series.map((t) => digitOfTick(t)).filter((d): d is number => d != null).slice(-20),
    [series],
  )
  const paths = useMemo(() => areaPaths(series.map((t) => t.price), 640, 240), [series])
  const isLive = status === 'live' && series.length > 0
  const up = (change ?? 0) >= 0

  return (
    <section className="relative px-4 py-14 sm:py-20">
      <div className="pointer-events-none absolute inset-x-0 top-0 mx-auto h-72 max-w-4xl rounded-full bg-sky/10 blur-3xl" />
      <div className="relative mx-auto max-w-5xl overflow-hidden rounded-2xl border border-line bg-surface shadow-[0_40px_80px_-30px_rgb(0_0_0_/_0.8)]">
        <div className="flex flex-wrap items-center justify-between gap-3 border-b border-line px-4 py-3 sm:px-5">
          <div className="flex items-center gap-3">
            <span className="sbb-gradient flex h-9 w-9 items-center justify-center rounded-lg text-white">
              <Icon name="trade" className="h-5 w-5" />
            </span>
            <div>
              <div className="flex items-center gap-2">
                <p className="font-display font-bold">{market?.displayName ?? 'Volatility index'}</p>
                <span
                  className={cn(
                    'inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[10px] font-bold uppercase',
                    isLive ? 'bg-call/15 text-call' : 'bg-warn/15 text-warn',
                  )}
                >
                  <span className={cn('h-1.5 w-1.5 rounded-full', isLive ? 'bg-call' : 'bg-warn')} aria-hidden />
                  {isLive ? 'Live' : settled && !market ? 'Unavailable' : 'Connecting'}
                </span>
              </div>
              <p className="font-mono text-[11px] text-mist">{market?.symbol ?? '—'} · Deriv public ticks</p>
            </div>
          </div>
          <div className="text-right">
            <p className={cn('font-mono text-2xl font-bold', last ? (up ? 'text-call' : 'text-put') : 'text-mist')}>
              {formatTickPrice(last)}
            </p>
            {change != null ? (
              <p className={cn('font-mono text-xs', up ? 'text-call' : 'text-put')}>
                {up ? '+' : ''}
                {change.toFixed(3)}% · last {series.length} ticks
              </p>
            ) : null}
          </div>
        </div>
        <div className="grid lg:grid-cols-[minmax(0,1fr)_17rem]">
          <div className="relative h-64 border-b border-line bg-ink-2 sm:h-72 lg:border-b-0 lg:border-r">
            <div className="sbb-grid absolute inset-0 opacity-70" />
            {paths ? (
              <svg viewBox="0 0 640 240" preserveAspectRatio="none" className="absolute inset-0 h-full w-full" role="img" aria-label="Recent genuine tick prices">
                <defs>
                  <linearGradient id="sbb-landing-area" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="0" stopColor={PALETTE.signal} stopOpacity="0.35" />
                    <stop offset="1" stopColor={PALETTE.sky} stopOpacity="0.02" />
                  </linearGradient>
                </defs>
                <path d={paths.area} fill="url(#sbb-landing-area)" />
                <path d={paths.line} fill="none" stroke={PALETTE.signal} strokeWidth="2" vectorEffect="non-scaling-stroke" />
              </svg>
            ) : (
              <p className="absolute inset-0 flex items-center justify-center px-6 text-center text-sm text-mist">
                {settled && !market
                  ? 'Live market data is unavailable right now. Nothing is drawn without genuine ticks.'
                  : 'Waiting for genuine ticks…'}
              </p>
            )}
          </div>
          <div className="flex flex-col gap-4 p-4 sm:p-5">
            <div>
              <p className="text-[11px] font-semibold uppercase tracking-wider text-mist">Recent last digits</p>
              {digits.length > 0 ? (
                <div className="mt-2 grid grid-cols-10 gap-1">
                  {digits.map((digit, index) => (
                    <span
                      key={`${index}-${digit}`}
                      className={cn(
                        'flex h-7 items-center justify-center rounded-md font-mono text-xs font-bold',
                        index === digits.length - 1 ? 'bg-signal-strong text-white' : 'bg-surface-3 text-paper',
                      )}
                    >
                      {digit}
                    </span>
                  ))}
                </div>
              ) : (
                <p className="mt-2 text-xs text-mist">Digits appear once live ticks arrive.</p>
              )}
            </div>
            <div className="grid grid-cols-3 gap-1.5 text-center text-[11px] font-bold">
              <span className="rounded-lg bg-call/15 py-2 text-call">EVEN / ODD</span>
              <span className="rounded-lg bg-signal/15 py-2 text-signal-soft">MATCH / DIFFER</span>
              <span className="rounded-lg bg-put/15 py-2 text-put-soft">OVER / UNDER</span>
            </div>
            <Link to="/login" className={cn(primaryCta, 'mt-auto h-11')}>
              Open the terminal
            </Link>
          </div>
        </div>
      </div>
    </section>
  )
}

function DigitRow({ highlight, className }: { highlight: number[]; className?: string }) {
  return (
    <div className={cn('grid grid-cols-10 gap-1', className)} aria-hidden>
      {Array.from({ length: 10 }, (_, digit) => (
        <span
          key={digit}
          className={cn(
            'flex h-7 items-center justify-center rounded-md font-mono text-xs font-bold',
            highlight.includes(digit) ? 'bg-signal-strong text-white' : 'bg-surface-3 text-mist',
          )}
        >
          {digit}
        </span>
      ))}
    </div>
  )
}

function HowItWorks() {
  const [active, setActive] = useState(0)
  return (
    <section id="how" className="sbb-accent-glow border-t border-line bg-ink-3">
      <div className="mx-auto grid max-w-6xl gap-10 px-4 py-16 sm:py-20 lg:grid-cols-2 lg:items-center">
        <div>
          <Eyebrow>How it works</Eyebrow>
          <h2 className="mt-3 font-display text-3xl font-bold tracking-tight sm:text-[2.75rem] sm:leading-tight">
            One ticket, four clear steps
          </h2>
          <ol className="mt-8 space-y-2.5">
            {tradeSteps.map((step, index) => (
              <li key={step.title}>
                <button
                  type="button"
                  onClick={() => setActive(index)}
                  aria-pressed={active === index}
                  className={cn(
                    'flex w-full items-start gap-4 rounded-2xl border px-4 py-3.5 text-left transition-colors',
                    active === index
                      ? 'border-signal/70 bg-surface-2 shadow-[0_10px_28px_rgb(59_130_246_/_0.12)]'
                      : 'border-line bg-surface hover:border-line-strong',
                  )}
                >
                  <span
                    className={cn(
                      'flex h-7 w-7 shrink-0 items-center justify-center rounded-full font-mono text-xs font-bold',
                      active === index ? 'bg-signal-strong text-white' : 'bg-surface-3 text-mist',
                    )}
                  >
                    {index + 1}
                  </span>
                  <span>
                    <span className="block font-semibold text-paper">{step.title}</span>
                    <span className="mt-0.5 block text-sm text-mist">{step.body}</span>
                  </span>
                </button>
              </li>
            ))}
          </ol>
          <Link to="/register" className={cn(primaryCta, 'mt-6')}>
            Create free account
          </Link>
        </div>
        <TicketMock step={active} />
      </div>
    </section>
  )
}

function TicketMock({ step }: { step: number }) {
  const rows: Array<[string, string]> = [
    ['Market', 'Volatility 100 Index'],
    ['Contract', 'EVEN'],
    ['Stake', 'Your amount'],
    ['Duration', '30 seconds'],
    ['Payout', 'Shown before you confirm'],
  ]
  const focus = [[0, 1], [2, 3], [4], []][step] ?? []
  return (
    <div className="mx-auto w-full max-w-md rounded-3xl border border-line bg-surface p-5 shadow-[0_30px_60px_-25px_rgb(0_0_0_/_0.8)]">
      <div className="flex items-center justify-between">
        <p className="text-xs font-semibold uppercase tracking-wider text-mist">Trade ticket · illustration</p>
        <span className="rounded-full bg-demo/15 px-2 py-0.5 text-[10px] font-bold uppercase text-demo">Demo</span>
      </div>
      <div className="mt-4 grid grid-cols-3 gap-1.5 text-center text-xs font-bold">
        {['Even / Odd', 'Match / Differ', 'Over / Under'].map((label, index) => (
          <span
            key={label}
            className={cn('rounded-full py-2', index === 0 ? 'bg-signal-strong text-white' : 'bg-surface-3 text-mist')}
          >
            {label}
          </span>
        ))}
      </div>
      <dl className="mt-4 divide-y divide-line rounded-2xl border border-line bg-ink-2">
        {rows.map(([label, value], index) => (
          <div
            key={label}
            className={cn(
              'flex items-center justify-between px-4 py-2.5 text-sm transition-colors',
              focus.includes(index) && 'bg-signal/10',
            )}
          >
            <dt className="text-mist">{label}</dt>
            <dd className={cn('font-semibold', focus.includes(index) ? 'text-signal' : 'text-paper')}>{value}</dd>
          </div>
        ))}
      </dl>
      <div
        className={cn(
          'mt-4 rounded-full py-3 text-center text-sm font-bold transition-colors',
          step === 3 ? 'bg-signal-strong text-white' : 'bg-surface-3 text-mist',
        )}
      >
        {step === 3 ? 'Place DEMO trade' : 'Review before confirming'}
      </div>
      <p className="mt-3 text-center text-[11px] text-mist">
        Settles on the first genuine tick at expiry. Example values only; no outcome is implied.
      </p>
    </div>
  )
}

function FactsBand({ marketCount }: { marketCount: number }) {
  const facts: Array<{ value: string; label: string }> = [
    { value: '3', label: 'Digit contract families' },
    { value: '10', label: 'Possible outcomes per tick (0–9)' },
    { value: '24/7', label: 'Synthetic indices stream' },
  ]
  if (marketCount > 0) facts.unshift({ value: String(marketCount), label: 'Markets available now' })
  return (
    <section aria-label="Platform facts" className="bg-[linear-gradient(135deg,rgb(59_130_246_/_0.08),rgb(0_212_170_/_0.05))]">
      <div className={cn('mx-auto grid max-w-6xl gap-6 px-4 py-12 text-center', facts.length === 4 ? 'grid-cols-2 md:grid-cols-4' : 'grid-cols-1 sm:grid-cols-3')}>
        {facts.map((fact) => (
          <div key={fact.label}>
            <p className="font-display text-4xl font-extrabold tracking-tight text-paper">{fact.value}</p>
            <p className="mt-1 text-sm text-mist">{fact.label}</p>
          </div>
        ))}
      </div>
    </section>
  )
}
