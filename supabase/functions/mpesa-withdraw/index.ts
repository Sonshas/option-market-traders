import 'jsr:@supabase/functions-js/edge-runtime.d.ts'
import { maskPhone, normalizeKenyanPhone } from '../_shared/megapay.ts'
import { adminClient, corsHeaders, json, userFromRequest } from '../_shared/server.ts'
import {
  b2cActive,
  hasSettledRealTrade,
  loadWithdrawal,
  publicWithdrawal,
  requestErrorMessage,
  withdrawConfig,
} from '../_shared/withdraw-server.ts'
import {
  NO_REAL_TRADE_MESSAGE,
  generateWithdrawalReference,
  minUsdFor,
  processingTimeCopy,
  validateWithdrawalAmountUsd,
} from '../_shared/withdrawals.ts'

// Auth required (verify_jwt on).
//  GET  → withdrawal config for the panel: mode, rate, KES limits, fee (shown BEFORE submit), processing-time copy.
//  POST {amount_usd, phone} → request_real_withdrawal (hold + PENDING row). Nothing here ever marks a payout as done:
//         COMPLETED only comes from the B2C result callback or an admin recording the M-Pesa receipt.

const UNAVAILABLE = 'Withdrawals temporarily unavailable'

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders })

  const cfg = withdrawConfig()
  const admin = adminClient()
  const user = await userFromRequest(admin, req)
  if (!user) return json({ error: 'Sign in to withdraw.' }, 401)

  const { data: flag } = await admin.from('feature_flags').select('value').eq('key', 'REAL_WITHDRAWALS_ENABLED').maybeSingle()
  const enabled = flag == null || flag.value === true
  const activeMode = b2cActive(cfg) ? 'daraja_b2c' : 'manual'

  if (req.method === 'GET') {
    const hasRealTrade = await hasSettledRealTrade(admin, user.id)
    return json({
      enabled,
      has_real_trade: hasRealTrade,
      eligibility_message: hasRealTrade ? null : NO_REAL_TRADE_MESSAGE,
      mode: activeMode,
      method: 'mpesa',
      currency: 'USD',
      kes_per_usd: cfg.kesPerUsd,
      min_kes: cfg.minKes,
      max_kes: cfg.maxKes,
      min_usd: minUsdFor(cfg),
      fee_kes: cfg.feeKes,
      processing_copy: processingTimeCopy(activeMode),
      message: enabled ? null : 'Withdrawals are paused for maintenance. Please try again later.',
    })
  }
  if (req.method !== 'POST') return json({ error: 'Method not allowed' }, 405)
  if (!enabled) return json({ error: 'Withdrawals are paused for maintenance. Please try again later.' }, 503)

  let body: Record<string, unknown>
  try {
    body = await req.json()
  } catch {
    return json({ error: 'Invalid request.' }, 400)
  }

  const msisdn = normalizeKenyanPhone(String(body.phone ?? ''))
  if (!msisdn) return json({ error: 'Enter a valid Safaricom M-Pesa number, e.g. 0712345678.' }, 400)
  if (!(await hasSettledRealTrade(admin, user.id))) return json({ error: NO_REAL_TRADE_MESSAGE }, 403)

  const { data: wallet, error: walletError } = await admin
    .from('wallets')
    .select('id, available_balance, currency, status')
    .eq('user_id', user.id)
    .eq('account_mode', 'real')
    .eq('is_simulated', false)
    .maybeSingle()
  if (walletError || !wallet) return json({ error: 'Your REAL wallet is not ready yet. Please contact support.' }, 409)

  const available = Number(wallet.available_balance)
  const amount = validateWithdrawalAmountUsd(body.amount_usd, cfg, Number.isFinite(available) ? available : null)
  if (!amount.ok) return json({ error: amount.error }, 400)

  // The DB function re-validates everything under a wallet lock and is the only place that moves money.
  let result: Record<string, unknown> | null = null
  let lastError: string | null = null
  for (let attempt = 0; attempt < 3 && !result; attempt++) {
    const reference = generateWithdrawalReference()
    const { data, error } = await admin.rpc('request_real_withdrawal', {
      p_user_id: user.id,
      p_amount_usd: amount.amountUsd,
      p_msisdn: msisdn,
      p_kes_per_usd: cfg.kesPerUsd,
      p_fee_kes: cfg.feeKes,
      p_min_kes: cfg.minKes,
      p_max_kes: cfg.maxKes,
      p_provider: activeMode,
      p_reference: reference,
    })
    if (!error && data) {
      result = data as Record<string, unknown>
      break
    }
    lastError = error?.message ?? 'unknown'
    // A reference collision is the only retryable failure.
    if (!/duplicate key|withdrawals_reference_uniq/i.test(lastError)) break
  }

  if (!result) {
    const mapped = requestErrorMessage(lastError ?? '', cfg)
    if (mapped.status >= 500) console.error('request_real_withdrawal failed', user.id, lastError)
    else console.log('withdrawal rejected', user.id, mapped.status, lastError)
    return json({ error: mapped.status >= 500 ? UNAVAILABLE : mapped.error }, mapped.status)
  }

  const id = String(result.withdrawal_id)
  const row = await loadWithdrawal(admin, id)
  console.log('withdrawal requested', id, maskPhone(msisdn), result.net_kes, activeMode)

  if (!row) return json({ withdrawal_id: id, reference: result.reference, status: 'PENDING' })
  return json({
    ...publicWithdrawal(row),
    mode: activeMode,
    processing_copy: processingTimeCopy(activeMode),
    message: 'Request received.',
  })
})
