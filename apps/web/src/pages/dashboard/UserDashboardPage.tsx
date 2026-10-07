import { Link } from 'react-router-dom'
import { Badge, Button, Card, EmptyState, PageHeader, Stat } from '@/components/ui'
import { AccountHistoryCharts } from '@/features/wallet/AccountHistoryCharts'
import { useAccountMode } from '@/hooks/useAccountMode'
import { useAuthSession } from '@/hooks/useAuth'
import { usePracticeBook } from '@/hooks/usePracticeBook'
import { useWallet, useWalletHistory } from '@/hooks/useWallet'
import { useTrades } from '@/hooks/useTrades'
import { REAL_BALANCE_PLACEHOLDER, accountModeLabel } from '@/domain/account'
import { formatMoney } from '@/lib/format'
const links = [
  { to: '/app/trade', label: 'Trade' },
  { to: '/app/wallet', label: 'Wallet' },
  { to: '/app/history', label: 'Trade history' },
  { to: '/app/transactions', label: 'Transactions' },
  { to: '/app/notifications', label: 'Notifications' },
  { to: '/app/support', label: 'Support' },
  { to: '/app/profile', label: 'Profile' },
  { to: '/app/security', label: 'Security' },
]

export function UserDashboardPage() {
  const { kind } = useAccountMode()
  const { isSignedIn } = useAuthSession()
  const { wallet, balanceDisplay } = useWallet(kind)
  const { open, history } = useTrades(kind)
  const { transactions } = useWalletHistory(kind)
  const isDemo = kind === 'demo'
  const { isPractice } = usePracticeBook()

  return (
    <div>
      <PageHeader
        title={isPractice ? 'Practice Overview' : isDemo ? 'DEMO Overview' : 'REAL Overview'}
        subtitle={isPractice ? 'Practice only: separate virtual balance, no real money.' : isDemo ? 'Practice with virtual funds.' : undefined}
        actions={<Badge tone={isDemo ? 'demo' : 'live'}>{accountModeLabel(kind)}</Badge>}
      />
      {!isDemo && !isSignedIn ? (
        <Card className="mb-4 border-live/40 bg-live/5">
          <p className="text-sm text-mist">Sign in to load your REAL wallet.</p>
          <div className="mt-3 flex flex-wrap gap-2">
            <Link to="/login">
              <Button type="button">Log in</Button>
            </Link>
            <Link to="/register">
              <Button type="button" variant="secondary">
                Create Account
              </Button>
            </Link>
          </div>
        </Card>
      ) : null}
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <Stat
          label={isPractice ? 'Practice Balance' : isDemo ? 'Demo Balance' : 'Real Balance'}
          value={isDemo ? formatMoney(wallet?.availableBalance ?? null) : balanceDisplay || REAL_BALANCE_PLACEHOLDER}
          hint={isPractice ? 'Practice only · virtual funds' : isDemo ? 'Virtual funds' : undefined}
          tone={isDemo ? 'demo' : 'live'}
        />
        <Stat label={isDemo ? 'DEMO Open' : 'Open positions'} value={String(open.length)} />
        <Stat label={isDemo ? 'DEMO History' : 'Trade history'} value={String(history.length)} />
        <Stat label="Account mode" value={accountModeLabel(kind)} hint={wallet?.currency ?? 'USD'} />
      </div>
      <div className="mt-6 grid gap-3 md:grid-cols-2 lg:grid-cols-4">
        {links.map((item) => (
          <Link key={item.to} to={item.to} className="no-underline">
            <Card className="h-full hover:border-line-strong">
              <p className="font-semibold text-paper">{item.label}</p>
              <p className="mt-1 text-sm text-mist">Open {item.label.toLowerCase()}</p>
            </Card>
          </Link>
        ))}
      </div>
      <div className="mt-6 grid gap-3 lg:grid-cols-2">
        <Card>
          <h2 className="font-display font-semibold">{isDemo ? 'DEMO Open positions' : 'Open positions'}</h2>
          {open.length === 0 ? (
            <EmptyState
              title={isDemo ? 'None open' : 'No open positions'}
              body={isDemo ? 'Place a DEMO trade to see open positions here.' : undefined}
            />
          ) : (
            <ul className="mt-3 space-y-2 text-sm">
              {open.slice(0, 5).map((trade) => (
                <li key={trade.id} className="flex justify-between border-b border-line/50 py-2 font-mono text-xs">
                  <span>
                    {trade.market || trade.symbol} {trade.contractOption.toUpperCase()}
                  </span>
                  <span>{formatMoney(trade.stake)}</span>
                </li>
              ))}
            </ul>
          )}
        </Card>
        <Card>
          <h2 className="font-display font-semibold">Recent activity</h2>
          {transactions.length === 0 ? (
            <EmptyState
              title={isDemo ? 'No DEMO activity yet' : 'No activity yet'}
              body={isDemo ? 'DEMO trades, deposits, and withdrawals appear here as they happen.' : undefined}
            />
          ) : (
            <ul className="mt-3 space-y-1 text-sm">
              {transactions.slice(0, 6).map((tx) => (
                <li key={tx.id} className="flex items-center justify-between gap-2 border-b border-line/50 py-2 text-xs">
                  <span className="min-w-0 truncate">
                    <span className="font-semibold uppercase">{tx.type.replace('_', ' ')}</span>
                    <span className="ml-2 text-mist">{new Date(tx.createdAt).toLocaleString()}</span>
                  </span>
                  <span className={`font-mono ${tx.amount >= 0 ? 'text-call' : 'text-put'}`}>
                    {formatMoney(tx.amount)}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </Card>
      </div>
      <div className="mt-6">
        <AccountHistoryCharts kind={kind} compact />
      </div>
    </div>
  )
}
