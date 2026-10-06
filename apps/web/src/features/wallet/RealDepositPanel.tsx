import { useEffect, useRef, useState, type FormEvent } from 'react'
import { Alert, Badge, Button, Card, Input } from '@/components/ui'
import { DEFAULT_MIN_KES, kesToUsd, normalizeKenyanPhone, validateAmountKes } from '@/domain/megapay'
import { cn } from '@/lib/cn'
import { formatMoney } from '@/lib/format'
import { notifyRealWalletChanged } from '@/lib/real-wallet-events'
import { authService } from '@/services/auth'
import { depositMethodLabel, depositService, type DepositConfig, type DepositState } from '@/services/deposits'

const QUICK_AMOUNTS = [1600, 2500, 5000, 10000]
const POLL_INTERVAL_MS = 3000
const POLL_TIMEOUT_MS = 2 * 60 * 1000

type Phase = 'form' | 'submitting' | 'waiting' | 'completed' | 'failed' | 'timeout'

function localPhone(msisdn: string | null): string {
  return msisdn ? `0${msisdn.slice(3)}` : ''
}

export function RealDepositPanel({ onClose, className }: { onClose: () => void; className?: string }) {
  const [config, setConfig] = useState<DepositConfig | null>(null)
  const [configError, setConfigError] = useState<string | null>(null)
  const [amount, setAmount] = useState(String(DEFAULT_MIN_KES))
  const [phone, setPhone] = useState('')
  const [phase, setPhase] = useState<Phase>('form')
  const [error, setError] = useState<string | null>(null)
  const [deposit, setDeposit] = useState<DepositState | null>(null)
  const pollTimer = useRef<number | null>(null)

  useEffect(() => {
    let cancelled = false
    void depositService.getConfig().then((result) => {
      if (cancelled) return
      if (result.ok) {
        setConfig(result.data)
        setAmount((current) => (Number(current) < result.data.minKes ? String(result.data.minKes) : current))
      } else setConfigError(result.error)
    })
    void authService.getProfileExtras().then((extras) => {
      if (!cancelled && extras.phone) setPhone((current) => current || localPhone(normalizeKenyanPhone(extras.phone ?? '')))
    })
    return () => {
      cancelled = true
    }
  }, [])

  useEffect(
    () => () => {
      if (pollTimer.current != null) window.clearTimeout(pollTimer.current)
    },
    [],
  )

  const amountKes = Number(amount)
  const usdPreview = config && Number.isInteger(amountKes) && amountKes > 0 ? kesToUsd(amountKes, config.kesPerUsd) : null

  function poll(provider: DepositConfig['provider'], depositId: string, startedAt: number) {
    pollTimer.current = window.setTimeout(async () => {
      const result = await depositService.checkStatus(provider, depositId)
      if (result.ok) {
        setDeposit(result.data)
        if (result.data.status === 'COMPLETED') {
          setPhase('completed')
          notifyRealWalletChanged()
          return
        }
        if (result.data.status === 'FAILED' || result.data.status === 'CANCELLED') {
          setPhase('failed')
          setError(
            result.data.status === 'CANCELLED'
              ? 'The M-Pesa request was cancelled.'
              : (result.data.failureReason ?? 'The M-Pesa payment did not go through.'),
          )
          notifyRealWalletChanged()
          return
        }
      }
      if (Date.now() - startedAt >= POLL_TIMEOUT_MS) {
        setPhase('timeout')
        notifyRealWalletChanged()
        return
      }
      poll(provider, depositId, startedAt)
    }, POLL_INTERVAL_MS)
  }

  async function submit(event: FormEvent) {
    event.preventDefault()
    if (!config) return
    const validAmount = validateAmountKes(amount, config)
    if (!validAmount.ok) {
      setError(validAmount.error)
      return
    }
    const msisdn = normalizeKenyanPhone(phone)
    if (!msisdn) {
      setError('Enter a valid Safaricom M-Pesa number, e.g. 0712345678.')
      return
    }
    setError(null)
    setPhase('submitting')
    const result = await depositService.startDeposit(config.provider, validAmount.amountKes, msisdn)
    if (!result.ok) {
      setPhase('form')
      setError(result.error)
      return
    }
    setDeposit(result.data)
    setPhase('waiting')
    notifyRealWalletChanged()
    poll(config.provider, result.data.depositId, Date.now())
  }

  function reset() {
    if (pollTimer.current != null) window.clearTimeout(pollTimer.current)
    setPhase('form')
    setError(null)
    setDeposit(null)
  }

  return (
    <Card className={cn('border-live/40', className ?? 'mt-4')}>
      <div className="flex items-center justify-between gap-2">
        <h2 className="font-display font-semibold">Deposit with M-Pesa</h2>
        <Badge tone="live">REAL</Badge>
      </div>
      {config?.enabled ? <p className="mt-1 text-xs text-mist">{depositMethodLabel(config)}</p> : null}

      {configError ? (
        <Alert tone="warn" className="mt-3">
          {configError}
        </Alert>
      ) : !config ? (
        <p className="mt-3 text-sm text-mist">Loading deposit options…</p>
      ) : !config.enabled ? (
        <Alert tone="warn" className="mt-3">
          {config.message ?? 'Deposits temporarily unavailable'}
        </Alert>
      ) : phase === 'form' || phase === 'submitting' ? (
        <form className="mt-3 grid gap-3" onSubmit={(e) => void submit(e)}>
          <Input
            label="Amount (KES)"
            type="number"
            inputMode="numeric"
            min={config.minKes}
            max={config.maxKes}
            step={1}
            value={amount}
            onChange={(e) => setAmount(e.target.value)}
            hint={`Min KES ${config.minKes.toLocaleString()} · Max KES ${config.maxKes.toLocaleString()}`}
          />
          <div className="flex flex-wrap gap-2">
            {QUICK_AMOUNTS.map((value) => (
              <Button
                key={value}
                type="button"
                size="sm"
                variant={amount === String(value) ? 'primary' : 'secondary'}
                onClick={() => setAmount(String(value))}
              >
                KES {value.toLocaleString()}
              </Button>
            ))}
          </div>
          <Input
            label="M-Pesa phone number"
            type="tel"
            inputMode="tel"
            autoComplete="tel"
            placeholder="0712345678"
            value={phone}
            onChange={(e) => setPhone(e.target.value)}
          />
          <p className="text-sm text-mist">
            You will receive <span className="font-semibold text-paper">{formatMoney(usdPreview)}</span> (rate:{' '}
            {config.kesPerUsd} KES = $1)
          </p>
          {error ? <Alert tone="danger">{error}</Alert> : null}
          <div className="flex flex-wrap gap-2">
            <Button type="submit" disabled={phase === 'submitting'}>
              {phase === 'submitting' ? 'Sending M-Pesa prompt…' : 'Deposit'}
            </Button>
            <Button type="button" variant="ghost" onClick={onClose}>
              Cancel
            </Button>
          </div>
        </form>
      ) : (
        <div className="mt-3 space-y-3">
          {phase === 'waiting' ? (
            <Alert tone="signal" title="Check your phone">
              Enter your M-Pesa PIN to pay KES {deposit?.amountKes.toLocaleString()}. Waiting for confirmation…
            </Alert>
          ) : null}
          {phase === 'completed' ? (
            <Alert tone="signal" title="Deposit received">
              {formatMoney(deposit?.amountUsd ?? null)} has been added to your REAL balance
              {deposit?.receipt ? ` (M-Pesa ${deposit.receipt})` : ''}.
            </Alert>
          ) : null}
          {phase === 'failed' ? (
            <Alert tone="danger" title="Deposit not completed">
              {error ?? 'The M-Pesa payment did not go through.'}
            </Alert>
          ) : null}
          {phase === 'timeout' ? (
            <Alert tone="warn" title="Still waiting for M-Pesa">
              We have not received a confirmation yet. If you completed the payment, your balance will update
              automatically once M-Pesa confirms it. Check the Deposits tab for the status.
            </Alert>
          ) : null}
          {deposit?.reference ? <p className="text-xs text-mist">Reference: {deposit.reference}</p> : null}
          {phase !== 'waiting' ? (
            <div className="flex flex-wrap gap-2">
              <Button type="button" onClick={reset}>
                New deposit
              </Button>
              <Button type="button" variant="ghost" onClick={onClose}>
                Close
              </Button>
            </div>
          ) : null}
        </div>
      )}
    </Card>
  )
}
