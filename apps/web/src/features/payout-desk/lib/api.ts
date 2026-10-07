import type { SupabaseClient } from '@supabase/supabase-js'
import { FALLBACK_RATES, type PayoutRates } from '../domain/rates'
import type { ActionResult, Activity, AdminState, DeskState, Level, PayoutWorkflow, Withdrawal } from '../domain/types'
import { reportBackendIssue } from '@/services/system-issues'
import { supabase } from './supabase'

function record(value: unknown): Record<string, unknown> {
  return value !== null && typeof value === 'object' ? (value as Record<string, unknown>) : {}
}

function text(value: unknown, fallback = ''): string {
  return typeof value === 'string' ? value : fallback
}

function num(value: unknown, fallback = 0): number {
  const parsed = typeof value === 'number' ? value : Number(value)
  return Number.isFinite(parsed) ? parsed : fallback
}

function workflow(value: unknown): PayoutWorkflow {
  if (
    value === 'held' ||
    value === 'queued' ||
    value === 'approved' ||
    value === 'processing' ||
    value === 'paid' ||
    value === 'rejected'
  ) {
    return value
  }
  return 'queued'
}

function level(value: unknown): Level {
  return value === 'info' || value === 'warning' || value === 'error' ? value : 'error'
}

function rates(value: unknown): PayoutRates {
  const row = record(value)
  return {
    minWithdrawUsd: num(row.minWithdrawUsd, FALLBACK_RATES.minWithdrawUsd),
    kesPerUsdWithdrawal: num(row.kesPerUsdWithdrawal, FALLBACK_RATES.kesPerUsdWithdrawal),
    mpesaCapKes: num(row.mpesaCapKes, FALLBACK_RATES.mpesaCapKes),
  }
}

function withdrawal(value: unknown): Withdrawal {
  const row = record(value)
  return {
    id: text(row.id),
    amountUsd: num(row.amountUsd),
    kesPayout: num(row.kesPayout),
    phone: text(row.phone),
    createdAt: text(row.createdAt),
    workflow: workflow(row.workflow),
    label: text(row.label, 'Pending'),
    email: text(row.email) || undefined,
    member: text(row.member) || undefined,
  }
}

export function parseAction(value: unknown, operation: string): ActionResult {
  const row = record(value)
  const ref = text(row.ref)
  return {
    ok: row.ok === true,
    level: level(row.level),
    operation: text(row.operation, operation),
    message: text(row.message, 'The payout desk could not complete that step.'),
    ref: ref || undefined,
  }
}

export function parseDesk(value: unknown): DeskState {
  const row = record(value)
  const list = Array.isArray(row.withdrawals) ? row.withdrawals.map(withdrawal) : []
  return {
    email: text(row.email),
    role: row.role === 'admin' ? 'admin' : 'member',
    balanceUsd: num(row.balanceUsd),
    phone: text(row.phone),
    rates: rates(row.rates),
    withdrawals: list,
  }
}

const PAYOUT_UNAVAILABLE = 'Withdrawals are temporarily unavailable. Please try again later.'

function client(): SupabaseClient {
  if (!supabase) {
    reportBackendIssue('payout_desk', 'config', 'Payout desk is not configured in this build')
    throw new Error(PAYOUT_UNAVAILABLE)
  }
  return supabase
}

async function rpc(fn: string, args?: Record<string, unknown>): Promise<ActionResult> {
  const { data, error } = await client().rpc(fn, args)
  if (error) {
    reportBackendIssue('payout_desk', `rpc.${fn}`, error)
    return { ok: false, level: 'error', operation: fn, message: PAYOUT_UNAVAILABLE }
  }
  return parseAction(data, fn)
}

export async function loadDesk(): Promise<DeskState> {
  const { data, error } = await client().rpc('desk_state')
  if (error) {
    reportBackendIssue('payout_desk', 'rpc.desk_state', error)
    throw new Error(PAYOUT_UNAVAILABLE)
  }
  const row = record(data)
  if (row.ok === false) {
    throw new Error(text(row.message, 'The payout desk could not be opened.'))
  }
  return parseDesk(data)
}

export async function requestWithdrawal(amount: string, phone: string): Promise<ActionResult> {
  return rpc('request_withdrawal', { p_amount: amount, p_phone: phone })
}

export async function loadAdmin(): Promise<AdminState> {
  const { data, error } = await client().rpc('admin_queue')
  if (error) {
    reportBackendIssue('payout_desk', 'rpc.admin_queue', error)
    throw new Error(PAYOUT_UNAVAILABLE)
  }
  const row = record(data)
  if (row.ok === false) {
    throw new Error(text(row.message, 'This account is not an admin.'))
  }
  const activity = Array.isArray(row.activity)
    ? row.activity.map((item) => {
        const entry = record(item)
        return {
          id: text(entry.id),
          at: text(entry.at),
          level: level(entry.level),
          operation: text(entry.operation),
          message: text(entry.message),
        } satisfies Activity
      })
    : []
  return {
    withdrawals: Array.isArray(row.withdrawals) ? row.withdrawals.map(withdrawal) : [],
    activity,
  }
}

export async function adminStep(step: 'approve' | 'send' | 'paid' | 'reject', id: string): Promise<ActionResult> {
  const fn = {
    approve: 'admin_approve',
    send: 'admin_send',
    paid: 'admin_mark_paid',
    reject: 'admin_reject',
  }[step]
  return rpc(fn, { p_id: id })
}
