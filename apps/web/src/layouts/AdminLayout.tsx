import { NavLink, Outlet } from 'react-router-dom'
import { Logo } from '@/components/brand/Logo'
import { Badge } from '@/components/ui'
import { SystemIssuesBanner } from '@/features/admin/SystemIssuesBanner'
import { cn } from '@/lib/cn'
import { ADMIN_NAV } from '@/lib/constants'

export function AdminLayout() {
  return (
    <div className="min-h-svh bg-ink text-paper">
      <header className="sticky top-0 z-40 border-b border-line bg-ink/90 backdrop-blur-md">
        <div className="flex h-14 items-center gap-3 px-3 sm:px-4">
          <Logo compact to="/admin" />
          <span className="font-display text-sm font-semibold">Admin</span>
          <Badge tone="warn">Preview — not production</Badge>
          <NavLink to="/app/trade" className="ml-auto text-sm text-mist hover:text-paper">
            User app
          </NavLink>
          <NavLink to="/" className="text-sm text-mist hover:text-paper">
            Home
          </NavLink>
        </div>
      </header>
      <SystemIssuesBanner />
      <div className="flex min-h-[calc(100svh-56px)]">
        <nav className="hidden w-56 shrink-0 border-r border-line bg-ink-2 p-3 lg:block">
          <div className="flex flex-col gap-1">
            {ADMIN_NAV.map((item) => (
              <NavLink
                key={item.to}
                to={item.to}
                end={'end' in item ? item.end : false}
                className={({ isActive }) =>
                  cn(
                    'rounded-lg px-3 py-2 text-sm text-mist hover:bg-surface-2 hover:text-paper',
                    isActive && 'bg-surface-2 text-paper',
                  )
                }
              >
                {item.label}
              </NavLink>
            ))}
          </div>
        </nav>
        <div className="min-w-0 flex-1">
          <div className="flex gap-2 overflow-x-auto no-scrollbar border-b border-line px-3 py-2 lg:hidden">
            {ADMIN_NAV.map((item) => (
              <NavLink
                key={item.to}
                to={item.to}
                end={'end' in item ? item.end : false}
                className={({ isActive }) =>
                  cn(
                    'whitespace-nowrap rounded-full border border-line px-3 py-1 text-xs text-mist',
                    isActive && 'border-signal text-signal',
                  )
                }
              >
                {item.label}
              </NavLink>
            ))}
          </div>
          <div className="p-4 sm:p-6">
            <Outlet />
          </div>
        </div>
      </div>
    </div>
  )
}
