import 'jsr:@supabase/functions-js/edge-runtime.d.ts'
import { DARAJA_PROVIDER } from '../_shared/daraja.ts'
import { adminClient, corsHeaders, json, publicDeposit, userFromRequest } from '../_shared/server.ts'
import {
  DarajaAuthError,
  darajaConfig,
  darajaConfigured,
  getAccessToken,
  loadDarajaDeposit,
  reconcileDarajaDeposit,
  sweepDarajaDeposits,
  type DarajaDepositRow,
} from '../_shared/daraja-server.ts'

// verify_jwt=false. Callers:
//  - a signed-in user polling their own Daraja deposit (STK-queried after ~30 s if no callback arrived);
//  - the pg_cron sweep / operator health check, authenticated by x-sweep-secret (value kept only in Vault).

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

function view(d: DarajaDepositRow) {
  return { ...publicDeposit(d), receipt: d.mpesa_receipt ?? publicDeposit(d).receipt }
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders })
  if (req.method !== 'POST') return json({ error: 'Method not allowed' }, 405)

  const admin = adminClient()
  let body: Record<string, unknown> = {}
  try {
    body = await req.json()
  } catch {
    body = {}
  }

  const sweepSecret = req.headers.get('x-sweep-secret')
  if (sweepSecret) {
    const { data: valid } = await admin.rpc('verify_real_trade_sweep_secret', { p_secret: sweepSecret })
    if (valid !== true) return json({ error: 'Unauthorized' }, 401)
    const cfg = darajaConfig()

    if (body.mode === 'health') {
      const base = { provider: cfg.provider, env: cfg.env, configured: darajaConfigured(cfg), callback_url: cfg.callbackUrl }
      if (!darajaConfigured(cfg)) return json({ ...base, oauth: 'not_configured' })
      try {
        await getAccessToken(cfg, true)
        console.log('daraja oauth health: ok')
        return json({ ...base, oauth: 'ok' })
      } catch (err) {
        const status = err instanceof DarajaAuthError ? err.httpStatus : null
        const message = err instanceof Error ? err.message : String(err)
        console.error('daraja oauth health: failed', status)
        return json({ ...base, oauth: 'failed', http_status: status, message: message.slice(0, 200) })
      }
    }

    try {
      const results = await sweepDarajaDeposits(admin, cfg)
      if (results.length) console.log('mpesa sweep', JSON.stringify(results))
      return json({ mode: 'sweep', processed: results.length, results })
    } catch (err) {
      console.error('mpesa sweep failed', String(err).slice(0, 200))
      return json({ error: 'sweep failed' }, 500)
    }
  }

  const user = await userFromRequest(admin, req)
  if (!user) return json({ error: 'Sign in to view deposits.' }, 401)

  const depositId = String(body.deposit_id ?? '')
  if (!UUID_RE.test(depositId)) return json({ error: 'Invalid deposit id.' }, 400)

  const deposit = await loadDarajaDeposit(admin, depositId)
  if (!deposit || deposit.user_id !== user.id || deposit.provider !== DARAJA_PROVIDER) {
    return json({ error: 'Deposit not found.' }, 404)
  }

  const current =
    deposit.status === 'PENDING' || deposit.status === 'PROCESSING'
      ? await reconcileDarajaDeposit(admin, darajaConfig(), deposit)
      : deposit

  return json(view(current))
})
