import { useEffect, useState } from 'react'
import { AdminTablePage } from '@/features/admin/AdminTables'
import { RealAdminDashboard } from '@/features/admin/RealAdminDashboard'
import { RealWithdrawalsAdmin } from '@/features/admin/RealWithdrawalsAdmin'
import { Alert, Badge, Button, Card, PageHeader, Stat } from '@/components/ui'
import { resetDemoState } from '@/lib/demo-store'
import { clearDemoSession } from '@/lib/demo-session'
import { adminService } from '@/services/admin'
import type { AuditLogEntry, Bot, CopyTrader, SystemSetting } from '@/types'

export function AdminDashboardPage() {
  return <RealAdminDashboard />
}

export function AdminOverviewPage() {
  return (
    <div>
      <PageHeader title="Admin overview" subtitle="Staff console preview. Production users, balances, and payments are not loaded." />
      <Alert tone="warn">Not connected to any remote database. No production rows are displayed.</Alert>
      <div className="mt-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <Stat label="Users" value="—" hint="Not loaded" />
        <Stat label="Deposits" value="—" hint="Not loaded" />
        <Stat label="Withdrawals" value="—" hint="Not loaded" />
        <Stat label="Trades" value="—" hint="Not loaded" />
      </div>
    </div>
  )
}

export function AdminUsersPage() {
  return <AdminTablePage title="Users" subtitle="Application users. Primary identity is users, not profiles." />
}

export function AdminAccountsPage() {
  return <AdminTablePage title="Accounts" subtitle="Demo and real wallets. Balances are not fetched from production." />
}

export function AdminDepositsPage() {
  const [rows, setRows] = useState<import('@/types').Deposit[]>([])
  const [message, setMessage] = useState('')
  const [loading, setLoading] = useState(true)
  const [tab, setTab] = useState<'demo' | 'real'>('demo')

  useEffect(() => {
    void adminService.listDeposits().then((result) => {
      setRows(result.data)
      setMessage(result.message)
      setLoading(false)
    })
  }, [])

  return (
    <AdminTablePage title="Deposits" subtitle="DEMO deposits from local storage. REAL stays empty — never fabricated." loading={loading} message={message}>
      <div className="mb-3 flex gap-2">
        <Button type="button" variant={tab === 'demo' ? 'primary' : 'secondary'} onClick={() => setTab('demo')}>
          DEMO
        </Button>
        <Button type="button" variant={tab === 'real' ? 'primary' : 'secondary'} onClick={() => setTab('real')}>
          REAL
        </Button>
      </div>
      {tab === 'real' ? (
        <EmptyReal label="REAL deposits" />
      ) : rows.length === 0 ? (
        <p className="text-sm text-mist">No LOCAL DEMO deposits yet.</p>
      ) : (
        <ul className="space-y-2">
          {rows.map((row) => (
            <li key={row.id} className="rounded-xl border border-line px-3 py-2 text-sm">
              {row.amount} {row.currency} · {row.status} · DEMO · isSimulated={String(row.isSimulated)}
            </li>
          ))}
        </ul>
      )}
    </AdminTablePage>
  )
}

export function AdminWithdrawalsPage() {
  const [rows, setRows] = useState<import('@/types').Withdrawal[]>([])
  const [message, setMessage] = useState('')
  const [loading, setLoading] = useState(true)
  const [tab, setTab] = useState<'demo' | 'real'>('real')

  useEffect(() => {
    void adminService.listWithdrawals().then((result) => {
      setRows(result.data)
      setMessage(result.message)
      setLoading(false)
    })
  }, [])

  return (
    <AdminTablePage
      title="Withdrawals"
      subtitle="REAL: M-Pesa payouts to approve and record (hold → pay → enter receipt). DEMO: simulated rows from local storage."
      loading={loading}
      message={
        tab === 'real'
          ? 'REAL withdrawals are live for staff accounts. A request only becomes COMPLETED when you record the M-Pesa receipt of the payment you made (or when M-Pesa B2C confirms it). Fail + refund returns the held amount to the user.'
          : message
      }
    >
      <div className="mb-3 flex gap-2">
        <Button type="button" variant={tab === 'real' ? 'primary' : 'secondary'} onClick={() => setTab('real')} data-testid="admin-withdrawals-real">
          REAL
        </Button>
        <Button type="button" variant={tab === 'demo' ? 'primary' : 'secondary'} onClick={() => setTab('demo')}>
          DEMO
        </Button>
      </div>
      {tab === 'real' ? (
        <RealWithdrawalsAdmin />
      ) : rows.length === 0 ? (
        <p className="text-sm text-mist">No LOCAL DEMO withdrawals yet.</p>
      ) : (
        <ul className="space-y-2">
          {rows.map((row) => (
            <li key={row.id} className="rounded-xl border border-line px-3 py-2 text-sm">
              {row.amount} {row.currency} · {row.status} · DEMO · isSimulated={String(row.isSimulated)}
            </li>
          ))}
        </ul>
      )}
    </AdminTablePage>
  )
}

export function AdminTradesPage() {
  const [rows, setRows] = useState<import('@/types').Trade[]>([])
  const [message, setMessage] = useState('')
  const [loading, setLoading] = useState(true)
  const [tab, setTab] = useState<'demo' | 'real'>('demo')

  useEffect(() => {
    void adminService.listTrades().then((result) => {
      setRows(result.data)
      setMessage(result.message)
      setLoading(false)
    })
  }, [])

  return (
    <AdminTablePage title="Trades" subtitle="Inspect LOCAL DEMO trades. REAL tab stays empty." loading={loading} message={message}>
      <div className="mb-3 flex gap-2">
        <Button type="button" variant={tab === 'demo' ? 'primary' : 'secondary'} onClick={() => setTab('demo')}>
          DEMO
        </Button>
        <Button type="button" variant={tab === 'real' ? 'primary' : 'secondary'} onClick={() => setTab('real')}>
          REAL
        </Button>
      </div>
      {tab === 'real' ? (
        <EmptyReal label="REAL trades" />
      ) : rows.length === 0 ? (
        <p className="text-sm text-mist">No LOCAL DEMO trades yet.</p>
      ) : (
        <ul className="space-y-2">
          {rows.slice(0, 40).map((row) => (
            <li key={row.id} className="rounded-xl border border-line px-3 py-2 text-sm">
              {row.market} · {row.contractType} / {row.contractOption} · {row.status} · stake {row.stake} · DEMO
            </li>
          ))}
        </ul>
      )}
    </AdminTablePage>
  )
}

function EmptyReal({ label }: { label: string }) {
  return (
    <p className="text-sm text-live">
      {label}: NOT CONNECTED. Completed REAL deposits/withdrawals/trades are never fabricated from DEMO data.
    </p>
  )
}

export function AdminLedgerPage() {
  return (
    <AdminTablePage
      title="Ledger"
      subtitle="DEMO wallet ledger is inspectable via Transactions. REAL ledger is not connected and never fabricated."
    />
  )
}

export function AdminSupportPage() {
  return <AdminTablePage title="Support tickets" subtitle="Conversations are not loaded from production." />
}

export function AdminNotificationsPage() {
  return <AdminTablePage title="Notifications" subtitle="Broadcast UI only. No notification table is invented or written remotely." />
}

export function AdminBotsPage() {
  const [bots, setBots] = useState<Bot[]>([])
  const [message, setMessage] = useState('')
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    void adminService.listBots().then((result) => {
      setBots(result.data)
      setMessage(result.message)
      setLoading(false)
    })
  }, [])

  return (
    <AdminTablePage title="Bots" subtitle="Local strategy catalog. Historical performance remains N/A." loading={loading} message={message}>
      <div className="grid gap-3 md:grid-cols-2">
        {bots.map((bot) => (
          <Card key={bot.id}>
            <div className="flex justify-between gap-2">
              <p className="font-semibold">{bot.name}</p>
              <Badge tone="mist">{bot.riskLevel}</Badge>
            </div>
            <p className="mt-2 text-sm text-mist">{bot.description}</p>
            <p className="mt-2 text-xs text-mist">Historical: {bot.historicalPerformance}</p>
          </Card>
        ))}
      </div>
    </AdminTablePage>
  )
}

export function AdminCopyTradersPage() {
  const [traders, setTraders] = useState<CopyTrader[]>([])
  const [message, setMessage] = useState('')
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    void adminService.listCopyTraders().then((result) => {
      setTraders(result.data)
      setMessage(result.message)
      setLoading(false)
    })
  }, [])

  return (
    <AdminTablePage title="Copy traders" subtitle="DEMO / placeholder records only." loading={loading} message={message}>
      <ul className="space-y-2">
        {traders.map((trader) => (
          <li key={trader.id} className="flex items-center justify-between rounded-xl border border-line px-3 py-2">
            <span>
              {trader.displayName} <span className="text-mist">{trader.handle}</span>
            </span>
            <Badge tone="demo">DEMO</Badge>
          </li>
        ))}
      </ul>
    </AdminTablePage>
  )
}

export function AdminSettingsPage() {
  const [settings, setSettings] = useState<SystemSetting[]>([])
  const [message, setMessage] = useState('')
  const [loading, setLoading] = useState(true)
  const [resetMessage, setResetMessage] = useState<string | null>(null)

  useEffect(() => {
    void adminService.listSettings().then((result) => {
      setSettings(result.data)
      setMessage(result.message)
      setLoading(false)
    })
  }, [])

  function resetDemo() {
    resetDemoState()
    clearDemoSession()
    setResetMessage('DEMO data reset. Balance returned to starting DEMO funds. Session cleared. REAL account was never modified.')
  }

  return (
    <AdminTablePage title="System settings" subtitle="Flags as UI labels only — values are not read from production." loading={loading} message={message}>
      <Card className="mb-4 border-demo/40 bg-demo/5">
        <p className="font-semibold text-demo">Development · Reset DEMO data</p>
        <p className="mt-2 text-sm text-mist">
          Clears local DEMO wallet, trades, transactions, bots, copy relationships, notifications, and the DEMO session.
          Does not touch any remote database or REAL account.
        </p>
        <Button className="mt-3" variant="secondary" onClick={resetDemo}>
          Reset DEMO data
        </Button>
        {resetMessage ? <Alert className="mt-3" tone="signal">{resetMessage}</Alert> : null}
      </Card>
      <div className="space-y-3">
        {settings.map((setting) => (
          <div key={setting.key} className="rounded-xl border border-line px-3 py-3">
            <p className="font-semibold">{setting.label}</p>
            <p className="font-mono text-sm text-amber">{setting.value}</p>
            <p className="text-xs text-mist">{setting.note}</p>
          </div>
        ))}
      </div>
    </AdminTablePage>
  )
}

export function AdminAuditPage() {
  const [rows, setRows] = useState<AuditLogEntry[]>([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    void adminService.listAuditLogs().then((result) => {
      setRows(result.data)
      setLoading(false)
    })
  }, [])

  return (
    <AdminTablePage
      title="Audit logs"
      subtitle="Empty until a backend audit stream is connected. No fabricated staff actions."
      loading={loading}
    >
      {rows.length === 0 ? <p className="text-sm text-mist">No audit rows.</p> : null}
      <ul className="space-y-2">
        {rows.map((row) => (
          <li key={row.id} className="rounded-xl border border-line px-3 py-2 text-sm">
            {row.actorEmail} · {row.action} · {row.targetType}/{row.targetId}
          </li>
        ))}
      </ul>
    </AdminTablePage>
  )
}
