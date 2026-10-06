import { Badge, Card, DataTable, EmptyState, PageHeader } from '@/components/ui'
import { useAccountMode } from '@/hooks/useAccountMode'
import { useWalletHistory } from '@/hooks/useWallet'
import { accountModeLabel } from '@/domain/account'
import { formatMoney } from '@/lib/format'

export function TransactionsPage() {
  const { kind } = useAccountMode()
  const { transactions, deposits, withdrawals } = useWalletHistory(kind)
  const isDemo = kind === 'demo'

  const rows = transactions.map((item) => [
    `${isDemo ? 'DEMO ' : ''}${item.type}`,
    formatMoney(item.amount),
    item.status,
    item.note ?? item.reference ?? '—',
    isDemo ? item.createdAt.slice(11, 19) : new Date(item.createdAt).toLocaleString(),
  ])

  const depositRows = deposits.map((item) => [
    item.provider === 'megapay' || item.provider === 'daraja' ? 'M-Pesa' : item.method,
    item.amountKes != null ? `${formatMoney(item.amount)} · KES ${item.amountKes.toLocaleString()}` : formatMoney(item.amount),
    item.status,
    item.reference ?? item.id.slice(0, 12),
    new Date(item.createdAt).toLocaleString(),
  ])

  return (
    <div>
      <PageHeader
        title={isDemo ? 'DEMO Transactions' : 'Transactions'}
        subtitle={isDemo ? 'DEMO deposits, withdrawals, stakes, and payouts.' : undefined}
        actions={<Badge tone={isDemo ? 'demo' : 'live'}>{accountModeLabel(kind)}</Badge>}
      />
      <div className="grid gap-3 lg:grid-cols-3">
        <Card>
          <h2 className="font-display font-semibold">{isDemo ? 'DEMO Deposits' : 'Deposits'}</h2>
          <p className="mt-2 font-mono text-2xl">{deposits.length}</p>
        </Card>
        <Card>
          <h2 className="font-display font-semibold">{isDemo ? 'DEMO Withdrawals' : 'Withdrawals'}</h2>
          <p className="mt-2 font-mono text-2xl">{withdrawals.length}</p>
        </Card>
        <Card>
          <h2 className="font-display font-semibold">{isDemo ? 'DEMO Ledger' : 'Ledger'}</h2>
          <p className="mt-2 font-mono text-2xl">{transactions.length}</p>
        </Card>
      </div>
      <Card className="mt-4">
        <DataTable
          columns={['Type', 'Amount', 'Status', 'Note', 'Time']}
          rows={rows}
          empty={
            <EmptyState
              title={isDemo ? 'No DEMO transactions yet' : 'No transactions yet'}
              body={isDemo ? 'Place DEMO trades or use DEMO deposit/withdrawal to populate this ledger.' : undefined}
            />
          }
        />
      </Card>
      {!isDemo ? (
        <Card className="mt-4">
          <h2 className="mb-3 font-display font-semibold">Deposits</h2>
          <DataTable
            columns={['Method', 'Amount', 'Status', 'Reference', 'Time']}
            rows={depositRows}
            empty={<EmptyState title="No deposits yet" />}
          />
        </Card>
      ) : null}
    </div>
  )
}
