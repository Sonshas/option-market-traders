import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { Button } from '@/components/ui'
import { useAuthSession } from '@/hooks/useAuth'
import { useWallet } from '@/hooks/useWallet'
import { REAL_COMING_SOON, realDepositsEnabled, realWithdrawalsEnabled } from '@/domain/account'
import { cn } from '@/lib/cn'
import { formatMoney } from '@/lib/format'
import { REAL_INTEGRATION } from '@/providers/config'
import { RealDepositPanel } from '@/features/wallet/RealDepositPanel'
import { RealWithdrawPanel } from '@/features/wallet/RealWithdrawPanel'
import type { AccountMode } from '@/types'

/** Balance plus Deposit / Withdraw shortcuts for the trading desk. REAL actions open the M-Pesa panels. */
export function WalletActions({ kind, className }: { kind: AccountMode; className?: string }) {
  const navigate = useNavigate()
  const { isSignedIn } = useAuthSession()
  const { wallet, balanceDisplay } = useWallet(kind)
  const [depositOpen, setDepositOpen] = useState(false)
  const [withdrawOpen, setWithdrawOpen] = useState(false)
  const isDemo = kind === 'demo'
  const realDepositsOn = realDepositsEnabled(REAL_INTEGRATION)
  const realWithdrawalsOn = realWithdrawalsEnabled(REAL_INTEGRATION)

  useEffect(() => {
    if (!depositOpen && !withdrawOpen) return
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        setDepositOpen(false)
        setWithdrawOpen(false)
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [depositOpen, withdrawOpen])

  function deposit() {
    if (isDemo) navigate('/app/wallet?action=deposit')
    else if (!isSignedIn) navigate('/login')
    else setDepositOpen(true)
  }

  function withdraw() {
    if (isDemo) navigate('/app/wallet?action=withdraw')
    else if (!isSignedIn) navigate('/login')
    else setWithdrawOpen(true)
  }

  return (
    <div
      className={cn('flex items-center gap-2 rounded-xl border border-line bg-ink-2 p-2', className)}
      data-testid="wallet-actions"
      data-kind={kind}
    >
      <div className="min-w-0 flex-1">
        <p className="truncate whitespace-nowrap text-[10px] font-semibold uppercase tracking-wider text-mist">
          {isDemo ? 'Demo balance' : 'Real balance'}
        </p>
        <p
          className={cn('truncate font-mono text-sm font-semibold', isDemo ? 'text-demo' : 'text-live')}
          data-testid="ticket-balance"
        >
          {isDemo ? formatMoney(wallet?.availableBalance ?? null) : balanceDisplay}
        </p>
      </div>
      <Button
        size="sm"
        className="h-8 px-3"
        onClick={deposit}
        disabled={!isDemo && isSignedIn && !realDepositsOn}
        title={!isDemo && !realDepositsOn ? `Deposits: ${REAL_COMING_SOON}` : undefined}
        data-testid="desk-deposit"
      >
        Deposit
      </Button>
      <Button
        size="sm"
        variant="secondary"
        className="h-8 gap-1 px-3"
        onClick={withdraw}
        disabled={!isDemo && isSignedIn && !realWithdrawalsOn}
        title={!isDemo ? 'Withdraw to M-Pesa' : undefined}
        data-testid="desk-withdraw"
      >
        Withdraw
      </Button>

      {depositOpen && !isDemo ? (
        <div className="fixed inset-0 z-50 flex items-end justify-center p-4 sm:items-center" role="presentation">
          <button
            type="button"
            className="absolute inset-0 bg-black/60"
            aria-label="Close deposit"
            onClick={() => setDepositOpen(false)}
          />
          <div className="relative z-10 max-h-[90svh] w-full max-w-md overflow-y-auto" role="dialog" aria-modal="true" aria-label="Deposit with M-Pesa">
            <RealDepositPanel className="shadow-2xl" onClose={() => setDepositOpen(false)} />
          </div>
        </div>
      ) : null}

      {withdrawOpen && !isDemo ? (
        <div className="fixed inset-0 z-50 flex items-end justify-center p-4 sm:items-center" role="presentation">
          <button
            type="button"
            className="absolute inset-0 bg-black/60"
            aria-label="Close withdraw"
            onClick={() => setWithdrawOpen(false)}
          />
          <div className="relative z-10 max-h-[90svh] w-full max-w-md overflow-y-auto" role="dialog" aria-modal="true" aria-label="Withdraw to M-Pesa">
            <RealWithdrawPanel className="shadow-2xl" onClose={() => setWithdrawOpen(false)} />
          </div>
        </div>
      ) : null}
    </div>
  )
}
