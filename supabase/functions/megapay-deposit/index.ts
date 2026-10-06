import 'jsr:@supabase/functions-js/edge-runtime.d.ts'
import {
  MEGAPAY_PROVIDER,
  generateDepositReference,
  kesToUsd,
  maskPhone,
  normalizeKenyanPhone,
  validateAmountKes,
} from '../_shared/megapay.ts'
import {
  DEPOSIT_COLUMNS,
  UNAVAILABLE_MESSAGE,
  adminClient,
  corsHeaders,
  credentialsConfigured,
  initiateStk,
  json,
  publicDeposit,
  realPaymentsEnabled,
  serverConfig,
  userFromRequest,
  type DepositRow,
} from '../_shared/server.ts'

const RATE_LIMIT_WINDOW_MS = 5 * 60 * 1000
const RATE_LIMIT_MAX_PENDING = 3

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders })

  const cfg = serverConfig()
  const admin = adminClient()
  const user = await userFromRequest(admin, req)
  if (!user) return json({ error: 'Sign in to deposit.' }, 401)

  const enabled = await realPaymentsEnabled(admin)
  const configured = credentialsConfigured(cfg)

  if (req.method === 'GET') {
    return json({
      enabled: enabled && configured,
      provider: MEGAPAY_PROVIDER,
      method: 'mpesa',
      currency: 'USD',
      kes_per_usd: cfg.kesPerUsd,
      min_kes: cfg.minKes,
      max_kes: cfg.maxKes,
      message: enabled && configured ? null : UNAVAILABLE_MESSAGE,
    })
  }
  if (req.method !== 'POST') return json({ error: 'Method not allowed' }, 405)

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
    .eq('provider', MEGAPAY_PROVIDER)
    .eq('status', 'PENDING')
    .gte('created_at', since)
  if ((count ?? 0) >= RATE_LIMIT_MAX_PENDING) {
    return json({ error: 'You have several deposits waiting for M-Pesa. Please wait a few minutes and try again.' }, 429)
  }

  const amountUsd = kesToUsd(amount.amountKes, cfg.kesPerUsd)
  if (amountUsd <= 0) return json({ error: 'Amount is too small.' }, 400)

  let deposit: DepositRow | null = null
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
        provider: MEGAPAY_PROVIDER,
        is_simulated: false,
        details: {
          reference,
          amount_kes: amount.amountKes,
          rate: cfg.kesPerUsd,
          phone_masked: maskPhone(msisdn),
          initiated_at: new Date().toISOString(),
        },
      })
      .select(DEPOSIT_COLUMNS)
      .single()
    if (data) deposit = data as DepositRow
    else if (error?.code !== '23505') {
      console.error('deposit insert failed', error?.message)
      return json({ error: UNAVAILABLE_MESSAGE }, 500)
    }
  }
  if (!deposit) return json({ error: UNAVAILABLE_MESSAGE }, 500)
  const reference = String(deposit.details.reference)

  let requestId: string | null = null
  let failure: { kind: string; reason: string; raw: unknown } | null = null
  try {
    const res = await initiateStk(cfg, amount.amountKes, msisdn, reference)
    const id = res.body.transaction_request_id
    if (res.httpStatus >= 200 && res.httpStatus < 300 && typeof id === 'string' && id.trim()) {
      requestId = id.trim()
    } else {
      failure = { kind: 'initiation_failed', reason: String(res.body.massage ?? res.body.message ?? 'STK push rejected'), raw: res.body }
    }
  } catch (err) {
    // MegaPay may still have sent the STK push; "expired" lets a later confirmed payment be credited.
    failure = { kind: 'expired', reason: 'M-Pesa request timed out', raw: { error: String(err) } }
  }

  if (!requestId) {
    console.error('initiatestk failed', deposit.id, failure?.kind, failure?.reason)
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
    .update({ provider_reference: requestId, details: { ...deposit.details, megapay_request_id: requestId } })
    .eq('id', deposit.id)
  if (updateError) console.error('store request id failed', deposit.id, updateError.message)

  return json({
    ...publicDeposit({ ...deposit, provider_reference: requestId }),
    status: 'PENDING',
    message: 'Check your phone and enter your M-Pesa PIN.',
  })
})
