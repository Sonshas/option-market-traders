import 'jsr:@supabase/functions-js/edge-runtime.d.ts'
import type { SupabaseClient } from 'npm:@supabase/supabase-js@2'
import { REAL_TRADE_SYMBOLS } from '../_shared/digit-contracts.ts'
import {
  DerivSession,
  OPEN_TRADE_COLUMNS,
  TRADE_COLUMNS,
  adminClient,
  corsHeaders,
  fetchFreshTick,
  json,
  settleTrades,
  userFromRequest,
  type OpenTradeRow,
} from '../_shared/trading-server.ts'

// verify_jwt=false. Two callers:
//  - a signed-in user (Authorization: Bearer <JWT>) settling their own expired REAL trades;
//  - the pg_cron sweep, authenticated by the x-sweep-secret header (value kept only in Vault).

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
const SWEEP_BATCH = 100
const USER_BATCH = 10

function dueTrades(admin: SupabaseClient, limit: number) {
  return admin
    .from('trades')
    .select(OPEN_TRADE_COLUMNS)
    .eq('account_mode', 'real')
    .eq('is_simulated', false)
    .eq('status', 'open')
    .lte('expires_at', new Date().toISOString())
    .order('expires_at', { ascending: true })
    .limit(limit)
}

async function readBody(req: Request): Promise<Record<string, unknown>> {
  try {
    const body = await req.json()
    return body && typeof body === 'object' && !Array.isArray(body) ? body : {}
  } catch {
    return {}
  }
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders })
  if (req.method !== 'POST') return json({ error: 'Method not allowed' }, 405)

  const admin = adminClient()
  const body = await readBody(req)
  const sweepSecret = req.headers.get('x-sweep-secret')

  if (sweepSecret) {
    const { data: valid } = await admin.rpc('verify_real_trade_sweep_secret', { p_secret: sweepSecret })
    if (valid !== true) return json({ error: 'Unauthorized' }, 401)

    if (body.mode === 'diagnose') {
      // Connectivity check only: fetches a live tick, never touches trades or wallets.
      const symbol = (REAL_TRADE_SYMBOLS as readonly string[]).includes(String(body.symbol)) ? String(body.symbol) : 'R_100'
      const started = Date.now()
      let session: DerivSession | null = null
      try {
        session = await DerivSession.open()
        const tick = await fetchFreshTick(session, symbol)
        return json({ mode: 'diagnose', symbol, tick, elapsed_ms: Date.now() - started })
      } catch (err) {
        return json({ mode: 'diagnose', symbol, tick: null, error: String(err), elapsed_ms: Date.now() - started }, 502)
      } finally {
        session?.close()
      }
    }

    const { data, error } = await dueTrades(admin, SWEEP_BATCH)
    if (error) {
      console.error('sweep load failed', error.message)
      return json({ error: 'load failed' }, 500)
    }
    const results = await settleTrades(admin, (data ?? []) as OpenTradeRow[])
    if (results.length) console.log('sweep', JSON.stringify(results))
    return json({ mode: 'sweep', processed: results.length, results })
  }

  const user = await userFromRequest(admin, req)
  if (!user) return json({ error: 'Sign in to view trades.' }, 401)

  const tradeId = body.trade_id == null ? null : String(body.trade_id)
  if (tradeId != null && !UUID_RE.test(tradeId)) return json({ error: 'Invalid trade id.' }, 400)

  let query = dueTrades(admin, USER_BATCH).eq('user_id', user.id)
  if (tradeId) query = query.eq('id', tradeId)
  const { data, error } = await query
  if (error) return json({ error: 'Could not load trades.' }, 500)
  const results = await settleTrades(admin, (data ?? []) as OpenTradeRow[])

  let trades: unknown[] = []
  if (tradeId) {
    const { data: row } = await admin
      .from('trades')
      .select(TRADE_COLUMNS)
      .eq('id', tradeId)
      .eq('user_id', user.id)
      .eq('account_mode', 'real')
      .maybeSingle()
    if (!row) return json({ error: 'Trade not found.' }, 404)
    trades = [row]
  }
  return json({ processed: results.length, results: results.map(({ tradeId: id, result }) => ({ trade_id: id, result })), trades })
})
