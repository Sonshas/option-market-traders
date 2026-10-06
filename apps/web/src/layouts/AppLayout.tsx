import { Outlet, matchPath, useLocation } from 'react-router-dom'
import { TRADE_ROUTE } from '@/lib/auth-redirect'
import { cn } from '@/lib/cn'
import { AppTopBar } from '@/layouts/AppTopBar'

export function AppLayout() {
  const location = useLocation()
  const isTrade = Boolean(matchPath({ path: TRADE_ROUTE, end: true }, location.pathname))

  return (
    <div className="flex min-h-svh flex-col bg-ink text-paper lg:h-svh lg:overflow-hidden">
      <AppTopBar />
      <main
        className={cn(
          'w-full min-w-0 flex-1',
          isTrade
            ? 'flex min-h-0 flex-col overflow-y-auto lg:overflow-hidden'
            : 'overflow-y-auto px-3 py-4 pb-8 sm:px-4 lg:pb-6',
        )}
      >
        <Outlet />
      </main>
    </div>
  )
}
