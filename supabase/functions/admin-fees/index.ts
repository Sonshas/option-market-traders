import 'jsr:@supabase/functions-js/edge-runtime.d.ts'
import type { SupabaseClient, User } from 'npm:@supabase/supabase-js@2'
import { isDashboardStaffRole } from '../_shared/admin-dashboard.ts'
import {
  FALLBACK_PAYOUT_DESK,
  hostFeesFromMaps,
  paymentRowsFromHost,
  tradingRowsFromHost,
  validateHostFeePatch,
  validatePayoutDeskFeePatch,
  type DepositFeeSettings,
  type HostFeeSettings,
  type PayoutDeskFeeSettings,
  type SettingsMap,
  type TradingFeeSettings,
  type WithdrawalFeeSettings,
} from '../_shared/payment-settings.ts'
import { payoutAdminClient } from '../_shared/payout-desk.ts'
import { adminClient, corsHeaders, json, recordSystemIssue, userFromRequest } from '../_shared/server.ts'
import { parseMegapayConfig } from '../_shared/megapay.ts'
import { parseWithdrawalConfig } from '../_shared/withdrawals.ts'

// Staff-only (admin / superadmin / finance). GET loads host payment_settings + trading_settings
// and payout-desk payout_settings. POST upserts the same. Secrets (Daraja keys) stay in env.

function appRole(user: User): string {
  const meta = (user.app_metadata ?? {}) as Record<string, unknown>
  return typeof meta.role === 'string' ? meta.role.trim() : ''
}

async function loadTextMap(admin: SupabaseClient, table: 'payment_settings' | 'trading_settings'): Promise<SettingsMap> {
  const { data, error } = await admin.from(table).select('key, value')
  if (error) {
    console.error('admin-fees load', table, error.message)
    throw new Error(`${table} query failed`)
  }
  const map: SettingsMap = {}
  for (const row of data ?? []) {
    const key = String((row as { key?: unknown }).key ?? '')
    if (!key) continue
    map[key] = String((row as { value?: unknown }).value ?? '')
  }
  return map
}

function payoutFromRow(row: Record<string, unknown> | null): PayoutDeskFeeSettings | null {
  if (!row) return null
  return {
    minWithdrawUsd: Number(row.min_withdraw_usd ?? row.minWithdrawUsd),
    withdrawalFeePercent: Number(row.withdrawal_fee_percent ?? row.withdrawalFeePercent),
    kesPerUsdWithdrawal: Number(row.kes_per_usd_withdrawal ?? row.kesPerUsdWithdrawal),
    kesPerUsdDeposit: Number(row.kes_per_usd_deposit ?? row.kesPerUsdDeposit),
    mpesaCapKes: Number(row.mpesa_cap_kes ?? row.mpesaCapKes),
    taxFeeUsd: Number(row.tax_fee_usd ?? row.taxFeeUsd),
    botFeeUsd: Number(row.bot_fee_usd ?? row.botFeeUsd),
    previewStkConfirm: row.preview_stk_confirm === true || row.previewStkConfirm === true,
  }
}

async function loadPayoutDesk(): Promise<{ configured: boolean; settings: PayoutDeskFeeSettings | null; error: string | null }> {
  const payout = payoutAdminClient()
  if (!payout) return { configured: false, settings: null, error: 'Payout desk Supabase is not configured on this host.' }
  const { data, error } = await payout.from('payout_settings').select('*').eq('id', 1).maybeSingle()
  if (error) {
    console.error('admin-fees payout_settings', error.message)
    return { configured: true, settings: null, error: 'Could not load payout desk fees.' }
  }
  return { configured: true, settings: payoutFromRow((data as Record<string, unknown> | null) ?? null), error: null }
}

async function loadHost(admin: SupabaseClient): Promise<HostFeeSettings> {
  const env = Deno.env.toObject()
  const [payment, trading] = await Promise.all([loadTextMap(admin, 'payment_settings'), loadTextMap(admin, 'trading_settings')])
  return hostFeesFromMaps(payment, trading, {
    deposit: parseMegapayConfig(env),
    withdrawal: parseWithdrawalConfig(env),
  })
}

async function saveHost(
  admin: SupabaseClient,
  deposit: DepositFeeSettings,
  withdrawal: WithdrawalFeeSettings,
  trading: TradingFeeSettings,
): Promise<void> {
  const now = new Date().toISOString()
  const paymentRows = paymentRowsFromHost(deposit, withdrawal).map((row) => ({ ...row, updated_at: now }))
  const tradingRows = tradingRowsFromHost(trading).map((row) => ({ ...row, updated_at: now }))
  const { error: payErr } = await admin.from('payment_settings').upsert(paymentRows, { onConflict: 'key' })
  if (payErr) {
    console.error('admin-fees payment upsert', payErr.message)
    throw new Error('Could not save deposit/withdrawal fees.')
  }
  const { error: tradeErr } = await admin.from('trading_settings').upsert(tradingRows, { onConflict: 'key' })
  if (tradeErr) {
    console.error('admin-fees trading upsert', tradeErr.message)
    throw new Error('Could not save trading fees.')
  }
}

async function savePayoutDesk(patch: PayoutDeskFeeSettings): Promise<PayoutDeskFeeSettings> {
  const payout = payoutAdminClient()
  if (!payout) throw new Error('Payout desk Supabase is not configured on this host.')
  const { data, error } = await payout
    .from('payout_settings')
    .update({
      min_withdraw_usd: patch.minWithdrawUsd,
      withdrawal_fee_percent: patch.withdrawalFeePercent,
      kes_per_usd_withdrawal: patch.kesPerUsdWithdrawal,
      kes_per_usd_deposit: patch.kesPerUsdDeposit,
      mpesa_cap_kes: patch.mpesaCapKes,
      tax_fee_usd: patch.taxFeeUsd,
      bot_fee_usd: patch.botFeeUsd,
      preview_stk_confirm: patch.previewStkConfirm,
    })
    .eq('id', 1)
    .select('*')
    .maybeSingle()
  if (error || !data) {
    console.error('admin-fees payout update', error?.message ?? 'missing')
    throw new Error('Could not save payout desk fees.')
  }
  const saved = payoutFromRow(data as Record<string, unknown>)
  if (!saved) throw new Error('Could not save payout desk fees.')
  return saved
}

function asPartialRecord(value: unknown): Record<string, unknown> | null {
  if (value && typeof value === 'object' && !Array.isArray(value)) return value as Record<string, unknown>
  return null
}

function numOrUndefined(value: unknown): number | undefined {
  if (value == null || value === '') return undefined
  const n = Number(value)
  return Number.isFinite(n) ? n : Number.NaN
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders })
  if (req.method !== 'GET' && req.method !== 'POST') return json({ error: 'Method not allowed' }, 405)

  const admin = adminClient()
  const user = await userFromRequest(admin, req)
  if (!user) return json({ error: 'Sign in as staff.' }, 401)
  if (!isDashboardStaffRole(appRole(user))) {
    console.log('admin-fees forbidden', user.id, appRole(user) || 'trader')
    return json({ error: 'Forbidden' }, 403)
  }

  try {
    if (req.method === 'GET') {
      const [host, payoutDesk] = await Promise.all([loadHost(admin), loadPayoutDesk()])
      return json({
        ok: true,
        host,
        payout_desk: {
          configured: payoutDesk.configured,
          settings: payoutDesk.settings,
          error: payoutDesk.error,
          fallback: FALLBACK_PAYOUT_DESK,
        },
      })
    }

    let body: Record<string, unknown> = {}
    try {
      body = await req.json()
    } catch {
      return json({ error: 'Invalid request.' }, 400)
    }

    const currentHost = await loadHost(admin)
    const depositIn = asPartialRecord(body.deposit)
    const withdrawalIn = asPartialRecord(body.withdrawal)
    const tradingIn = asPartialRecord(body.trading)
    const payoutIn = asPartialRecord(body.payout_desk ?? body.payoutDesk)

    const nextDeposit: DepositFeeSettings = {
      ...currentHost.deposit,
      ...(depositIn
        ? {
            kesPerUsd: numOrUndefined(depositIn.kesPerUsd) ?? currentHost.deposit.kesPerUsd,
            minKes: numOrUndefined(depositIn.minKes) ?? currentHost.deposit.minKes,
            maxKes: numOrUndefined(depositIn.maxKes) ?? currentHost.deposit.maxKes,
            quickAmounts:
              typeof depositIn.quickAmounts === 'string' ? depositIn.quickAmounts : currentHost.deposit.quickAmounts,
          }
        : {}),
    }
    const nextWithdrawal: WithdrawalFeeSettings = {
      ...currentHost.withdrawal,
      ...(withdrawalIn
        ? {
            kesPerUsd: numOrUndefined(withdrawalIn.kesPerUsd) ?? currentHost.withdrawal.kesPerUsd,
            minKes: numOrUndefined(withdrawalIn.minKes) ?? currentHost.withdrawal.minKes,
            maxKes: numOrUndefined(withdrawalIn.maxKes) ?? currentHost.withdrawal.maxKes,
            feeKes: numOrUndefined(withdrawalIn.feeKes) ?? currentHost.withdrawal.feeKes,
          }
        : {}),
    }
    const nextTrading: TradingFeeSettings = {
      ...currentHost.trading,
      ...(tradingIn
        ? {
            stakeMinUsd: numOrUndefined(tradingIn.stakeMinUsd) ?? currentHost.trading.stakeMinUsd,
            stakeMaxUsd: numOrUndefined(tradingIn.stakeMaxUsd) ?? currentHost.trading.stakeMaxUsd,
            maxOpenTrades: numOrUndefined(tradingIn.maxOpenTrades) ?? currentHost.trading.maxOpenTrades,
            dailyProfitLimitUsd:
              numOrUndefined(tradingIn.dailyProfitLimitUsd) ?? currentHost.trading.dailyProfitLimitUsd,
          }
        : {}),
    }

    const hostErrors = validateHostFeePatch({
      deposit: nextDeposit,
      withdrawal: nextWithdrawal,
      trading: nextTrading,
    })
    if (hostErrors.length) return json({ error: hostErrors[0]!.message, fields: hostErrors }, 400)

    await saveHost(admin, nextDeposit, nextWithdrawal, nextTrading)

    let payoutSettings: PayoutDeskFeeSettings | null = null
    let payoutError: string | null = null
    const payoutLoaded = await loadPayoutDesk()
    if (payoutIn && payoutLoaded.configured) {
      const nextPayout: PayoutDeskFeeSettings = {
        ...(payoutLoaded.settings ?? FALLBACK_PAYOUT_DESK),
        minWithdrawUsd: numOrUndefined(payoutIn.minWithdrawUsd) ?? (payoutLoaded.settings ?? FALLBACK_PAYOUT_DESK).minWithdrawUsd,
        withdrawalFeePercent:
          numOrUndefined(payoutIn.withdrawalFeePercent) ?? (payoutLoaded.settings ?? FALLBACK_PAYOUT_DESK).withdrawalFeePercent,
        kesPerUsdWithdrawal:
          numOrUndefined(payoutIn.kesPerUsdWithdrawal) ?? (payoutLoaded.settings ?? FALLBACK_PAYOUT_DESK).kesPerUsdWithdrawal,
        kesPerUsdDeposit:
          numOrUndefined(payoutIn.kesPerUsdDeposit) ?? (payoutLoaded.settings ?? FALLBACK_PAYOUT_DESK).kesPerUsdDeposit,
        mpesaCapKes: numOrUndefined(payoutIn.mpesaCapKes) ?? (payoutLoaded.settings ?? FALLBACK_PAYOUT_DESK).mpesaCapKes,
        taxFeeUsd: numOrUndefined(payoutIn.taxFeeUsd) ?? (payoutLoaded.settings ?? FALLBACK_PAYOUT_DESK).taxFeeUsd,
        botFeeUsd: numOrUndefined(payoutIn.botFeeUsd) ?? (payoutLoaded.settings ?? FALLBACK_PAYOUT_DESK).botFeeUsd,
        previewStkConfirm:
          typeof payoutIn.previewStkConfirm === 'boolean'
            ? payoutIn.previewStkConfirm
            : (payoutLoaded.settings ?? FALLBACK_PAYOUT_DESK).previewStkConfirm,
      }
      const payoutErrors = validatePayoutDeskFeePatch(nextPayout)
      if (payoutErrors.length) return json({ error: payoutErrors[0]!.message, fields: payoutErrors }, 400)
      try {
        payoutSettings = await savePayoutDesk(nextPayout)
      } catch (err) {
        payoutError = err instanceof Error ? err.message : 'Could not save payout desk fees.'
      }
    } else {
      payoutSettings = payoutLoaded.settings
      payoutError = payoutLoaded.error
    }

    const host = await loadHost(admin)
    console.log('admin-fees saved', user.id)
    return json({
      ok: true,
      message: payoutError ? `Host fees saved. Payout desk: ${payoutError}` : 'All fees saved.',
      host,
      payout_desk: {
        configured: payoutLoaded.configured,
        settings: payoutSettings,
        error: payoutError,
        fallback: FALLBACK_PAYOUT_DESK,
      },
    })
  } catch (err) {
    console.error('admin-fees failed', err instanceof Error ? err.message : 'error')
    await recordSystemIssue(admin, {
      source: 'edge',
      area: 'admin',
      operation: 'admin-fees',
      message: err instanceof Error ? err.message : 'Unknown error',
    })
    return json({ error: 'Could not load fees. See System health for details.' }, 500)
  }
})
