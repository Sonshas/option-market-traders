import type { PanelAuditRow, PanelUser } from '@/services/admin-panel'

export const MAX_SIMULATED_BALANCE = 1_000_000_000

/** "95" / "95.5%" → 0.95 / 0.955. Null unless 0–100. */
export function parsePercentInput(value: string): number | null {
  const cleaned = value.trim().replace(/%$/, '').trim()
  if (cleaned === '') return null
  const n = Number(cleaned)
  if (!Number.isFinite(n) || n < 0 || n > 100) return null
  return Math.round(n * 100) / 10_000
}

export function formatPercent(rate: number | null | undefined): string {
  if (rate == null || !Number.isFinite(rate)) return '—'
  const pct = Math.round(rate * 10_000) / 100
  return `${pct}%`
}

/** "$1,234.5" → 1234.5. Null unless 0 – MAX_SIMULATED_BALANCE. */
export function parseBalanceInput(value: string): number | null {
  const cleaned = value.trim().replace(/[$,\s]/g, '')
  if (cleaned === '') return null
  const n = Number(cleaned)
  if (!Number.isFinite(n) || n < 0 || n > MAX_SIMULATED_BALANCE) return null
  return Math.round(n * 100) / 100
}

export function filterPanelUsers(users: readonly PanelUser[], query: string): PanelUser[] {
  const q = query.trim().toLowerCase()
  if (!q) return [...users]
  return users.filter((u) => (u.email ?? '').toLowerCase().includes(q) || u.id.toLowerCase().startsWith(q) || u.role.toLowerCase() === q)
}

const ACTION_LABELS: Record<string, string> = {
  'simulated_balance.set': 'Set simulated balance',
  'simulated_balance.reset': 'Reset simulated balance',
  'win_rate.global_set': 'Set global win rate',
  'win_rate.user_set': 'Set user win rate',
  'win_rate.user_clear': 'User win rate → global',
}

export function auditActionLabel(action: string): string {
  return ACTION_LABELS[action] ?? action
}

export function auditValue(row: PanelAuditRow, which: 'old' | 'new'): string {
  const value = which === 'old' ? row.oldValue : row.newValue
  if (row.action.startsWith('win_rate.')) return value == null ? 'global' : formatPercent(value)
  return value == null ? '—' : `$${value.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
}
