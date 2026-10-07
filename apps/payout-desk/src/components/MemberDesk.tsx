import { useMemo, useState } from 'react'
import { displayPhone, withdrawalQuote } from '../domain/rates'
import type { DeskState } from '../domain/types'
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
  const [amount, setAmount] = useState('')
  const [phone, setPhone] = useState(desk.phone)
  const quote = useMemo(() => {
    const value = Number(amount)
    if (!Number.isFinite(value) || amount.trim() === '') return null
    return withdrawalQuote(value, desk.rates)
  }, [amount, desk.rates])
  const overCap = quote !== null && quote.kesPayout > desk.rates.mpesaCapKes
  const phonePreview = displayPhone(phone.replace(/\D/g, '').replace(/^254/, '').replace(/^0/, ''))

  return (
    <div className="grid items-start gap-6">
      <section>
        <h2 className="text-lg font-semibold">Request an M-Pesa payout</h2>
        <p className="mt-1 text-sm text-mist">Minimum {usd(desk.rates.minWithdrawUsd)}. No fees are charged.</p>
        <form
          className="mt-4 rounded-3xl border border-line bg-surface p-4 sm:p-5"
          onSubmit={(event) => {
            event.preventDefault()
            onWithdraw(amount, phone)
          }}
        >
          <label className="block text-sm font-medium" htmlFor="amount">Amount in USD</label>
          <input
            id="amount"
            className="mt-2 w-full rounded-2xl border border-line-strong bg-ink-2 px-3 py-3 font-mono text-lg text-paper outline-none"
            inputMode="decimal"
            autoComplete="off"
            placeholder={desk.rates.minWithdrawUsd.toFixed(2)}
            value={amount}
            onChange={(event) => setAmount(event.target.value)}
          />
          <label className="mt-4 block text-sm font-medium" htmlFor="phone">M-Pesa number</label>
          <div className="mt-2 flex overflow-hidden rounded-2xl border border-line-strong bg-ink-2">
            <span className="grid place-items-center px-3 font-mono text-sm text-mist">+254</span>
            <input
              id="phone"
              className="w-full bg-transparent px-3 py-3 font-mono text-paper outline-none"
              inputMode="numeric"
              autoComplete="tel-national"
              maxLength={12}
              placeholder="712 345 678"
              value={phone}
              onChange={(event) => setPhone(event.target.value)}
            />
          </div>
          <dl className="mt-4 border-t border-dashed border-line-strong pt-4">
            <Row label="Fees" value="None" />
            <Row label="M-Pesa payout" value={quote ? kes(quote.kesPayout) : '—'} emphasize />
            <Row label="Phone" value={phonePreview.length > 5 ? phonePreview : '—'} />
          </dl>
          {overCap ? (
            <p className="mt-3 text-sm text-put">One M-Pesa payout cannot exceed KES {desk.rates.mpesaCapKes.toLocaleString('en-KE')}.</p>
          ) : (
            <p className="mt-3 text-xs text-mist">Supabase calculates this again when you request the payout. You can request another payout with whatever balance remains.</p>
          )}
          <button type="submit" className={`${btn} mt-4 w-full`} disabled={busy}>
            Request M-Pesa payout
          </button>
        </form>
      </section>

      <section>
        <h2 className="text-lg font-semibold">Withdrawals</h2>
        {desk.withdrawals.length === 0 ? (
          <p className="mt-3 text-sm text-mist">No M-Pesa withdrawals yet.</p>
        ) : (
          <ul className="mt-3 grid gap-3">
            {desk.withdrawals.map((row) => (
              <li key={row.id} className="flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-line bg-surface-2 px-4 py-3">
                <div>
                  <p className="font-mono text-sm">{usd(row.amountUsd)} <span className="text-mist">→ {kes(row.kesPayout)}</span></p>
                  <p className="mt-1 text-xs text-mist">{when(row.createdAt)} · {displayPhone(row.phone)}</p>
                </div>
                <span className="rounded-full bg-surface-3 px-2.5 py-1 text-xs text-paper">{row.label}</span>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  )
}

function Row({ label, value, emphasize = false }: { label: string; value: string; emphasize?: boolean }) {
  return (
    <div className="flex items-baseline justify-between gap-4 py-1.5 text-sm">
      <dt className="text-mist">{label}</dt>
      <dd className={`font-mono ${emphasize ? 'text-base text-signal-soft' : 'text-paper'}`}>{value}</dd>
    </div>
  )
}
