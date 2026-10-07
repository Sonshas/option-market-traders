import { useMemo, useState } from 'react'
import { cn } from '@/lib/cn'
import { displayPhone, withdrawalQuote } from '../domain/rates'
import type { DeskState, Withdrawal } from '../domain/types'
import { kes, usd, when } from '../format'
import { btn } from './chrome'

export function MemberDesk({
  desk,
  busy,
  onWithdraw,
}: {
  desk: DeskState
  busy: boolean
  onWithdraw: (amount: string, phone: string) => void
}) {
  return (
    <div className="grid gap-4">
      <div className="flex items-center justify-between rounded-2xl border border-line bg-ink-2 px-4 py-3">
        <div>
          <p className="text-[11px] font-semibold uppercase tracking-wider text-mist">Available balance</p>
          <p className="font-mono text-xl font-semibold text-live" data-testid="payout-balance">
            {usd(desk.balanceUsd)}
          </p>
        </div>
        {desk.email ? <p className="max-w-[45%] truncate text-right text-xs text-mist">{desk.email}</p> : null}
      </div>

      <RequestForm desk={desk} busy={busy} onWithdraw={onWithdraw} />

      {desk.withdrawals.length ? <History rows={desk.withdrawals} /> : null}
    </div>
  )
}

function RequestForm({
  desk,
  busy,
  onWithdraw,
}: {
  desk: DeskState
  busy: boolean
  onWithdraw: (amount: string, phone: string) => void
}) {
  const [amount, setAmount] = useState('')
  const [phone, setPhone] = useState(desk.phone)
  const quote = useMemo(() => {
    const value = Number(amount)
    if (!Number.isFinite(value) || amount.trim() === '') return null
    return withdrawalQuote(value, desk.rates)
  }, [amount, desk.rates])
  const value = Number(amount)
  const belowMin = quote !== null && value < desk.rates.minWithdrawUsd
  const overBalance = quote !== null && value > desk.balanceUsd
  const overCap = quote !== null && quote.kesPayout > desk.rates.mpesaCapKes
  const phoneDigits = phone.replace(/\D/g, '').replace(/^254/, '').replace(/^0/, '')
  const phoneOk = phoneDigits.length === 9
  const canSubmit = quote !== null && !belowMin && !overBalance && !overCap && phoneOk && !busy

  const problem = belowMin
    ? `Minimum withdrawal is ${usd(desk.rates.minWithdrawUsd)}.`
    : overBalance
      ? 'Amount is more than your available balance.'
      : overCap
        ? `One M-Pesa payout cannot exceed KES ${desk.rates.mpesaCapKes.toLocaleString('en-KE')}.`
        : null

  return (
    <form
      className="grid gap-4"
      data-testid="payout-request-form"
      onSubmit={(event) => {
        event.preventDefault()
        if (canSubmit) onWithdraw(amount, phone)
      }}
    >
      <div>
        <div className="flex items-baseline justify-between">
          <label className="text-sm font-medium" htmlFor="payout-amount">
            Amount
          </label>
          <button
            type="button"
            className="text-xs font-semibold text-signal-soft hover:text-paper"
            onClick={() => setAmount(String(Math.floor(desk.balanceUsd * 100) / 100))}
          >
            Max
          </button>
        </div>
        <div className="mt-1.5 flex items-center overflow-hidden rounded-xl border border-line-strong bg-ink-2 focus-within:border-signal">
          <span className="pl-3 font-mono text-lg text-mist">$</span>
          <input
            id="payout-amount"
            className="w-full bg-transparent px-2 py-3 font-mono text-lg text-paper outline-none"
            inputMode="decimal"
            autoComplete="off"
            placeholder={desk.rates.minWithdrawUsd.toFixed(2)}
            value={amount}
            onChange={(event) => setAmount(event.target.value)}
          />
        </div>
      </div>

      <div>
        <label className="text-sm font-medium" htmlFor="payout-phone">
          M-Pesa number
        </label>
        <div className="mt-1.5 flex overflow-hidden rounded-xl border border-line-strong bg-ink-2 focus-within:border-signal">
          <span className="grid place-items-center border-r border-line px-3 font-mono text-sm text-mist">+254</span>
          <input
            id="payout-phone"
            className="w-full bg-transparent px-3 py-3 font-mono text-paper outline-none"
            inputMode="numeric"
            autoComplete="tel-national"
            maxLength={12}
            placeholder="712 345 678"
            value={phone}
            onChange={(event) => setPhone(event.target.value)}
          />
        </div>
      </div>

      <dl className="rounded-xl border border-line bg-surface-2/60 px-3.5 py-2">
        <Row label="Fees" value="None" />
        <div className="my-1 border-t border-dashed border-line" />
        <Row label="M-Pesa payout" value={quote ? kes(quote.kesPayout) : '—'} emphasize />
      </dl>

      {problem ? <p className="-mt-1 text-xs text-put">{problem}</p> : null}

      <button type="submit" className={cn(btn, 'w-full py-3')} disabled={!canSubmit}>
        {busy ? 'Requesting…' : quote && !problem ? `Withdraw ${usd(quote.grossUsd)}` : 'Withdraw'}
      </button>
    </form>
  )
}

function History({ rows }: { rows: Withdrawal[] }) {
  return (
    <details className="group rounded-2xl border border-line bg-ink-2/60">
      <summary className="flex cursor-pointer list-none items-center justify-between px-4 py-3 text-sm font-medium">
        Recent withdrawals
        <span className="text-xs text-mist group-open:hidden">Show {rows.length}</span>
        <span className="hidden text-xs text-mist group-open:inline">Hide</span>
      </summary>
      <ul className="grid gap-2 px-3 pb-3">
        {rows.slice(0, 5).map((row) => (
          <li key={row.id} className="flex items-center justify-between gap-3 rounded-xl bg-surface-2 px-3 py-2.5">
            <div className="min-w-0">
              <p className="font-mono text-sm">
                {usd(row.amountUsd)} <span className="text-mist">→ {kes(row.kesPayout)}</span>
              </p>
              <p className="text-[11px] text-mist">
                {when(row.createdAt)} · {displayPhone(row.phone)}
              </p>
            </div>
            <span
              className={cn(
                'shrink-0 rounded-full px-2 py-0.5 text-[11px]',
                row.workflow === 'paid'
                  ? 'bg-call/15 text-call'
                  : row.workflow === 'rejected'
                    ? 'bg-put/15 text-put'
                    : 'bg-surface-3 text-paper',
              )}
            >
              {row.label}
            </span>
          </li>
        ))}
      </ul>
    </details>
  )
}

function Row({ label, value, emphasize = false }: { label: string; value: string; emphasize?: boolean }) {
  return (
    <div className="flex items-baseline justify-between gap-4 py-1 text-sm">
      <dt className="text-mist">{label}</dt>
      <dd className={cn('font-mono', emphasize ? 'text-base font-semibold text-signal-soft' : 'text-paper')}>{value}</dd>
    </div>
  )
}
