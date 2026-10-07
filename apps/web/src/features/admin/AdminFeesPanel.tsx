import { useEffect, useState, type FormEvent } from 'react'
import { Alert, Button, Card, Input } from '@/components/ui'
import type {
  DepositFeeSettings,
  PayoutDeskFeeSettings,
  TradingFeeSettings,
  WithdrawalFeeSettings,
} from '@/domain/payment-settings'
import { FALLBACK_PAYOUT_DESK } from '@/domain/payment-settings'
import { adminFeesService } from '@/services/admin-fees'

function numInput(value: string, fallback: number): number {
  const n = Number(value)
  return Number.isFinite(n) ? n : fallback
}

function Field({
  label,
  hint,
  value,
  onChange,
  step = '1',
}: {
  label: string
  hint?: string
  value: string
  onChange: (value: string) => void
  step?: string
}) {
  return <Input label={label} hint={hint} type="number" step={step} value={value} onChange={(e) => onChange(e.target.value)} />
}

export function AdminFeesPanel() {
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [message, setMessage] = useState<string | null>(null)
  const [payoutConfigured, setPayoutConfigured] = useState(false)
  const [payoutError, setPayoutError] = useState<string | null>(null)

  const [deposit, setDeposit] = useState<DepositFeeSettings>({
    kesPerUsd: 130,
    minKes: 1600,
    maxKes: 150_000,
    quickAmounts: '1600,2500,5000,10000',
  })
  const [withdrawal, setWithdrawal] = useState<WithdrawalFeeSettings>({
    kesPerUsd: 130,
    minKes: 1000,
    maxKes: 400_000,
    feeKes: 0,
  })
  const [trading, setTrading] = useState<TradingFeeSettings>({
    stakeMinUsd: 1,
    stakeMaxUsd: 500,
    maxOpenTrades: 5,
    dailyProfitLimitUsd: 1000,
  })
  const [payoutDesk, setPayoutDesk] = useState<PayoutDeskFeeSettings>(FALLBACK_PAYOUT_DESK)

  useEffect(() => {
    let cancelled = false
    void adminFeesService.load().then((result) => {
      if (cancelled) return
      setLoading(false)
      if (!result.ok) {
        setError(result.error)
        return
      }
      setDeposit(result.data.host.deposit)
      setWithdrawal(result.data.host.withdrawal)
      setTrading(result.data.host.trading)
      setPayoutConfigured(result.data.payoutDesk.configured)
      setPayoutError(result.data.payoutDesk.error)
      setPayoutDesk(result.data.payoutDesk.settings ?? FALLBACK_PAYOUT_DESK)
    })
    return () => {
      cancelled = true
    }
  }, [])

  async function onSave(event: FormEvent) {
    event.preventDefault()
    setSaving(true)
    setError(null)
    setMessage(null)
    const result = await adminFeesService.save({
      deposit: {
        ...deposit,
        kesPerUsd: numInput(String(deposit.kesPerUsd), deposit.kesPerUsd),
        minKes: Math.round(numInput(String(deposit.minKes), deposit.minKes)),
        maxKes: Math.round(numInput(String(deposit.maxKes), deposit.maxKes)),
      },
      withdrawal: {
        ...withdrawal,
        kesPerUsd: numInput(String(withdrawal.kesPerUsd), withdrawal.kesPerUsd),
        minKes: Math.round(numInput(String(withdrawal.minKes), withdrawal.minKes)),
        maxKes: Math.round(numInput(String(withdrawal.maxKes), withdrawal.maxKes)),
        feeKes: Math.round(numInput(String(withdrawal.feeKes), withdrawal.feeKes)),
      },
      trading: {
        stakeMinUsd: numInput(String(trading.stakeMinUsd), trading.stakeMinUsd),
        stakeMaxUsd: numInput(String(trading.stakeMaxUsd), trading.stakeMaxUsd),
        maxOpenTrades: Math.round(numInput(String(trading.maxOpenTrades), trading.maxOpenTrades)),
        dailyProfitLimitUsd: numInput(String(trading.dailyProfitLimitUsd), trading.dailyProfitLimitUsd),
      },
      payoutDesk: {
        ...payoutDesk,
        minWithdrawUsd: numInput(String(payoutDesk.minWithdrawUsd), payoutDesk.minWithdrawUsd),
        withdrawalFeePercent: numInput(String(payoutDesk.withdrawalFeePercent), payoutDesk.withdrawalFeePercent),
        kesPerUsdWithdrawal: numInput(String(payoutDesk.kesPerUsdWithdrawal), payoutDesk.kesPerUsdWithdrawal),
        kesPerUsdDeposit: numInput(String(payoutDesk.kesPerUsdDeposit), payoutDesk.kesPerUsdDeposit),
        mpesaCapKes: numInput(String(payoutDesk.mpesaCapKes), payoutDesk.mpesaCapKes),
        taxFeeUsd: numInput(String(payoutDesk.taxFeeUsd), payoutDesk.taxFeeUsd),
        botFeeUsd: numInput(String(payoutDesk.botFeeUsd), payoutDesk.botFeeUsd),
      },
    })
    setSaving(false)
    if (!result.ok) {
      setError(result.error)
      return
    }
    setDeposit(result.data.host.deposit)
    setWithdrawal(result.data.host.withdrawal)
    setTrading(result.data.host.trading)
    setPayoutConfigured(result.data.payoutDesk.configured)
    setPayoutError(result.data.payoutDesk.error)
    if (result.data.payoutDesk.settings) setPayoutDesk(result.data.payoutDesk.settings)
    setMessage(result.data.message)
  }

  if (loading) return <p className="text-sm text-mist">Loading fees…</p>

  return (
    <form className="space-y-4" onSubmit={onSave} data-testid="admin-fees-form">
      {error ? <Alert tone="danger">{error}</Alert> : null}
      {message ? <Alert tone="signal">{message}</Alert> : null}

      <Card className="space-y-3">
        <div>
          <p className="font-semibold text-paper">Account deposits (M-Pesa)</p>
          <p className="text-sm text-mist">Rate and limits used when a member tops up the REAL wallet.</p>
        </div>
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <Field label="KES per USD" value={String(deposit.kesPerUsd)} step="0.0001" onChange={(v) => setDeposit((d) => ({ ...d, kesPerUsd: numInput(v, d.kesPerUsd) }))} />
          <Field label="Min deposit (KES)" value={String(deposit.minKes)} onChange={(v) => setDeposit((d) => ({ ...d, minKes: numInput(v, d.minKes) }))} />
          <Field label="Max deposit (KES)" value={String(deposit.maxKes)} onChange={(v) => setDeposit((d) => ({ ...d, maxKes: numInput(v, d.maxKes) }))} />
          <Input
            label="Quick amounts (KES)"
            hint="Comma-separated, e.g. 1600,2500,5000"
            value={deposit.quickAmounts}
            onChange={(e) => setDeposit((d) => ({ ...d, quickAmounts: e.target.value }))}
          />
        </div>
      </Card>

      <Card className="space-y-3">
        <div>
          <p className="font-semibold text-paper">Legacy REAL withdrawals</p>
          <p className="text-sm text-mist">Hold → pay → receipt flow under Admin → Withdrawals → Legacy REAL.</p>
        </div>
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <Field label="KES per USD" value={String(withdrawal.kesPerUsd)} step="0.0001" onChange={(v) => setWithdrawal((w) => ({ ...w, kesPerUsd: numInput(v, w.kesPerUsd) }))} />
          <Field label="Min withdrawal (KES)" value={String(withdrawal.minKes)} onChange={(v) => setWithdrawal((w) => ({ ...w, minKes: numInput(v, w.minKes) }))} />
          <Field label="Max withdrawal (KES)" value={String(withdrawal.maxKes)} hint="Hard-capped at 400,000" onChange={(v) => setWithdrawal((w) => ({ ...w, maxKes: numInput(v, w.maxKes) }))} />
          <Field label="Fee (KES)" value={String(withdrawal.feeKes)} hint="Taken from the payout before send" onChange={(v) => setWithdrawal((w) => ({ ...w, feeKes: numInput(v, w.feeKes) }))} />
        </div>
      </Card>

      <Card className="space-y-3">
        <div>
          <p className="font-semibold text-paper">Payout desk</p>
          <p className="text-sm text-mist">Withdrawals carry no fees. Set the payout rate, minimum and M-Pesa cap.</p>
        </div>
        {!payoutConfigured ? (
          <Alert tone="warn">The payout desk is not available right now, so desk fees cannot be saved.</Alert>
        ) : null}
        {payoutError ? <Alert tone="warn">{payoutError}</Alert> : null}
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <Field label="Payout KES/USD" value={String(payoutDesk.kesPerUsdWithdrawal)} step="0.0001" onChange={(v) => setPayoutDesk((p) => ({ ...p, kesPerUsdWithdrawal: numInput(v, p.kesPerUsdWithdrawal) }))} />
          <Field label="Min withdraw (USD)" value={String(payoutDesk.minWithdrawUsd)} step="0.01" onChange={(v) => setPayoutDesk((p) => ({ ...p, minWithdrawUsd: numInput(v, p.minWithdrawUsd) }))} />
          <Field label="M-Pesa cap (KES)" value={String(payoutDesk.mpesaCapKes)} onChange={(v) => setPayoutDesk((p) => ({ ...p, mpesaCapKes: numInput(v, p.mpesaCapKes) }))} />
          <label className="flex items-center gap-2 rounded-xl border border-line bg-ink-2 px-3 text-sm text-paper">
            <input
              type="checkbox"
              checked={payoutDesk.previewStkConfirm}
              onChange={(e) => setPayoutDesk((p) => ({ ...p, previewStkConfirm: e.target.checked }))}
            />
            Preview STK confirm (dev only — turn off for live money)
          </label>
        </div>
      </Card>

      <Card className="space-y-3">
        <div>
          <p className="font-semibold text-paper">REAL trading limits</p>
          <p className="text-sm text-mist">Stake bounds, open-trade cap, and daily net profit pause.</p>
        </div>
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <Field label="Min stake (USD)" value={String(trading.stakeMinUsd)} step="0.01" onChange={(v) => setTrading((t) => ({ ...t, stakeMinUsd: numInput(v, t.stakeMinUsd) }))} />
          <Field label="Max stake (USD)" value={String(trading.stakeMaxUsd)} step="0.01" onChange={(v) => setTrading((t) => ({ ...t, stakeMaxUsd: numInput(v, t.stakeMaxUsd) }))} />
          <Field label="Max open trades" value={String(trading.maxOpenTrades)} onChange={(v) => setTrading((t) => ({ ...t, maxOpenTrades: numInput(v, t.maxOpenTrades) }))} />
          <Field label="Daily profit limit (USD)" value={String(trading.dailyProfitLimitUsd)} step="0.01" onChange={(v) => setTrading((t) => ({ ...t, dailyProfitLimitUsd: numInput(v, t.dailyProfitLimitUsd) }))} />
        </div>
      </Card>

      <div className="flex flex-wrap items-center gap-3">
        <Button type="submit" disabled={saving} data-testid="admin-fees-save">
          {saving ? 'Saving…' : 'Save all fees'}
        </Button>
        <p className="text-xs text-mist">Changes apply to new deposits, withdrawals, fee STKs, and trades. Pending rows keep their original amounts.</p>
      </div>
    </form>
  )
}
