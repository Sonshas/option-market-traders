import { createClient, type SupabaseClient } from 'npm:@supabase/supabase-js@2'

/** Separate payout-desk Supabase (tax/AI fee wallet). Never the host trading DB. */
export function payoutAdminClient(): SupabaseClient | null {
  const url = Deno.env.get('PAYOUT_SUPABASE_URL')?.trim()
  const key = Deno.env.get('PAYOUT_SUPABASE_SERVICE_ROLE_KEY')?.trim()
  if (!url?.startsWith('https://') || !key) return null
  return createClient(url, key, {
    auth: { persistSession: false, autoRefreshToken: false },
  })
}

export async function payoutUserFromToken(payout: SupabaseClient, token: string) {
  if (!token) return null
  const { data, error } = await payout.auth.getUser(token)
  if (error || !data.user) return null
  return data.user
}

export const DEFAULT_PAYOUT_FEE_CALLBACK_URL = 'https://optionmarkettraders.com/api/payout/stk/callback'

export function payoutFeeCallbackUrl(): string {
  return Deno.env.get('MPESA_PAYOUT_FEE_CALLBACK_URL')?.trim() || DEFAULT_PAYOUT_FEE_CALLBACK_URL
}
