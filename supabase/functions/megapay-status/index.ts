import 'jsr:@supabase/functions-js/edge-runtime.d.ts'
import {
  adminClient,
  corsHeaders,
  json,
  loadDeposit,
  publicDeposit,
  reconcileDeposit,
  serverConfig,
  userFromRequest,
} from '../_shared/server.ts'

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders })
  if (req.method !== 'POST') return json({ error: 'Method not allowed' }, 405)

  const admin = adminClient()
  const user = await userFromRequest(admin, req)
  if (!user) return json({ error: 'Sign in to view deposits.' }, 401)

  let depositId = ''
  try {
    depositId = String((await req.json()).deposit_id ?? '')
  } catch {
    return json({ error: 'Invalid request.' }, 400)
  }
  if (!UUID_RE.test(depositId)) return json({ error: 'Invalid deposit id.' }, 400)

  const deposit = await loadDeposit(admin, depositId)
  if (!deposit || deposit.user_id !== user.id || deposit.provider !== 'megapay') {
    return json({ error: 'Deposit not found.' }, 404)
  }

  const current =
    deposit.status === 'PENDING' || deposit.status === 'PROCESSING'
      ? await reconcileDeposit(admin, serverConfig(), deposit)
      : deposit

  return json(publicDeposit(current))
})
