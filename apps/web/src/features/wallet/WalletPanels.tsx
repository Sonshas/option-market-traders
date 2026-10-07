import { useEffect, useState, type FormEvent } from 'react'
import { Link, useSearchParams } from 'react-router-dom'
import { ConfirmDialog } from '@/components/ConfirmDialog'
import { Badge, Button, Card, DataTable, EmptyState, Input, PageHeader, Select, Skeleton, Stat, Tabs } from '@/components/ui'
import { useAccountMode } from '@/hooks/useAccountMode'
import { useAuthSession } from '@/hooks/useAuth'
import { usePracticeBook } from '@/hooks/usePracticeBook'
import { useWallet, useWalletHistory, useWallets } from '@/hooks/useWallet'
import { REAL_BALANCE_PLACEHOLDER, accountModeLabel, realWithdrawalsEnabled } from '@/domain/account'
import { localPhoneDisplay, withdrawalStatusLabel } from '@/domain/withdrawals'
import { formatMoney } from '@/lib/format'
import { REAL_INTEGRATION } from '@/providers/config'
import { paymentProvider } from '@/services/payment'
import { AccountHistoryCharts } from '@/features/wallet/AccountHistoryCharts'
import { PayoutWithdrawPanel } from '@/features/payout-desk/PayoutWithdrawPanel'

export function WalletPanels() {
  const { kind } = useAccountMode()
  const { isSignedIn } = useAuthSession()
  const { wallet, loading, balanceDisplay } = useWallet(kind)
  const { demoWallet, loading: walletsLoading, realBalanceDisplay } = useWallets()
  const { transactions, deposits, withdrawals, loading: historyLoading } = useWalletHistory(kind)
  const [tab, setTab] = useState('overview')
  const [amount, setAmount] = useState('25')
  const [method, setMethod] = useState('bank')
  const [dialog, setDialog] = useState<'deposit' | 'withdraw' | null>(null)
  const [busy, setBusy] = useState(false)
  const [result, setResult] = useState<string | null>(null)
  const [formError, setFormError] = useState<string | undefined>()
  const isDemo = kind === 'demo'
  const { isPractice } = usePracticeBook()
  const realWithdrawalsOn = realWithdrawalsEnabled(REAL_INTEGRATION)
  const [params, setParams] = useSearchParams()
  const action = params.get('action')

  useEffect(() => {
    if (action !== 'deposit' && action !== 'withdraw') return
    if (isPractice && action === 'withdraw') {
      openRealWithdraw()
    } else if (isPractice) {
      setResult(null)
      setFormError(undefined)
      setDialog('deposit')
    }
    const copy = new URLSearchParams(params)
    copy.delete('action')
    setParams(copy, { replace: true })
    // eslint-disable-next-line react-hooks/exhaustive-deps -- runs once per ?action= link
  }, [action])

  useEffect(() => {
    if (!isPractice) setDialog(null)
  }, [isPractice])

  /** DEMO funds cannot be withdrawn; Withdraw pays out a remaining REAL balance. */
  function openRealWithdraw() {
    setResult(null)
    setFormError(undefined)
    setDialog(realWithdrawalsOn && isSignedIn ? 'withdraw' : null)
  }

  async function submit() {
    const value = Number(amount)
    if (!Number.isFinite(value) || value <= 0) {
      setFormError('Enter an amount greater than zero.')
      return
    }
    setFormError(undefined)
    setBusy(true)
    const next = await paymentProvider.requestDeposit({ amount: value, method, kind })
    setResult(next.message)
    setBusy(false)
  }

  const depositRows = deposits.map((item) =>
    isDemo
      ? [`DEMO ${item.method}`, formatMoney(item.amount), item.status, item.id.slice(0, 12), item.createdAt.slice(11, 19)]
      : [
          item.provider === 'megapay' || item.provider === 'daraja' ? 'M-Pesa' : item.method,
          item.amountKes != null
            ? `${formatMoney(item.amount)} · KES ${item.amountKes.toLocaleString()}`
            : formatMoney(item.amount),
          item.status,
          item.reference ?? item.id.slice(0, 12),
          new Date(item.createdAt).toLocaleString(),
        ],
  )
  const withdrawalRows = withdrawals.map((item) =>
    isDemo
      ? [`DEMO ${item.destination}`, formatMoney(item.amount), item.status, item.id.slice(0, 12), item.createdAt.slice(11, 19)]
      : [
          `M-Pesa ${localPhoneDisplay(item.msisdn ?? null) || item.destination}`,
          item.netKes != null
            ? `${formatMoney(item.amount)} · KES ${item.netKes.toLocaleString()}${item.feeKes ? ` (fee KES ${item.feeKes.toLocaleString()})` : ''}`
            : formatMoney(item.amount),
          <WithdrawalStatusBadge key={item.id} status={item.status} receipt={item.receipt} failureReason={item.failureReason} />,
          item.reference ?? item.id.slice(0, 12),
          new Date(item.createdAt).toLocaleString(),
        ],
  )
  const ledgerRows = transactions.map((item) => [
    `${isDemo ? 'DEMO ' : ''}${item.type}`,
    formatMoney(item.amount),
    item.status,
    item.note ?? item.reference ?? '—',
    item.createdAt.slice(11, 19),
  ])

  return (
    <div>
      <PageHeader
        title={isPractice ? 'Practice Wallet' : isDemo ? 'DEMO Wallet' : 'REAL Wallet'}
        subtitle={
          isPractice
            ? 'Practice only — separate virtual balance, no real money.'
            : isDemo
              ? 'Virtual practice funds — not real money.'
              : undefined
        }
        actions={<Badge tone={isDemo ? 'demo' : 'live'}>{accountModeLabel(kind)}</Badge>}
      />

      {!isDemo && !isSignedIn ? (
        <Card className="mt-4 border-live/40 bg-live/5">
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

      <div className="mt-4 grid gap-3 sm:grid-cols-3">
        {loading || walletsLoading ? (
          <>
            <Skeleton className="h-24" />
            <Skeleton className="h-24" />
            <Skeleton className="h-24" />
          </>
        ) : (
          <>
            {isPractice ? (
              <Stat
                label="Practice Available"
                value={formatMoney(wallet?.availableBalance ?? null)}
                hint="Practice only · virtual funds"
                tone="demo"
              />
            ) : (
              <>
                <Stat
                  label={isDemo ? 'DEMO Available' : 'Available'}
                  value={isDemo ? formatMoney(wallet?.availableBalance ?? null) : balanceDisplay}
                  hint={isDemo ? 'Virtual funds' : undefined}
                  tone={isDemo ? 'demo' : 'live'}
                />
                <Stat
                  label="Demo Balance"
                  value={formatMoney(demoWallet?.availableBalance ?? null)}
                  hint="DEMO ACCOUNT"
                  tone="demo"
                />
              </>
            )}
            <Stat
              label="Remaining Real Balance"
              value={realBalanceDisplay ?? REAL_BALANCE_PLACEHOLDER}
              hint="Withdraw only · REAL trading has ended"
              tone="live"
            />
          </>
        )}
      </div>
      <div className="mt-4">
        <AccountHistoryCharts kind={kind} />
      </div>
      {isPractice ? (
        <div className="mt-4 flex flex-wrap gap-2">
          <Button
            data-testid="wallet-topup"
            onClick={() => {
              setResult(null)
              setFormError(undefined)
              setDialog('deposit')
            }}
          >
            Practice Top up
          </Button>
          <Button
            variant="secondary"
            disabled={!(realWithdrawalsOn && isSignedIn)}
            data-testid="wallet-withdraw"
            title="Withdraw your remaining REAL balance to M-Pesa"
            onClick={openRealWithdraw}
          >
            Withdraw REAL balance
            {realWithdrawalsOn ? <span className="text-[10px] font-medium opacity-80">· M-Pesa</span> : null}
          </Button>
        </div>
      ) : null}
      {isPractice && dialog === 'withdraw' ? <PayoutWithdrawPanel onClose={() => setDialog(null)} /> : null}
      <div className="mt-6">
        <Tabs
          value={tab}
          onChange={setTab}
          items={[
            { id: 'overview', label: 'Overview' },
            { id: 'deposits', label: isDemo ? 'DEMO Deposits' : 'Deposits' },
            { id: 'withdrawals', label: isDemo ? 'DEMO Withdrawals' : 'Withdrawals' },
            { id: 'ledger', label: isDemo ? 'DEMO History' : 'History' },
          ]}
        />
        <Card className="mt-3">
          {historyLoading && transactions.length === 0 && isDemo === false ? (
            <Skeleton className="h-32" />
          ) : (
            <>
              <div hidden={tab !== 'deposits'}>
                <DataTable
                  columns={['Method', 'Amount', 'Status', isDemo ? 'Id' : 'Reference', 'Time']}
                  rows={depositRows}
                  empty={
                    <EmptyState
                      title={isDemo ? 'No DEMO deposits' : 'No deposits yet'}
                      body={isDemo ? 'DEMO deposits credit virtual practice funds only.' : undefined}
                    />
                  }
                />
              </div>
              <div hidden={tab !== 'withdrawals'}>
                <DataTable
                  columns={isDemo ? ['Destination', 'Amount', 'Status', 'Id', 'Time'] : ['Destination', 'Amount', 'Status', 'Reference', 'Time']}
                  rows={withdrawalRows}
                  empty={
                    <EmptyState
                      title={isDemo ? 'No DEMO withdrawals' : 'No withdrawals yet'}
                      body={isDemo ? 'DEMO withdrawals never send real money.' : undefined}
                    />
                  }
                />
              </div>
              <div hidden={tab !== 'ledger'}>
                <DataTable
                  columns={['Type', 'Amount', 'Status', 'Note', 'Time']}
                  rows={ledgerRows}
                  empty={
                    <EmptyState
                      title={isDemo ? 'No DEMO wallet history' : 'No transactions yet'}
                      body={isDemo ? 'DEMO entries appear after deposits, withdrawals, and trades.' : undefined}
                    />
                  }
                />
              </div>
              <div hidden={tab !== 'overview'} className="grid gap-3 sm:grid-cols-2">
                <Card>
                  <p className="text-xs uppercase text-mist">{isDemo ? 'DEMO deposit methods' : 'Deposit methods'}</p>
                  <p className="mt-2 text-sm text-mist">
                    {isDemo
                      ? 'Bank transfer, mobile money, and crypto forms credit DEMO virtual funds only.'
                      : 'Real deposits are closed.'}
                  </p>
                </Card>
                <Card>
                  <p className="text-xs uppercase text-mist">Labels</p>
                  <div className="mt-2 flex flex-wrap gap-2">
                    <Badge tone="demo">DEMO</Badge>
                    <Badge tone="warn">PENDING</Badge>
                    <Badge tone="signal">PROCESSING</Badge>
                    <Badge tone="call">COMPLETED</Badge>
                    <Badge tone="danger">FAILED</Badge>
                  </div>
                </Card>
              </div>
            </>
          )}
        </Card>
      </div>

      <ConfirmDialog
        open={dialog === 'deposit' && isPractice}
        title="Practice Top up"
        body={`Add ${formatMoney(Number(amount) || null)} of virtual funds to your Practice balance. Not real money.`}
        confirmLabel="Confirm Practice top up"
        loading={busy}
        resultMessage={result}
        onClose={() => setDialog(null)}
        onConfirm={() => void submit()}
      />

      {dialog === 'deposit' && isPractice ? (
        <Card className="mt-4">
          <form
            className="grid gap-3 sm:grid-cols-2"
            onSubmit={(event: FormEvent) => {
              event.preventDefault()
              void submit()
            }}
          >
            <Input
              label="Amount (USD)"
              type="number"
              min={1}
              value={amount}
              onChange={(e) => setAmount(e.target.value)}
              error={formError}
            />
            <Select label="Method" value={method} onChange={(e) => setMethod(e.target.value)}>
              <option value="bank">Bank transfer (DEMO)</option>
              <option value="mobile">Mobile money (DEMO)</option>
              <option value="crypto">Crypto (DEMO)</option>
            </Select>
          </form>
        </Card>
      ) : null}
    </div>
  )
}

function WithdrawalStatusBadge({
  status,
  receipt,
  failureReason,
}: {
  status: string
  receipt?: string | null
  failureReason?: string | null
}) {
  const tone = status === 'COMPLETED' ? 'call' : status === 'FAILED' ? 'danger' : status === 'CANCELLED' ? 'mist' : 'warn'
  const detail = status === 'COMPLETED' && receipt ? `Receipt ${receipt}` : status === 'FAILED' ? `${failureReason ?? 'Not sent'} · refunded` : withdrawalStatusLabel(status)
  return (
    <span className="inline-flex flex-col gap-0.5" title={detail}>
      <Badge tone={tone}>{status}</Badge>
      <span className="text-[10px] text-mist">{detail}</span>
    </span>
  )
}
