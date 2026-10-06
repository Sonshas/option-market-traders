import 'jsr:@supabase/functions-js/edge-runtime.d.ts'
import { adminClient } from '../_shared/server.ts'
import { findWithdrawalByConversation, loadWithdrawal } from '../_shared/withdraw-server.ts'
import { isOpenWithdrawalStatus, parseB2cResult } from '../_shared/withdrawals.ts'

// Public endpoint (verify_jwt=false), reached via
//   https://optionmarkettraders.com/api/mpesa/b2c/result   (ResultURL)
//   https://optionmarkettraders.com/api/mpesa/b2c/timeout  (QueueTimeOutURL → ?kind=timeout)
// Daraja callbacks are unsigned, so the payload is only ever matched to OUR ids (OriginatorConversationID =
// withdrawal reference, or the ConversationID we stored when Safaricom accepted the request). Unknown or
// malformed bodies are logged and ignored. Safaricom always gets HTTP 200 {"ResultCode":0,"ResultDesc":"Accepted"}.
//
//   ResultCode 0  → complete_withdrawal with TransactionReceipt (money has been sent)
//   non-zero      → fail_withdrawal (refund)
//   timeout       → fail_withdrawal (refund) if still open; a later success for a refunded row is flagged for review.

const MAX_BODY_BYTES = 32 * 1024

function accepted() {
  return new Response(JSON.stringify({ ResultCode: 0, ResultDesc: 'Accepted' }), {
    status: 200,
    headers: { 'Content-Type': 'application/json' },
  })
}

async function handle(rawBody: string, kind: 'result' | 'timeout') {
  let payload: unknown = null
  try {
    payload = JSON.parse(rawBody)
  } catch {
    payload = null
  }
  const parsed = parseB2cResult(payload)
  if (!parsed.ok) {
    console.log('b2c callback ignored', kind, parsed.error)
    return
  }

  const admin = adminClient()
  const row = await findWithdrawalByConversation(admin, parsed.originatorConversationId, parsed.conversationId)
  if (!row) {
    console.log('b2c callback: no matching withdrawal', kind, parsed.resultCode)
    return
  }
  console.log('b2c callback', kind, row.id, row.status, parsed.resultCode, parsed.receipt ?? '-')

  const raw = {
    source: kind === 'timeout' ? 'daraja_b2c_timeout' : 'daraja_b2c_result',
    result_code: String(parsed.resultCode),
    result_desc: parsed.resultDesc.slice(0, 300),
    conversation_id: parsed.conversationId,
    transaction_id: parsed.transactionId,
    amount_kes: parsed.amountKes,
    receiver: parsed.receiverName,
    completed_at: parsed.completedAt,
    received_at: new Date().toISOString(),
  }

  // Remember Safaricom's ConversationID if we only knew the originator id so far.
  if (parsed.conversationId && !row.conversation_id) {
    await admin.from('withdrawals').update({ conversation_id: parsed.conversationId }).eq('id', row.id).is('conversation_id', null)
  }

  if (!isOpenWithdrawalStatus(row.status)) {
    // Already final. A success after a timeout refund means Safaricom paid after we refunded: flag it.
    if (kind === 'result' && parsed.outcome === 'completed' && row.status === 'FAILED') {
      console.error('b2c late success after refund — MANUAL REVIEW', row.id, parsed.receipt)
      await admin
        .from('withdrawals')
        .update({
          admin_note: `REVIEW: B2C reported success (receipt ${parsed.receipt ?? '?'}) after this request was refunded.`,
          details: { ...(row.details ?? {}), late_result: raw },
        })
        .eq('id', row.id)
    } else {
      console.log('b2c callback for final withdrawal ignored', row.id, row.status)
    }
    return
  }

  if (kind === 'timeout') {
    const { error } = await admin.rpc('fail_withdrawal', {
      p_withdrawal_id: row.id,
      p_reason: 'M-Pesa did not process the payout in time',
      p_admin_user_id: null,
      p_raw: raw,
    })
    if (error) console.error('fail_withdrawal (timeout) failed', row.id, error.message)
    else console.log('b2c timeout → refunded', row.id)
    return
  }

  if (parsed.outcome === 'completed') {
    if (parsed.amountKes != null && Number(row.net_kes) !== parsed.amountKes) {
      // Paid amount differs from what we asked for: never auto-complete, leave for the admin.
      console.error('b2c amount mismatch — MANUAL REVIEW', row.id, parsed.amountKes, row.net_kes)
      await admin
        .from('withdrawals')
        .update({
          admin_note: `REVIEW: B2C paid KES ${parsed.amountKes} but KES ${row.net_kes} was requested (receipt ${parsed.receipt ?? '?'}).`,
          result_code: String(parsed.resultCode),
          result_desc: parsed.resultDesc.slice(0, 300),
          details: { ...(row.details ?? {}), result: raw },
        })
        .eq('id', row.id)
      return
    }
    if (!parsed.receipt) {
      console.error('b2c success without receipt — MANUAL REVIEW', row.id)
      await admin
        .from('withdrawals')
        .update({ admin_note: 'REVIEW: B2C reported success without a TransactionReceipt.', details: { ...(row.details ?? {}), result: raw } })
        .eq('id', row.id)
      return
    }
    const { error } = await admin.rpc('complete_withdrawal', {
      p_withdrawal_id: row.id,
      p_receipt: parsed.receipt,
      p_admin_user_id: null,
      p_note: null,
      p_raw: raw,
    })
    if (error) console.error('complete_withdrawal failed', row.id, error.message)
    else console.log('b2c completed', row.id, parsed.receipt)
    return
  }

  const { error } = await admin.rpc('fail_withdrawal', {
    p_withdrawal_id: row.id,
    p_reason: (parsed.resultDesc || 'M-Pesa rejected the payout').slice(0, 200),
    p_admin_user_id: null,
    p_raw: raw,
  })
  if (error) console.error('fail_withdrawal (result) failed', row.id, error.message)
  else console.log('b2c failed → refunded', row.id, parsed.resultCode)
  const fresh = await loadWithdrawal(admin, row.id)
  if (fresh) console.log('b2c settled', row.id, fresh.status)
}

Deno.serve(async (req) => {
  if (req.method === 'GET' || req.method === 'HEAD') {
    return new Response(JSON.stringify({ status: 'ok', service: 'mpesa-b2c-result' }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    })
  }
  if (req.method !== 'POST') return accepted()

  const kind = new URL(req.url).searchParams.get('kind') === 'timeout' ? 'timeout' : 'result'
  let rawBody = ''
  try {
    const declared = Number(req.headers.get('content-length') ?? '0')
    if (declared <= MAX_BODY_BYTES) rawBody = await req.text()
  } catch {
    rawBody = ''
  }
  if (!rawBody || rawBody.length > MAX_BODY_BYTES) {
    console.log('b2c callback ignored', kind, rawBody ? 'too_large' : 'empty_body')
    return accepted()
  }

  EdgeRuntime.waitUntil(handle(rawBody, kind).catch((err) => console.error('b2c callback processing failed', String(err).slice(0, 200))))
  return accepted()
})
