import 'jsr:@supabase/functions-js/edge-runtime.d.ts'
import { parseStkCallback } from '../_shared/daraja.ts'
import { maskPhone } from '../_shared/megapay.ts'
import { adminClient } from '../_shared/server.ts'
import { darajaConfig, findByCheckoutRequestId, reconcileDarajaDeposit } from '../_shared/daraja-server.ts'

// Public endpoint (verify_jwt=false), reached via https://optionmarkettraders.com/api/mpesa/callback.
// Daraja callbacks are unsigned: the payload only identifies the deposit and supplies the receipt/amount;
// reconcileDarajaDeposit confirms with the STK Push Query before crediting anything.
// Safaricom must always get {"ResultCode":0,"ResultDesc":"Accepted"}.

const MAX_BODY_BYTES = 32 * 1024

function accepted() {
  return new Response(JSON.stringify({ ResultCode: 0, ResultDesc: 'Accepted' }), {
    status: 200,
    headers: { 'Content-Type': 'application/json' },
  })
}

async function handleCallback(rawBody: string) {
  let payload: unknown = null
  try {
    payload = JSON.parse(rawBody)
  } catch {
    payload = null
  }
  const cb = parseStkCallback(payload)
  if (!cb.ok) {
    console.log('mpesa callback ignored', cb.error)
    return
  }

  const admin = adminClient()
  const deposit = await findByCheckoutRequestId(admin, cb.checkoutRequestId)
  if (!deposit) {
    console.log('mpesa callback: no matching deposit', cb.resultCode)
    return
  }
  console.log('mpesa callback', deposit.id, cb.resultCode, cb.phone ? maskPhone(cb.phone) : '-', cb.receipt ?? '-')

  const update: Record<string, unknown> = {
    callback_at: new Date().toISOString(),
    result_code: String(cb.resultCode),
    result_desc: cb.resultDesc.slice(0, 300),
  }
  if (cb.outcome === 'completed') update.callback_amount_kes = cb.amountKes
  if (cb.merchantRequestId && !deposit.merchant_request_id) update.merchant_request_id = cb.merchantRequestId
  const { error } = await admin.from('deposits').update(update).eq('id', deposit.id)
  if (error) console.error('store callback failed', deposit.id, error.message)

  if (cb.outcome === 'completed' && cb.receipt) {
    // Duplicate receipts are rejected by the unique index; the deposit then stays uncredited for review.
    const { error: receiptError } = await admin
      .from('deposits')
      .update({ mpesa_receipt: cb.receipt })
      .eq('id', deposit.id)
      .is('mpesa_receipt', null)
    if (receiptError) console.error('store receipt failed', deposit.id, receiptError.code)
  }

  const fresh = (await findByCheckoutRequestId(admin, cb.checkoutRequestId)) ?? deposit
  const settled = await reconcileDarajaDeposit(admin, darajaConfig(), fresh, { force: true })
  console.log('mpesa callback settled', deposit.id, settled.status)
}

Deno.serve(async (req) => {
  if (req.method === 'GET' || req.method === 'HEAD') {
    return new Response(JSON.stringify({ status: 'ok', service: 'mpesa-callback' }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    })
  }
  if (req.method !== 'POST') return accepted()

  let rawBody = ''
  try {
    const declared = Number(req.headers.get('content-length') ?? '0')
    if (declared <= MAX_BODY_BYTES) rawBody = await req.text()
  } catch {
    rawBody = ''
  }
  if (!rawBody || rawBody.length > MAX_BODY_BYTES) {
    console.log('mpesa callback ignored', rawBody ? 'too_large' : 'empty_body')
    return accepted()
  }

  EdgeRuntime.waitUntil(handleCallback(rawBody).catch((err) => console.error('mpesa callback processing failed', String(err).slice(0, 200))))
  return accepted()
})
