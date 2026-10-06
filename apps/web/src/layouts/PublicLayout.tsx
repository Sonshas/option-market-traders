import type { ReactNode } from 'react'
import { Link, NavLink, Outlet, useLocation } from 'react-router-dom'
import { Logo } from '@/components/brand/Logo'
import { cn } from '@/lib/cn'

const nav = [
  { to: '/#contracts', label: 'Contracts' },
  { to: '/#how', label: 'How it works' },
  { to: '/#tools', label: 'Tools' },
  { to: '/#faq', label: 'FAQ' },
]

export function PublicLayout() {
  const { pathname } = useLocation()
  const hasStickyCta = pathname === '/'
  return (
    <div className="min-h-svh text-paper sbb-glow">
      <header className="sticky top-0 z-40 border-b border-white/[0.07] bg-ink-2/85 backdrop-blur-md">
        <div className="mx-auto flex h-16 max-w-6xl items-center justify-between gap-4 px-4">
          <Logo />
          <nav className="hidden items-center gap-7 text-sm font-medium text-mist md:flex" aria-label="Primary">
            {nav.map((item) => (
              <a key={item.to} href={item.to} className="no-underline hover:text-paper">
                {item.label}
              </a>
            ))}
          </nav>
          <div className="flex items-center gap-2">
            <Link to="/login" className="hidden px-2 text-sm font-semibold text-paper/90 no-underline hover:text-paper sm:inline">
              Log in
            </Link>
            <Link
              to="/register"
              className="inline-flex h-10 items-center rounded-xl bg-signal-strong px-4 text-sm font-semibold text-white no-underline shadow-[0_10px_20px_-8px_rgb(59_130_246_/_0.6)] hover:bg-signal-hover"
            >
              Get started
            </Link>
          </div>
        </div>
      </header>
      <Outlet />
      <footer className={cn('border-t border-line bg-ink-3', hasStickyCta && 'pb-20 md:pb-0')}>
        <div className="mx-auto grid max-w-6xl gap-8 px-4 py-12 sm:grid-cols-2 lg:grid-cols-5">
          <div className="lg:col-span-2">
            <Logo />
            <p className="mt-3 max-w-sm text-sm text-mist">
              Digit contracts on genuine Deriv ticks, with clearly separated DEMO and REAL workspaces. REAL execution
              stays disabled until a licensed provider is connected.
            </p>
          </div>
          <FooterColumn title="Trade">
            <a href="/#contracts" className="text-mist no-underline hover:text-paper">
              Contracts
            </a>
            <NavLink to="/login" className={footerLink}>
              DEMO trading
            </NavLink>
          </FooterColumn>
          <FooterColumn title="Company">
            <NavLink to="/about" className={footerLink}>
              About
            </NavLink>
            <NavLink to="/contact" className={footerLink}>
              Contact
            </NavLink>
            <NavLink to="/app/support" className={footerLink}>
              Support
            </NavLink>
          </FooterColumn>
          <FooterColumn title="Legal">
            <NavLink to="/legal/terms" className={footerLink}>
              Terms
            </NavLink>
            <NavLink to="/legal/privacy" className={footerLink}>
              Privacy
            </NavLink>
            <NavLink to="/legal/risk" className={footerLink}>
              Risk notice
            </NavLink>
            <NavLink to="/admin" className={footerLink}>
              Admin preview
            </NavLink>
          </FooterColumn>
        </div>
        <div className="border-t border-line">
          <p className="mx-auto max-w-6xl px-4 py-5 text-xs text-mist">
            © {new Date().getFullYear()} SmartBaseBinary · optionmarkettraders.com. Trading involves risk of loss. No
            guaranteed profits.
          </p>
        </div>
      </footer>
    </div>
  )
}

function FooterColumn({ title, children }: { title: string; children: ReactNode }) {
  return (
    <div>
      <p className="text-xs font-bold uppercase tracking-[0.14em] text-paper">{title}</p>
      <div className="mt-3 flex flex-col gap-2 text-sm">{children}</div>
    </div>
  )
}

function footerLink({ isActive }: { isActive: boolean }) {
  return cn('text-mist no-underline hover:text-paper', isActive && 'text-signal')
}
