import { createClient, type SupabaseClient } from '@supabase/supabase-js'

/** Separate payout-desk Supabase project (see supabase/payout-desk/). Falls back unset → not configured. */
const url = (import.meta.env.VITE_PAYOUT_SUPABASE_URL ?? '').trim()
const anonKey = (import.meta.env.VITE_PAYOUT_SUPABASE_ANON_KEY ?? '').trim()

export const supabaseConfigured = url.startsWith('https://') && anonKey.length > 20

export const supabase: SupabaseClient | null = supabaseConfigured
  ? createClient(url, anonKey, {
      auth: {
        persistSession: true,
        autoRefreshToken: true,
        detectSessionInUrl: true,
        storageKey: 'sb-payout-desk-auth',
      },
    })
  : null
