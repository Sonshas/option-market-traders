import { useEffect, useMemo, useState, type FormEvent } from 'react'
import { Alert, Badge, Button, Card, Input } from '@/components/ui'
import { normalizeKenyanPhone } from '@/domain/megapay'
import {
  NO_REAL_TRADE_MESSAGE,
  isOpenWithdrawalStatus,
  localPhoneDisplay,
  minUsdFor,
  quoteWithdrawal,
  validateWithdrawalAmountUsd,
  withdrawalStatusCopy,
  withdrawalStatusLabel,
  type WithdrawalStatus,
} from '@/domain/withdrawals'
import { useAuthSession } from '@/hooks/useAuth'
import { useWallet } from '@/hooks/useWallet'
import { cn } from '@/lib/cn'
import { formatMoney } from '@/lib/format'
import { authService } from '@/services/auth'
import { withdrawalService, type WithdrawConfig, type WithdrawalState } from '@/services/withdrawals'

type Phase = 'form' | 'submitting' | 'status'

const STATUS_TONE: Record<WithdrawalStatus, 'live' | 'signal' | 'danger' | 'mist'> = {
  PENDING: 'signal',
  PROCESSING: 'signal',
  COMPLETED: 'live',
  FAILED: 'danger',
  CANCELLED: 'mist',
}

function alertTone(status: WithdrawalStatus): 'signal' | 'danger' | 'mist' {
  if (status === 'FAILED') return 'danger'
  if (status === 'CANCELLED') return 'mist'
  return 'signal'
}

function kes(value: number): string {
  return `KES ${Math.round(value).toLocaleString('en-US')}`
}

function formatWhen(iso: string | null | undefined): string {
  if (!iso) return '—'
  const date = new Date(iso)
  return Number.isNaN(date.getTime()) ? '—' : date.toLocaleString('en-KE', { dateStyle: 'medium', timeStyle: 'short' })
}

/**
 * REAL M-Pesa withdrawal. The server holds the amount when the request is created and the status only becomes
 * COMPLETED after the payout is confirmed (M-Pesa B2C result or an admin recording the M-Pesa receipt).
 */
export function RealWithdrawPanel({ onClose, className }: { onClose: () => void; className?: string }) {
  const { user } = useAuthSession()
  const { wallet, loading: walletLoading } = useWallet('real')
  const [config, setConfig] = useState<WithdrawConfig | null>(null)
  const [configError, setConfigError] = useState<string | null>(null)
  const [amount, setAmount] = useState('')
  const [phone, setPhone] = useState('')
  const [phase, setPhase] = useState<Phase>('form')
  const [error, setError] = useState<string | null>(null)
  const [withdrawal, setWithdrawal] = useState<WithdrawalState | null>(null)

  useEffect(() => {
    let cancelled = false
    void withdrawalService.getConfig().then((result) => {
      if (cancelled) return
      if (result.ok) setConfig(result.data)
      else setConfigError(result.error)
    })
    void authService.getProfileExtras().then((extras) => {
      if (!cancelled && extras.phone) setPhone((current) => current || localPhoneDisplay(normalizeKenyanPhone(extras.phone ?? '')))
    })
    return () => {
      cancelled = true
    }
  }, [])

  // Live status: realtime + 5 s poll while the request is open.
  const openId = withdrawal && isOpenWithdrawalStatus(withdrawal.status) ? withdrawal.withdrawalId : null
  useEffect(() => {
    if (!openId || !user?.id) return
    const refresh = () => {
      void withdrawalService.getMine(openId).then((result) => {
        if (result.ok) setWithdrawal(result.data)
      })
    }
    return withdrawalService.subscribe(user.id, refresh, { channel: `withdraw-panel:${openId}` })
  }, [openId, user?.id])

  const available = wallet?.availableBalance ?? null
  const hasRealBalance = available != null && available > 0
  const configReady = Boolean(config && !walletLoading)

  const validation = useMemo(
    () => (config && amount.trim() ? validateWithdrawalAmountUsd(amount, config, available) : null),
    [config, amount, available],
  )
  const preview = useMemo(() => {
    if (!config) return null
    if (validation?.ok) return validation.quote
    const n = Number(amount)
    return Number.isFinite(n) && n > 0 ? quoteWithdrawal(Math.round(n * 100) / 100, config) : null
  }, [config, amount, validation])

  async function submit(event: FormEvent) {
    event.preventDefault()
    if (!config) return
    const check = validateWithdrawalAmountUsd(amount, config, available)
    if (!check.ok) {
      setError(check.error)
      return
    }
    const msisdn = normalizeKenyanPhone(phone)
    if (!msisdn) {
      setError('Enter a valid Safaricom M-Pesa number, e.g. 0712345678.')
      return
    }
    setError(null)
    setPhase('submitting')
    const result = await withdrawalService.request(check.amountUsd, msisdn)
    if (!result.ok) {
      setPhase('form')
      setError(result.error)
      return
    }
    setWithdrawal(result.data)
    setPhase('status')
  }

  function reset() {
    setPhase('form')
    setError(null)
    setWithdrawal(null)
    setAmount('')
  }

  function withdrawAll() {
    if (available != null && available > 0) setAmount((Math.floor(available * 100) / 100).toFixed(2))
  }

  return (
    <Card className={cn('border-live/40', className ?? 'mt-4')} data-testid="real-withdraw-panel">
      <div className="flex items-center justify-between gap-2">
        <h2 className="font-display font-semibold">Withdraw to M-Pesa</h2>
        <Badge tone="live">REAL</Badge>
      </div>
      {config?.enabled ? <p className="mt-1 text-xs text-mist">{config.processingCopy}</p> : null}

      {configError ? (
        <Alert tone="warn" className="mt-3">
          {configError}
        </Alert>
      ) : !configReady ? (
        <p className="mt-3 text-sm text-mist">Loading withdrawal options…</p>
      ) : !config!.enabled ? (
        <Alert tone="warn" className="mt-3">
          {config!.message ?? 'Withdrawals temporarily unavailable'}
        </Alert>
      ) : !config!.hasRealTrade ? (
        <div className="mt-3 space-y-3" data-testid="withdraw-needs-trade">
          <Alert tone="mist">{config!.eligibilityMessage ?? NO_REAL_TRADE_MESSAGE}</Alert>
          <Button type="button" variant="ghost" onClick={onClose}>
            Close
          </Button>
        </div>
      ) : phase === 'form' || phase === 'submitting' ? (
        <form className="mt-3 grid gap-3" onSubmit={(e) => void submit(e)} data-testid="real-withdraw-form">
          <div className="flex items-center justify-between rounded-lg border border-line bg-ink px-3 py-2 text-sm">
            <span className="text-mist">Available REAL balance</span>
            <span className="font-mono font-semibold text-live" data-testid="withdraw-available">
              {formatMoney(available)}
            </span>
          </div>
          {!hasRealBalance ? (
            <div data-testid="withdraw-no-balance">
              <Alert tone="mist">No REAL balance to withdraw.</Alert>
            </div>
          ) : null}
          <fieldset disabled={!hasRealBalance || phase === 'submitting'} className="grid gap-3 disabled:opacity-60">
            <Input
              label="Amount (USD)"
              type="number"
              inputMode="decimal"
              min={minUsdFor(config!)}
              step={0.01}
              placeholder={minUsdFor(config!).toFixed(2)}
              value={amount}
              onChange={(e) => setAmount(e.target.value)}
              hint={`Minimum ${kes(config!.minKes)} (${formatMoney(minUsdFor(config!))}) · Maximum ${kes(config!.maxKes)} (${formatMoney(config!.maxKes / config!.kesPerUsd)}) per request · rate ${config!.kesPerUsd} KES = $1 · up to your available REAL balance`}
              data-testid="withdraw-amount"
            />
            <div className="flex flex-wrap gap-2">
              <Button type="button" size="sm" variant="secondary" onClick={withdrawAll}>
                Withdraw all
              </Button>
            </div>
            <Input
              label="M-Pesa phone number"
              type="tel"
              inputMode="tel"
              autoComplete="tel"
              placeholder="0712345678"
              value={phone}
              onChange={(e) => setPhone(e.target.value)}
              hint="Money is sent to this Safaricom number."
              data-testid="withdraw-phone"
            />
            <div className="rounded-lg border border-line bg-ink px-3 py-2 text-sm" data-testid="withdraw-quote">
              <div className="flex justify-between">
                <span className="text-mist">Amount</span>
                <span className="font-mono">{preview ? kes(preview.amountKes) : '—'}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-mist">Fee</span>
                <span className="font-mono">{kes(config!.feeKes)}</span>
              </div>
              <div className="mt-1 flex justify-between border-t border-line pt-1 font-semibold">
                <span>You receive</span>
                <span className="font-mono text-live">{preview ? kes(preview.netKes) : '—'}</span>
              </div>
            </div>
            {error ? <Alert tone="danger">{error}</Alert> : null}
            <div className="flex flex-wrap gap-2">
              <Button type="submit" disabled={!hasRealBalance || phase === 'submitting'} data-testid="withdraw-submit">
                {phase === 'submitting' ? 'Submitting request…' : 'Request withdrawal'}
              </Button>
              <Button type="button" variant="ghost" onClick={onClose}>
                Cancel
              </Button>
            </div>
          </fieldset>
        </form>
      ) : withdrawal ? (
        <div className="mt-3 space-y-3" data-testid="real-withdraw-status" data-status={withdrawal.status}>
          <Alert tone={alertTone(withdrawal.status)} title={withdrawalStatusLabel(withdrawal.status)}>
            {withdrawalStatusCopy({
              status: withdrawal.status,
              netKes: withdrawal.netKes,
              msisdn: withdrawal.msisdn,
              receipt: withdrawal.receipt,
              failureReason: withdrawal.failureReason,
            })}
          </Alert>
          <dl className="grid grid-cols-2 gap-x-3 gap-y-1 text-sm">
            <dt className="text-mist">Reference</dt>
            <dd className="text-right font-mono">{withdrawal.reference ?? '—'}</dd>
            <dt className="text-mist">Amount</dt>
            <dd className="text-right font-mono">
              {formatMoney(withdrawal.amountUsd)} · {kes(withdrawal.amountKes)}
            </dd>
            <dt className="text-mist">Fee</dt>
            <dd className="text-right font-mono">{kes(withdrawal.feeKes)}</dd>
            <dt className="text-mist">You receive</dt>
            <dd className="text-right font-mono text-live">{kes(withdrawal.netKes)}</dd>
            <dt className="text-mist">M-Pesa number</dt>
            <dd className="text-right font-mono">{localPhoneDisplay(withdrawal.msisdn) || '—'}</dd>
            <dt className="text-mist">Status</dt>
            <dd className="text-right">
              <Badge tone={STATUS_TONE[withdrawal.status] ?? 'mist'}>{withdrawal.status}</Badge>
            </dd>
            <dt className="text-mist">Requested</dt>
            <dd className="text-right">{formatWhen(withdrawal.createdAt)}</dd>
            {withdrawal.completedAt ? (
              <>
                <dt className="text-mist">Completed</dt>
                <dd className="text-right">{formatWhen(withdrawal.completedAt)}</dd>
              </>
            ) : null}
            {withdrawal.receipt ? (
              <>
                <dt className="text-mist">M-Pesa receipt</dt>
                <dd className="text-right font-mono">{withdrawal.receipt}</dd>
              </>
            ) : null}
          </dl>
          {isOpenWithdrawalStatus(withdrawal.status) ? (
            <p className="text-xs text-mist">This page updates automatically. {config!.processingCopy}</p>
          ) : null}
          <div className="flex flex-wrap gap-2">
            {!isOpenWithdrawalStatus(withdrawal.status) ? (
              <Button type="button" onClick={reset}>
                New withdrawal
              </Button>
            ) : null}
            <Button type="button" variant="ghost" onClick={onClose}>
              Close
            </Button>
          </div>
        </div>
      ) : null}
    </Card>
  )
}
