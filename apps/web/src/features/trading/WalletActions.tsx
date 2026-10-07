import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { Button } from '@/components/ui'
import { useAuthSession } from '@/hooks/useAuth'
import { usePracticeBook } from '@/hooks/usePracticeBook'
import { useWallet } from '@/hooks/useWallet'
import { realWithdrawalsEnabled } from '@/domain/account'
import { cn } from '@/lib/cn'
import { formatMoney } from '@/lib/format'
import { REAL_INTEGRATION } from '@/providers/config'
import { PayoutWithdrawPanel } from '@/features/payout-desk/PayoutWithdrawPanel'
import type { AccountMode } from '@/types'

/**
 * Active book balance. Practice also gets shortcuts: top up virtual Practice funds, or withdraw any remaining
 * REAL wallet balance to M-Pesa (the virtual balance itself is never withdrawable).
 */
export function WalletActions({ kind, className }: { kind: AccountMode; className?: string }) {
  const navigate = useNavigate()
  const { isSignedIn } = useAuthSession()
  const { wallet } = useWallet('demo')
  const { isPractice } = usePracticeBook()
  const [withdrawOpen, setWithdrawOpen] = useState(false)
  const realWithdrawalsOn = realWithdrawalsEnabled(REAL_INTEGRATION)

  useEffect(() => {
    if (!withdrawOpen) return
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setWithdrawOpen(false)
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [withdrawOpen])

  function withdraw() {
    if (!isSignedIn) navigate('/login')
    else if (realWithdrawalsOn) setWithdrawOpen(true)
  }

  return (
    <div
      className={cn('flex items-center gap-2 rounded-xl border border-line bg-ink-2 p-2', className)}
      data-testid="wallet-actions"
      data-kind={kind}
    >
      <div className="min-w-0 flex-1">
        <p className="truncate whitespace-nowrap text-[10px] font-semibold uppercase tracking-wider text-mist">
          {isPractice ? 'Practice balance' : 'Demo balance'}
        </p>
        <p className={cn('truncate font-mono text-sm font-semibold', isPractice ? 'text-amber' : 'text-demo')} data-testid="ticket-balance">
          {formatMoney(wallet?.availableBalance ?? null)}
        </p>
      </div>
      {isPractice ? (
        <>
          <Button
            size="sm"
            className="h-8 px-3"
            onClick={() => navigate('/app/wallet?action=deposit')}
            title="Add virtual Practice funds"
            data-testid="desk-deposit"
          >
            Top up
          </Button>
          <Button
            size="sm"
            variant="secondary"
            className="h-8 gap-1 px-3"
            onClick={withdraw}
            disabled={isSignedIn && !realWithdrawalsOn}
            title="Withdraw a remaining REAL balance to M-Pesa"
            data-testid="desk-withdraw"
          >
            Withdraw
          </Button>
        </>
      ) : null}

      {isPractice && withdrawOpen ? (
        <div className="fixed inset-0 z-50 flex items-end justify-center p-4 sm:items-center" role="presentation">
          <button
            type="button"
            className="absolute inset-0 bg-black/60"
            aria-label="Close withdraw"
            onClick={() => setWithdrawOpen(false)}
          />
          <div className="relative z-10 max-h-[90svh] w-full max-w-md overflow-y-auto" role="dialog" aria-modal="true" aria-label="Withdraw to M-Pesa">
            <PayoutWithdrawPanel className="shadow-2xl" onClose={() => setWithdrawOpen(false)} />
          </div>
        </div>
      ) : null}
    </div>
  )
}
