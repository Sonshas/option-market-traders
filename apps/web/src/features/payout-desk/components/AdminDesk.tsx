import { displayPhone } from '../domain/rates'
import type { AdminState } from '../domain/types'
import { kes, usd, when } from '../format'
import { btn, btnDanger, btnQuiet } from './chrome'

export function AdminDesk({
  queue,
  busy,
  onStep,
}: {
  queue: AdminState
  busy: boolean
  onStep: (step: 'approve' | 'send' | 'paid' | 'reject', id: string) => void
}) {
  return (
    <div className="grid gap-8">
      <section>
        <h2 className="text-lg font-semibold">Payout queue</h2>
        <p className="mt-1 text-sm text-mist">Send and mark paid stay blocked until that member has paid both fees. Reject returns the USD to the same real account.</p>
        {queue.withdrawals.length === 0 ? (
          <p className="mt-4 text-sm text-mist">No withdrawals yet.</p>
        ) : (
          <ul className="mt-4 grid gap-3">
            {queue.withdrawals.map((row) => {
              const open = row.workflow !== 'paid' && row.workflow !== 'rejected'
              const who = row.member || row.email || 'Member'
              return (
                <li key={row.id} className="rounded-3xl border border-line bg-surface-2 p-4">
                  <div className="flex flex-wrap items-start justify-between gap-3">
                    <div>
                      <p className="font-semibold">{who}</p>
                      <p className="text-xs text-mist">{row.email}</p>
                      <p className="mt-2 font-mono text-sm">{usd(row.amountUsd)} → {kes(row.kesPayout)}</p>
                      <p className="mt-1 text-xs text-mist">{when(row.createdAt)} · {displayPhone(row.phone)}</p>
                    </div>
                    <span className="rounded-full bg-surface-3 px-2.5 py-1 text-xs">{row.label}</span>
                  </div>
                  {open ? (
                    <div className="mt-4 flex flex-wrap gap-2">
                      {row.workflow === 'queued' ? (
                        <button type="button" className={btn} disabled={busy} onClick={() => onStep('approve', row.id)}>Approve</button>
                      ) : null}
                      {row.workflow === 'approved' ? (
                        <button type="button" className={btn} disabled={busy} onClick={() => onStep('send', row.id)}>Send M-Pesa</button>
                      ) : null}
                      {row.workflow === 'processing' ? (
                        <button type="button" className={btn} disabled={busy} onClick={() => onStep('paid', row.id)}>Mark paid</button>
                      ) : null}
                      <button type="button" className={row.workflow === 'held' ? btnDanger : btnQuiet} disabled={busy} onClick={() => onStep('reject', row.id)}>
                        Reject and return funds
                      </button>
                    </div>
                  ) : null}
                </li>
              )
            })}
          </ul>
        )}
      </section>
      <section>
        <h2 className="text-lg font-semibold">Activity</h2>
        {queue.activity.length === 0 ? (
          <p className="mt-3 text-sm text-mist">No activity yet.</p>
        ) : (
          <ul className="mt-3 grid gap-2">
            {queue.activity.map((entry) => (
              <li key={entry.id} className="rounded-2xl border border-line px-3 py-2 text-sm">
                <span className="font-mono text-xs text-mist">{entry.operation}</span>
                <p className="mt-1">{entry.message}</p>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  )
}
