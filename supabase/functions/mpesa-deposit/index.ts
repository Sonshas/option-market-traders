import 'jsr:@supabase/functions-js/edge-runtime.d.ts'
import { UNAVAILABLE_MESSAGE, adminClient, corsHeaders, json, userFromRequest } from '../_shared/server.ts'

/**
 * Legacy Daraja deposit entry point. REAL deposits now go through megapay-deposit only.
 * Kept deployed so old clients that still call this name get a clear redirect response.
 */
Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders })

  const admin = adminClient()
  const user = await userFromRequest(admin, req)
  if (!user) return json({ error: 'Sign in to deposit.' }, 401)

  if (req.method === 'GET') {
    return json({ provider: 'megapay', enabled: false, message: UNAVAILABLE_MESSAGE })
  }
  if (req.method !== 'POST') return json({ error: 'Method not allowed' }, 405)
  return json({ error: 'Deposit method changed. Please reopen the deposit form.' }, 409)
})
