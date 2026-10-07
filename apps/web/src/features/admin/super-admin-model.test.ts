import { describe, expect, it } from 'vitest'
import { auditValue, filterPanelUsers, formatPercent, parseBalanceInput, parsePercentInput } from '@/features/admin/super-admin-model'
import { mapOverview, type PanelAuditRow, type PanelUser } from '@/services/admin-panel'

function user(overrides: Partial<PanelUser>): PanelUser {
  return {
    id: '11111111-1111-1111-1111-111111111111',
    email: 'trader@example.com',
    signedUpAt: '2026-10-01T00:00:00.000Z',
    lastSignInAt: null,
    role: 'trader',
    demoBalance: 10_000,
    practiceBalance: 10_000,
    simulatedSynced: true,
    realBalance: 0,
    realCurrency: 'USD',
    winRateOverride: null,
    effectiveWinRate: 0.95,
    ...overrides,
  }
}

describe('admin panel inputs', () => {
  it('parses percentages 0–100 into 0..1', () => {
    expect(parsePercentInput('95')).toBe(0.95)
    expect(parsePercentInput(' 37.5% ')).toBe(0.375)
    expect(parsePercentInput('0')).toBe(0)
    expect(parsePercentInput('100')).toBe(1)
    expect(parsePercentInput('100.1')).toBeNull()
    expect(parsePercentInput('-1')).toBeNull()
    expect(parsePercentInput('')).toBeNull()
    expect(parsePercentInput('abc')).toBeNull()
  })

  it('formats rates as percentages', () => {
    expect(formatPercent(0.955)).toBe('95.5%')
    expect(formatPercent(null)).toBe('—')
  })

  it('parses balances within range', () => {
    expect(parseBalanceInput('$12,500.456')).toBe(12500.46)
    expect(parseBalanceInput('0')).toBe(0)
    expect(parseBalanceInput('-5')).toBeNull()
    expect(parseBalanceInput('2000000000')).toBeNull()
    expect(parseBalanceInput('')).toBeNull()
  })

  it('searches users by email, id prefix or role', () => {
    const list = [user({}), user({ id: '22222222-2222-2222-2222-222222222222', email: 'boss@site.com', role: 'superadmin' })]
    expect(filterPanelUsers(list, 'BOSS')).toHaveLength(1)
    expect(filterPanelUsers(list, '2222')).toHaveLength(1)
    expect(filterPanelUsers(list, 'superadmin')).toHaveLength(1)
    expect(filterPanelUsers(list, '')).toHaveLength(2)
  })

  it('shows audit values as money or percent', () => {
    const base: PanelAuditRow = {
      id: 1,
      adminEmail: 'a',
      action: 'simulated_balance.set',
      targetEmail: null,
      targetUserId: null,
      book: 'demo',
      oldValue: 10000,
      newValue: 2500.5,
      reason: null,
      createdAt: '',
    }
    expect(auditValue(base, 'new')).toBe('$2,500.50')
    expect(auditValue({ ...base, action: 'win_rate.user_clear', newValue: null, oldValue: 0.5 }, 'new')).toBe('global')
    expect(auditValue({ ...base, action: 'win_rate.user_clear', newValue: null, oldValue: 0.5 }, 'old')).toBe('50%')
  })
})

describe('mapOverview', () => {
  it('tolerates an empty payload with zeros and defaults', () => {
    const overview = mapOverview({})
    expect(overview.users).toEqual([])
    expect(overview.deposits.summary.total).toEqual({ count: 0, usd: 0 })
    expect(overview.globalWinRate).toBe(0.95)
    expect(overview.startingBalance).toBe(10_000)
    expect(overview.kesPerUsd).toBeNull()
  })

  it('maps users and audit rows', () => {
    const overview = mapOverview({
      rate: { kes_per_usd: 130, source: 'x' },
      users: [{ id: 'u1', email: 'a@b.c', demo_balance: '12.5', practice_balance: 7, simulated_synced: true, win_rate_override: '0.4', effective_win_rate: 0.4 }],
      audit: [{ id: 3, action: 'win_rate.global_set', old_value: 0.95, new_value: 0.9 }],
      win_rate: { global: 0.9 },
    })
    expect(overview.kesPerUsd).toBe(130)
    expect(overview.users[0]).toMatchObject({ id: 'u1', demoBalance: 12.5, practiceBalance: 7, winRateOverride: 0.4, effectiveWinRate: 0.4 })
    expect(overview.audit[0]).toMatchObject({ id: 3, action: 'win_rate.global_set', newValue: 0.9 })
    expect(overview.globalWinRate).toBe(0.9)
  })
})
