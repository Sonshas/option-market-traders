import 'jsr:@supabase/functions-js/edge-runtime.d.ts'
import { DarajaAuthError } from '../_shared/daraja-server.ts'
import { maskPhone } from '../_shared/megapay.ts'
import { adminClient, corsHeaders, json } from '../_shared/server.ts'
import {
  WITHDRAWAL_COLUMNS,
  b2cActive,
  b2cConfigured,
  b2cPaymentRequest,
  withdrawConfig,
  type WithdrawalRow,
} from '../_shared/withdraw-server.ts'

// verify_jwt=false; authenticated only by x-sweep-secret (Vault real_trade_sweep_secret), called by pg_cron every
// minute. Sends PENDING withdrawals through Daraja B2C when WITHDRAWAL_MODE=daraja_b2c and the B2C secrets exist.
// Otherwise it does nothing and rows stay PENDING for manual payout in /admin/withdrawals.
//
// Money safety: a row is moved to PROCESSING (atomic, PENDING-only) BEFORE the B2C call so it can never be sent
// twice. A rejected request is failed + refunded. A network error / timeout after sending is AMBIGUOUS, so the row
// stays PROCESSING with a note for the admin to check the M-Pesa portal; it is never refunded automatically.

const BATCH = 10

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders })
  if (req.method === 'GET' || req.method === 'HEAD') return json({ status: 'ok', service: 'mpesa-withdraw-dispatch' })
  if (req.method !== 'POST') return json({ error: 'Method not allowed' }, 405)

  const admin = adminClient()
  const sweepSecret = req.headers.get('x-sweep-secret')
  if (!sweepSecret) return json({ error: 'Unauthorized' }, 401)
  const { data: valid } = await admin.rpc('verify_real_trade_sweep_secret', { p_secret: sweepSecret })
  if (valid !== true) return json({ error: 'Unauthorized' }, 401)

  const cfg = withdrawConfig()
  if (!b2cActive(cfg)) {
    const reason = cfg.mode !== 'daraja_b2c' ? `mode=${cfg.mode}` : 'B2C not configured'
    console.log('withdraw dispatch skipped:', reason)
    return json({ mode: cfg.mode, configured: b2cConfigured(cfg), dispatched: 0, skipped: reason })
  }

  const { data, error } = await admin
    .from('withdrawals')
    .select(WITHDRAWAL_COLUMNS)
    .eq('account_mode', 'real')
    .eq('is_simulated', false)
    .eq('status', 'PENDING')
    .is('conversation_id', null)
    .order('created_at', { ascending: true })
    .limit(BATCH)
  if (error) {
    console.error('withdraw dispatch query failed', error.message)
    return json({ error: 'query failed' }, 500)
  }

  const results: Array<{ id: string; outcome: string }> = []
  for (const row of (data ?? []) as WithdrawalRow[]) {
    if (!row.msisdn || !row.net_kes || !row.reference) {
      results.push({ id: row.id, outcome: 'skipped_incomplete_row' })
      continue
    }
    // Claim the row (PENDING → PROCESSING). If another run already claimed it, 'already' is true and we skip.
    const { data: claimed, error: claimError } = await admin.rpc('mark_withdrawal_processing', {
      p_withdrawal_id: row.id,
      p_admin_user_id: null,
      p_note: 'Sent via Daraja B2C',
      p_provider: 'daraja_b2c',
      p_conversation_id: null,
    })
    if (claimError || (claimed as Record<string, unknown> | null)?.already === true) {
      results.push({ id: row.id, outcome: claimError ? `claim_failed: ${claimError.message.slice(0, 80)}` : 'already_processing' })
      continue
    }

    try {
      const res = await b2cPaymentRequest(cfg, { reference: row.reference, amountKes: Number(row.net_kes), msisdn: row.msisdn })
      const conversationId = typeof res.body.ConversationID === 'string' ? res.body.ConversationID.trim() : ''
      const accepted = res.httpStatus >= 200 && res.httpStatus < 300 && String(res.body.ResponseCode ?? '') === '0' && conversationId
      if (accepted) {
        await admin
          .from('withdrawals')
          .update({ conversation_id: conversationId, details: { ...(row.details ?? {}), b2c_accepted_at: new Date().toISOString() } })
          .eq('id', row.id)
        console.log('b2c sent', row.id, maskPhone(row.msisdn), row.net_kes, conversationId)
        results.push({ id: row.id, outcome: 'sent' })
        continue
      }

      const duplicate = String(res.body.errorCode ?? '') === '500.002.1001'
      if (duplicate) {
        // Daraja already has this OriginatorConversationID: a previous attempt did reach Safaricom. Leave PROCESSING.
        console.error('b2c duplicate originator, leaving PROCESSING for review', row.id)
        await admin
          .from('withdrawals')
          .update({ admin_note: 'B2C reported a duplicate OriginatorConversationID — check the M-Pesa portal before acting.' })
          .eq('id', row.id)
        results.push({ id: row.id, outcome: 'duplicate_review' })
        continue
      }

      const reason = String(res.body.errorMessage ?? res.body.ResponseDescription ?? 'M-Pesa rejected the payout request').slice(0, 200)
      const { error: failError } = await admin.rpc('fail_withdrawal', {
        p_withdrawal_id: row.id,
        p_reason: reason,
        p_admin_user_id: null,
        p_raw: { source: 'daraja_b2c_request', http_status: res.httpStatus, body: res.body },
      })
      if (failError) console.error('fail_withdrawal after b2c reject failed', row.id, failError.message)
      console.log('b2c rejected', row.id, res.httpStatus, reason)
      results.push({ id: row.id, outcome: 'rejected_refunded' })
    } catch (err) {
      if (err instanceof DarajaAuthError) {
        // We never reached the B2C endpoint: safe to refund.
        const { error: failError } = await admin.rpc('fail_withdrawal', {
          p_withdrawal_id: row.id,
          p_reason: 'M-Pesa authorization failed',
          p_admin_user_id: null,
          p_raw: { source: 'daraja_b2c_oauth', oauth_status: err.httpStatus },
        })
        if (failError) console.error('fail_withdrawal after oauth error failed', row.id, failError.message)
        console.error('b2c oauth failed', row.id, err.httpStatus)
        results.push({ id: row.id, outcome: 'oauth_failed_refunded' })
      } else {
        // Ambiguous (timeout / network): the request may have been accepted. Keep PROCESSING for admin review.
        console.error('b2c request error, leaving PROCESSING for review', row.id, String(err).slice(0, 200))
        await admin
          .from('withdrawals')
          .update({ admin_note: 'B2C request timed out — check the M-Pesa portal (B2C statement) before completing or failing.' })
          .eq('id', row.id)
        results.push({ id: row.id, outcome: 'ambiguous_review' })
      }
    }
  }

  if (results.length) console.log('withdraw dispatch', JSON.stringify(results))
  return json({ mode: cfg.mode, configured: true, dispatched: results.filter((r) => r.outcome === 'sent').length, results })
})
