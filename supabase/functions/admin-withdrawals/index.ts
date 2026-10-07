import 'jsr:@supabase/functions-js/edge-runtime.d.ts'
import { adminClient, corsHeaders, json, userFromRequest } from '../_shared/server.ts'
import {
  WITHDRAWAL_COLUMNS,
  b2cActive,
  isWithdrawalAdmin,
  loadWithdrawal,
  userRole,
  resolveWithdrawConfig,
  type WithdrawalRow,
} from '../_shared/withdraw-server.ts'

// Auth required (verify_jwt on) AND the caller's JWT app_metadata.role must be admin / superadmin / finance.
// POST {action: 'list' | 'processing' | 'complete' | 'fail', id?, receipt?, reason?, note?, status?, limit?}
// Every state change goes through the SECURITY DEFINER functions; 'complete' needs the real M-Pesa receipt.

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

interface UserInfo {
  email: string | null
  name: string | null
}

function adminView(row: WithdrawalRow, users: Map<string, UserInfo>) {
  const u = users.get(row.user_id)
  return {
    id: row.id,
    user_id: row.user_id,
    user_email: u?.email ?? null,
    user_name: u?.name ?? null,
    status: row.status,
    provider: row.provider,
    amount_usd: Number(row.amount),
    amount_kes: row.amount_kes == null ? null : Number(row.amount_kes),
    fee_kes: row.fee_kes == null ? 0 : Number(row.fee_kes),
    net_kes: row.net_kes == null ? null : Number(row.net_kes),
    msisdn: row.msisdn,
    reference: row.reference,
    receipt: row.mpesa_receipt,
    conversation_id: row.conversation_id,
    result_code: row.result_code,
    result_desc: row.result_desc,
    failure_reason: row.failure_reason,
    admin_note: row.admin_note,
    admin_user_id: row.admin_user_id,
    created_at: row.created_at,
    processing_at: row.processing_at,
    completed_at: row.completed_at,
    failed_at: row.failed_at,
  }
}

function friendlyDbError(message: string): { status: number; error: string } {
  const code = (message.trim().match(/^([a-z_]+)/i) ?? [])[1] ?? ''
  switch (code) {
    case 'withdrawal_not_open':
      return { status: 409, error: `This withdrawal is already final (${message.split(':')[1]?.trim() ?? 'closed'}).` }
    case 'withdrawal_not_found':
      return { status: 404, error: 'Withdrawal not found.' }
    case 'receipt_required':
      return { status: 400, error: 'Enter the M-Pesa receipt/transaction code (6–40 letters or digits).' }
    case 'receipt_already_used':
      return { status: 409, error: 'That M-Pesa receipt is already recorded on another withdrawal.' }
    case 'reason_required':
      return { status: 400, error: 'Enter a reason; it is shown to the user.' }
    default:
      return { status: 500, error: 'Action failed.' }
  }
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders })
  if (req.method !== 'POST') return json({ error: 'Method not allowed' }, 405)

  const admin = adminClient()
  const user = await userFromRequest(admin, req)
  if (!user) return json({ error: 'Sign in as staff.' }, 401)
  if (!isWithdrawalAdmin(user)) {
    console.log('admin-withdrawals forbidden', user.id, userRole(user))
    return json({ error: 'Forbidden' }, 403)
  }

  let body: Record<string, unknown> = {}
  try {
    body = await req.json()
  } catch {
    return json({ error: 'Invalid request.' }, 400)
  }
  const action = String(body.action ?? '')

  if (action === 'list') {
    const status = typeof body.status === 'string' ? body.status.toUpperCase() : null
    const limit = Math.min(500, Math.max(1, Number(body.limit) || 200))
    let query = admin
      .from('withdrawals')
      .select(WITHDRAWAL_COLUMNS)
      .eq('account_mode', 'real')
      .eq('is_simulated', false)
      .order('created_at', { ascending: false })
      .limit(limit)
    if (status && status !== 'ALL') {
      query = status === 'OPEN' ? query.in('status', ['PENDING', 'PROCESSING']) : query.eq('status', status)
    }
    const { data, error } = await query
    if (error) {
      console.error('admin list failed', error.message)
      return json({ error: 'Could not load withdrawals.' }, 500)
    }
    const rows = (data ?? []) as WithdrawalRow[]
    const userIds = [...new Set(rows.map((r) => r.user_id))]
    const users = new Map<string, UserInfo>()
    if (userIds.length) {
      const { data: userRows } = await admin.from('users').select('id, email, name').in('id', userIds)
      for (const u of userRows ?? []) users.set(u.id, { email: u.email ?? null, name: u.name ?? null })
    }
    const cfg = await resolveWithdrawConfig(admin)
    return json({
      mode: b2cActive(cfg) ? 'daraja_b2c' : 'manual',
      fee_kes: cfg.feeKes,
      kes_per_usd: cfg.kesPerUsd,
      withdrawals: rows.map((r) => adminView(r, users)),
    })
  }

  const id = String(body.id ?? '')
  if (!UUID_RE.test(id)) return json({ error: 'Invalid withdrawal id.' }, 400)
  const note = typeof body.note === 'string' ? body.note.trim().slice(0, 300) : null

  let rpc: { fn: string; args: Record<string, unknown> } | null = null
  if (action === 'processing') {
    rpc = {
      fn: 'mark_withdrawal_processing',
      args: { p_withdrawal_id: id, p_admin_user_id: user.id, p_note: note, p_provider: 'manual', p_conversation_id: null },
    }
  } else if (action === 'complete') {
    const receipt = String(body.receipt ?? '').trim()
    rpc = {
      fn: 'complete_withdrawal',
      args: {
        p_withdrawal_id: id,
        p_receipt: receipt,
        p_admin_user_id: user.id,
        p_note: note,
        p_raw: { source: 'admin_manual', admin_user_id: user.id, recorded_at: new Date().toISOString() },
      },
    }
  } else if (action === 'fail') {
    const reason = String(body.reason ?? '').trim()
    rpc = {
      fn: 'fail_withdrawal',
      args: {
        p_withdrawal_id: id,
        p_reason: reason,
        p_admin_user_id: user.id,
        p_raw: { source: 'admin_manual', admin_user_id: user.id, recorded_at: new Date().toISOString(), note },
      },
    }
  } else {
    return json({ error: 'Unknown action.' }, 400)
  }

  const { data, error } = await admin.rpc(rpc.fn, rpc.args)
  if (error) {
    const mapped = friendlyDbError(error.message)
    if (mapped.status >= 500) console.error('admin action failed', action, id, error.message)
    else console.log('admin action rejected', action, id, error.message)
    return json({ error: mapped.error }, mapped.status)
  }
  console.log('admin action', action, id, user.id, JSON.stringify(data).slice(0, 200))

  const row = await loadWithdrawal(admin, id)
  const users = new Map<string, UserInfo>()
  if (row) {
    const { data: u } = await admin.from('users').select('id, email, name').eq('id', row.user_id).maybeSingle()
    if (u) users.set(u.id, { email: u.email ?? null, name: u.name ?? null })
  }
  return json({ result: data, withdrawal: row ? adminView(row, users) : null })
})
