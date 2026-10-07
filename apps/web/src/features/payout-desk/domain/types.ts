import type { PayoutRates } from './rates'

export type PayoutWorkflow = 'held' | 'queued' | 'approved' | 'processing' | 'paid' | 'rejected'
export type Level = 'info' | 'warning' | 'error'

export interface Withdrawal {
  id: string
  amountUsd: number
  kesPayout: number
  phone: string
  createdAt: string
  workflow: PayoutWorkflow
  label: string
  email?: string
  member?: string
}

export interface Activity {
  id: string
  at: string
  level: Level
  operation: string
  message: string
}

export interface DeskState {
  email: string
  role: 'member' | 'admin'
  balanceUsd: number
  phone: string
  rates: PayoutRates
  withdrawals: Withdrawal[]
}

export interface ActionResult {
  ok: boolean
  level: Level
  operation: string
  message: string
  ref?: string
}

export interface AdminState {
  withdrawals: Withdrawal[]
  activity: Activity[]
}
