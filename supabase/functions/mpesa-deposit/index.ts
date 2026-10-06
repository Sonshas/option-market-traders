import 'jsr:@supabase/functions-js/edge-runtime.d.ts'
import { DARAJA_PROVIDER } from '../_shared/daraja.ts'
import { generateDepositReference, kesToUsd, maskPhone, normalizeKenyanPhone, validateAmountKes } from '../_shared/megapay.ts'
import {
  UNAVAILABLE_MESSAGE,
  adminClient,
  corsHeaders,
  json,
  publicDeposit,
  realPaymentsEnabled,
  userFromRequest,
} from '../_shared/server.ts'
import {
  DARAJA_DEPOSIT_COLUMNS,
  DarajaAuthError,
  darajaConfig,
  darajaConfigured,
  stkPush,
  type DarajaDepositRow,
} from '../_shared/daraja-server.ts'

// Auth required. GET also tells the web app which deposit provider is active (DEPOSIT_PROVIDER secret),
// so switching back to MegaPay needs no deploy.

const RATE_LIMIT_WINDOW_MS = 5 * 60 * 1000
const RATE_LIMIT_MAX_PENDING = 3

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders })

  const cfg = darajaConfig()
  const admin = adminClient()
  const user = await userFromRequest(admin, req)
  if (!user) return json({ error: 'Sign in to deposit.' }, 401)

  const enabled = await realPaymentsEnabled(admin)
  const configured = darajaConfigured(cfg)

  if (req.method === 'GET') {
    if (cfg.provider !== DARAJA_PROVIDER) return json({ provider: cfg.provider })
    return json({
      provider: DARAJA_PROVIDER,
      enabled: enabled && configured,
      method: 'mpesa',
      currency: 'USD',
      paybill: cfg.shortcode,
      kes_per_usd: cfg.kesPerUsd,
      min_kes: cfg.minKes,
      max_kes: cfg.maxKes,
      message: enabled && configured ? null : UNAVAILABLE_MESSAGE,
    })
  }
  if (req.method !== 'POST') return json({ error: 'Method not allowed' }, 405)

  if (cfg.provider !== DARAJA_PROVIDER) return json({ error: 'Deposit method changed. Please reopen the deposit form.' }, 409)
  if (!configured) return json({ error: UNAVAILABLE_MESSAGE }, 503)
  if (!enabled) return json({ error: 'Real deposits are not enabled yet.' }, 403)

  let body: Record<string, unknown>
  try {
    body = await req.json()
  } catch {
    return json({ error: 'Invalid request.' }, 400)
  }

  const amount = validateAmountKes(body.amount_kes, cfg)
  if (!amount.ok) return json({ error: amount.error }, 400)
  const msisdn = normalizeKenyanPhone(String(body.phone ?? ''))
  if (!msisdn) return json({ error: 'Enter a valid Safaricom M-Pesa number, e.g. 0712345678.' }, 400)

  const { data: wallet, error: walletError } = await admin
    .from('wallets')
    .select('id, account_id, currency, is_simulated')
    .eq('user_id', user.id)
    .eq('account_mode', 'real')
    .eq('is_simulated', false)
    .maybeSingle()
  if (walletError || !wallet) return json({ error: 'Your REAL wallet is not ready yet. Please contact support.' }, 409)

  const since = new Date(Date.now() - RATE_LIMIT_WINDOW_MS).toISOString()
  const { count } = await admin
    .from('deposits')
    .select('id', { count: 'exact', head: true })
    .eq('user_id', user.id)
    .eq('provider', DARAJA_PROVIDER)
    .eq('status', 'PENDING')
    .gte('created_at', since)
  if ((count ?? 0) >= RATE_LIMIT_MAX_PENDING) {
    return json({ error: 'You have several deposits waiting for M-Pesa. Please wait a few minutes and try again.' }, 429)
  }

  const amountUsd = kesToUsd(amount.amountKes, cfg.kesPerUsd)
  if (amountUsd <= 0) return json({ error: 'Amount is too small.' }, 400)

  let deposit: DarajaDepositRow | null = null
  for (let attempt = 0; attempt < 3 && !deposit; attempt++) {
    const reference = generateDepositReference()
    const { data, error } = await admin
      .from('deposits')
      .insert({
        user_id: user.id,
        account_id: wallet.account_id,
        account_mode: 'real',
        wallet_id: wallet.id,
        amount: amountUsd,
        currency: wallet.currency || 'USD',
        method: 'mpesa',
        status: 'PENDING',
        provider: DARAJA_PROVIDER,
        is_simulated: false,
        details: {
          reference,
          amount_kes: amount.amountKes,
          rate: cfg.kesPerUsd,
          phone_masked: maskPhone(msisdn),
          paybill: cfg.shortcode,
          account_reference: cfg.accountReference,
          initiated_at: new Date().toISOString(),
        },
      })
      .select(DARAJA_DEPOSIT_COLUMNS)
      .single()
    if (data) deposit = data as DarajaDepositRow
    else if (error?.code !== '23505') {
      console.error('deposit insert failed', error?.message)
      return json({ error: UNAVAILABLE_MESSAGE }, 500)
    }
  }
  if (!deposit) return json({ error: UNAVAILABLE_MESSAGE }, 500)

  let ids: { merchant: string | null; checkout: string } | null = null
  let failure: { kind: string; reason: string; raw: unknown } | null = null
  try {
    const res = await stkPush(cfg, amount.amountKes, msisdn)
    const checkout = res.body.CheckoutRequestID
    if (res.httpStatus >= 200 && res.httpStatus < 300 && String(res.body.ResponseCode ?? '') === '0' && typeof checkout === 'string' && checkout.trim()) {
      ids = { merchant: typeof res.body.MerchantRequestID === 'string' ? res.body.MerchantRequestID : null, checkout: checkout.trim() }
    } else {
      failure = {
        kind: 'initiation_failed',
        reason: String(res.body.errorMessage ?? res.body.ResponseDescription ?? 'STK push rejected').slice(0, 200),
        raw: { http_status: res.httpStatus, errorCode: res.body.errorCode ?? null, ResponseCode: res.body.ResponseCode ?? null },
      }
    }
  } catch (err) {
    failure =
      err instanceof DarajaAuthError
        ? { kind: 'initiation_failed', reason: 'M-Pesa authorization failed', raw: { oauth_status: err.httpStatus } }
        : { kind: 'initiation_failed', reason: 'M-Pesa request timed out', raw: { error: String(err).slice(0, 200) } }
  }

  if (!ids) {
    console.error('stk push failed', deposit.id, maskPhone(msisdn), failure?.reason)
    await admin.rpc('fail_megapay_deposit', {
      p_deposit_id: deposit.id,
      p_status: 'FAILED',
      p_kind: failure?.kind ?? 'initiation_failed',
      p_reason: failure?.reason ?? 'STK push rejected',
      p_raw: failure?.raw ?? {},
    })
    return json(
      { error: 'We could not send the M-Pesa prompt. Check the number and try again.', deposit_id: deposit.id, status: 'FAILED' },
      502,
    )
  }

  const { error: updateError } = await admin
    .from('deposits')
    .update({ provider_reference: ids.checkout, checkout_request_id: ids.checkout, merchant_request_id: ids.merchant })
    .eq('id', deposit.id)
  if (updateError) console.error('store checkout id failed', deposit.id, updateError.message)
  console.log('stk push sent', deposit.id, maskPhone(msisdn), amount.amountKes)

  return json({
    ...publicDeposit(deposit),
    status: 'PENDING',
    message: 'Check your phone and enter your M-Pesa PIN.',
  })
})
