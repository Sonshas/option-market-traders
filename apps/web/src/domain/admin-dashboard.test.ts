import { describe, expect, it } from 'vitest'
import webSource from './admin-dashboard.ts?raw'
import denoSource from '../../../../supabase/functions/_shared/admin-dashboard.ts?raw'
import withdrawServer from '../../../../supabase/functions/_shared/payments/withdraw-server.ts?raw'
import {
  DASHBOARD_STAFF_ROLES,
  collectedTotals,
  isCreditedDeposit,
  isDashboardStaffRole,
  mergeJoinedUsers,
  splitMpesaDeposits,
  toDashboardDeposit,
  type DepositSource,
} from '@/domain/admin-dashboard'

function deposit(overrides: Partial<DepositSource> = {}): DepositSource {
  return {
    id: 'd1',
    user_id: 'u1',
    amount: '3.85',
    currency: 'USD',
    status: 'COMPLETED',
    provider: 'megapay',
    method: 'mpesa',
    mpesa_receipt: null,
    callback_amount_kes: null,
    details: { amount_kes: '500', mpesa_receipt: 'RECEIPT10', completed_at: '2026-10-03T09:36:17.466Z' },
    created_at: '2026-10-03T09:30:00.000Z',
    updated_at: '2026-10-03T09:36:17.466Z',
    is_simulated: false,
    account_mode: 'real',
    ...overrides,
  }
}

describe('shared module', () => {
  it('web and edge copies are byte-identical', () => {
    expect(denoSource).toBe(webSource)
  })

  it('uses the same staff roles as admin-withdrawals', () => {
    const match = withdrawServer.match(/WITHDRAWAL_ADMIN_ROLES = new Set\(\[([^\]]+)\]\)/)
    expect(match).toBeTruthy()
    const roles = [...match![1].matchAll(/'([^']+)'/g)].map((part) => part[1])
    expect([...DASHBOARD_STAFF_ROLES]).toEqual(roles)
  })
})

describe('isDashboardStaffRole', () => {
  it('allows admin, superadmin, and finance only', () => {
    expect(isDashboardStaffRole('admin')).toBe(true)
    expect(isDashboardStaffRole(' superadmin ')).toBe(true)
    expect(isDashboardStaffRole('finance')).toBe(true)
    expect(isDashboardStaffRole('trader')).toBe(false)
    expect(isDashboardStaffRole('support')).toBe(false)
    expect(isDashboardStaffRole('compliance')).toBe(false)
    expect(isDashboardStaffRole('')).toBe(false)
    expect(isDashboardStaffRole(null)).toBe(false)
  })
})

describe('collected money', () => {
  const rows = [
    deposit(),
    deposit({ id: 'pending', status: 'PENDING', amount: '0.77', details: { amount_kes: '100' } }),
    deposit({ id: 'failed', status: 'FAILED', amount: '0.77', details: { amount_kes: '100' } }),
    deposit({ id: 'cancelled', status: 'CANCELLED', amount: '12.31', details: { amount_kes: '1600' } }),
    deposit({ id: 'sim', is_simulated: true, amount: '99', details: { amount_kes: '9999' } }),
    deposit({ id: 'demo', account_mode: 'demo', amount: '50', details: { amount_kes: '5000' } }),
    deposit({ id: 'card', method: 'card', status: 'COMPLETED', amount: '20', details: { amount_kes: '2000' } }),
  ]

  it('counts only completed real M-Pesa deposits', () => {
    const { collected, other } = splitMpesaDeposits(rows)
    expect(collected.map((row) => row.id)).toEqual(['d1'])
    expect(other.map((row) => row.id)).toEqual(['pending', 'failed', 'cancelled'])
    expect(isCreditedDeposit(rows[0])).toBe(true)
    expect(isCreditedDeposit(rows[1])).toBe(false)
    const totals = collectedTotals(collected)
    expect(totals).toEqual({ usd: 3.85, kes: 500, count: 1 })
    expect(collectedTotals(other).usd).not.toBe(3.85)
    expect(collectedTotals([])).toEqual({ usd: 0, kes: 0, count: 0 })
  })

  it('reads KES and the receipt without copying raw provider details', () => {
    const view = toDashboardDeposit(
      deposit({
        mpesa_receipt: null,
        details: {
          amount_kes: '500',
          mpesa_receipt: 'RECEIPT10',
          phone_masked: '07****123',
          failure_raw: { secret: true },
          completed_at: '2026-10-03T09:36:17.466Z',
        },
      }),
    )
    expect(view.amount_usd).toBe(3.85)
    expect(view.amount_kes).toBe(500)
    expect(view.receipt).toBe('RECEIPT10')
    expect(view.credited_at).toBe('2026-10-03T09:36:17.466Z')
    expect(view).not.toHaveProperty('details')
    expect(JSON.stringify(view)).not.toContain('phone_masked')
    expect(JSON.stringify(view)).not.toContain('failure_raw')
    expect(JSON.stringify(view)).not.toContain('07****123')
  })

  it('prefers the receipt column and callback KES when both are stored', () => {
    const view = toDashboardDeposit(
      deposit({
        mpesa_receipt: 'COLUMNRC',
        callback_amount_kes: '480',
        details: { amount_kes: '500', mpesa_receipt: 'DETAILSRC' },
      }),
    )
    expect(view.receipt).toBe('COLUMNRC')
    expect(view.amount_kes).toBe(480)
  })
})

describe('mergeJoinedUsers', () => {
  it('lists newest signup first and keeps the auth role', () => {
    const users = mergeJoinedUsers(
      [
        { id: 'old', email: 'old@example.com', created_at: '2026-01-01T00:00:00.000Z', app_role: 'trader' },
        { id: 'new', email: 'new@example.com', created_at: '2026-10-01T00:00:00.000Z', app_role: 'superadmin' },
      ],
      [
        { id: 'new', email: 'other@example.com', role: 'trader' },
        { id: 'old', email: null, role: 'admin' },
      ],
    )
    expect(users.map((user) => user.id)).toEqual(['new', 'old'])
    expect(users[0]).toMatchObject({ email: 'new@example.com', role: 'superadmin' })
    expect(users[1]).toMatchObject({ email: 'old@example.com', role: 'trader' })
  })
})
