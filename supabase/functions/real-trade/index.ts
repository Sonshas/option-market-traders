import 'jsr:@supabase/functions-js/edge-runtime.d.ts'
import {
  DAILY_LIMIT_MESSAGE,
  HOUSE_MARGIN,
  REAL_MAX_OPEN_TRADES,
  REAL_STAKE_MAX,
  REAL_STAKE_MIN,
  REAL_TRADE_SYMBOLS,
  TICK_DURATION_DEFAULT,
  TICK_DURATION_MAX,
  TICK_DURATION_MIN,
  TRADE_DURATIONS,
  digitPayoutRate,
  validateRealTradeRequest,
} from '../_shared/digit-contracts.ts'
import { tradingFeesFromMap, type SettingsMap } from '../_shared/payment-settings.ts'
import {
  DerivSession,
  TRADE_COLUMNS,
  adminClient,
  corsHeaders,
  fetchFreshTick,
  json,
  userFromRequest,
} from '../_shared/trading-server.ts'

const REAL_TRADING_ENDED = 'Real trading has ended. You can still withdraw your REAL balance from the Wallet page.'

function placeErrors(stakeMin: number, stakeMax: number, maxOpen: number): Record<string, { status: number; message: string }> {
  return {
    real_trading_disabled: { status: 403, message: REAL_TRADING_ENDED },
    daily_limit_reached: { status: 403, message: DAILY_LIMIT_MESSAGE },
    insufficient_funds: { status: 400, message: 'Insufficient REAL balance for this stake.' },
    too_many_open_trades: {
      status: 429,
      message: `You already have ${maxOpen} open REAL trades. Wait for one to settle.`,
    },
    stale_entry_tick: { status: 503, message: 'The live price moved on before your trade could open. Please try again.' },
    invalid_stake: { status: 400, message: `Stake must be between $${stakeMin} and $${stakeMax}.` },
    invalid_duration: { status: 400, message: 'Select a valid duration (1–10 ticks).' },
    wallet_not_found: { status: 409, message: 'Your REAL wallet is not ready yet. Please contact support.' },
    wallet_not_ready: { status: 409, message: 'Your REAL wallet is not ready yet. Please contact support.' },
  }
}
const NOT_CHARGED = 'Could not place the trade. Your balance was not charged.'

async function loadTradingFees(admin: ReturnType<typeof adminClient>) {
  const { data, error } = await admin.from('trading_settings').select('key, value')
  if (error) console.error('trading_settings load', error.message)
  const map: SettingsMap = {}
  for (const row of data ?? []) {
    const key = String((row as { key?: unknown }).key ?? '')
    if (!key) continue
    map[key] = String((row as { value?: unknown }).value ?? '')
  }
  const fees = tradingFeesFromMap(map)
  return {
    stakeMin: fees.stakeMinUsd || REAL_STAKE_MIN,
    stakeMax: fees.stakeMaxUsd || REAL_STAKE_MAX,
    maxOpen: fees.maxOpenTrades || REAL_MAX_OPEN_TRADES,
    dailyLimit: fees.dailyProfitLimitUsd,
  }
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders })

  const admin = adminClient()
  const user = await userFromRequest(admin, req)
  if (!user) return json({ error: 'Sign in to trade.' }, 401)

  // The site is DEMO-only: no new REAL trades, whatever trading_settings says.
  const enabled = false
  const trading = await loadTradingFees(admin)
  const PLACE_ERRORS = placeErrors(trading.stakeMin, trading.stakeMax, trading.maxOpen)

  if (req.method === 'GET') {
    const { data: daily, error: dailyError } = await admin.rpc('real_trade_daily_status', { p_user_id: user.id })
    if (dailyError) console.error('real_trade_daily_status', user.id, dailyError.message)
    return json({
      enabled,
      house_margin: HOUSE_MARGIN,
      daily_limit_reached: daily?.reached === true,
      daily_limit_usd: daily?.limit ?? trading.dailyLimit,
      stake_min: trading.stakeMin,
      stake_max: trading.stakeMax,
      max_open_trades: trading.maxOpen,
      durations_ms: TRADE_DURATIONS.map((item) => item.ms),
      duration_ticks: { min: TICK_DURATION_MIN, max: TICK_DURATION_MAX, default: TICK_DURATION_DEFAULT },
      symbols: REAL_TRADE_SYMBOLS,
      message: enabled ? null : REAL_TRADING_ENDED,
    })
  }
  if (req.method !== 'POST') return json({ error: 'Method not allowed' }, 405)
  if (!enabled) return json({ error: PLACE_ERRORS.real_trading_disabled.message }, 403)

  let body: Record<string, unknown>
  try {
    body = await req.json()
  } catch {
    return json({ error: 'Invalid request.' }, 400)
  }
  if (!body || typeof body !== 'object' || Array.isArray(body)) return json({ error: 'Invalid request.' }, 400)

  const parsed = validateRealTradeRequest(body, { stakeMin: trading.stakeMin, stakeMax: trading.stakeMax })
  if (!parsed.ok) return json({ error: parsed.error }, 400)
  if (!enabled) return json({ error: PLACE_ERRORS.real_trading_disabled.message }, 403)
  const input = parsed.value

  // A retried request returns the original trade without touching Deriv or the wallet again.
  const { data: existing } = await admin
    .from('trades')
    .select(TRADE_COLUMNS)
    .eq('user_id', user.id)
    .eq('idempotency_key', input.idempotencyKey)
    .maybeSingle()
  if (existing) return json({ trade: existing, already: true })

  let session: DerivSession | null = null
  let entry = null
  try {
    session = await DerivSession.open()
    entry = await fetchFreshTick(session, input.symbol)
  } catch (err) {
    console.error('entry tick fetch failed', input.symbol, String(err))
  } finally {
    session?.close()
  }
  if (!entry) {
    return json({ error: 'Live price is unavailable right now. Your balance was not charged — please try again.' }, 503)
  }

  const common = {
    p_user_id: user.id,
    p_symbol: input.symbol,
    p_contract_type: input.contractType,
    p_contract_option: input.contractOption,
    p_selected_digit: input.selectedDigit,
    p_barrier: input.barrier,
    p_stake: input.stake,
    p_payout_rate: digitPayoutRate(input),
    p_entry_price: entry.price,
    p_entry_epoch: entry.epoch,
    p_pip_size: entry.pipSize,
    p_idempotency_key: input.idempotencyKey,
  }
  const rpcName = input.durationTicks != null ? 'place_real_tick_trade' : 'place_real_trade'
  const { data: placed, error } =
    input.durationTicks != null
      ? await admin.rpc(rpcName, { ...common, p_duration_ticks: input.durationTicks })
      : await admin.rpc(rpcName, { ...common, p_duration_ms: input.durationMs })
  if (error || !placed?.trade_id) {
    const known = error ? PLACE_ERRORS[error.message] : undefined
    if (!known) console.error(rpcName, user.id, error?.message)
    return json({ error: known?.message ?? NOT_CHARGED }, known?.status ?? 500)
  }

  const { data: trade } = await admin.from('trades').select(TRADE_COLUMNS).eq('id', placed.trade_id).single()
  return json({ trade, already: placed.already === true, entry_age_ms: Math.round(entry.ageMs) })
})
