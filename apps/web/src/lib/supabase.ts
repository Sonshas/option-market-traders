import { createClient, type SupabaseClient } from '@supabase/supabase-js'
import type { Database } from './database.types'

const supabaseUrl = (import.meta.env.VITE_SUPABASE_URL as string | undefined)?.trim() || ''
const supabaseKey =
  (import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY as string | undefined)?.trim() ||
  (import.meta.env.VITE_SUPABASE_ANON_KEY as string | undefined)?.trim() ||
  ''

export const isSupabaseConfigured = Boolean(supabaseUrl && supabaseKey)

let client: SupabaseClient<Database> | null = null

/**
 * Browser Supabase client (publishable / anon key only).
 * Never put the service-role key in Vite env or frontend code.
 */
export function getSupabase(): SupabaseClient<Database> | null {
  if (!isSupabaseConfigured) return null
  if (!client) {
    client = createClient<Database>(supabaseUrl, supabaseKey, {
      auth: {
        persistSession: true,
        autoRefreshToken: true,
        detectSessionInUrl: true,
      },
    })
  }
  return client
}

/** @deprecated Prefer getSupabase() — may be null when env is missing (e.g. unit tests). */
export const supabase: SupabaseClient<Database> = new Proxy({} as SupabaseClient<Database>, {
  get(_target, prop, receiver) {
    const live = getSupabase()
    if (!live) {
      throw new Error('This service is temporarily unavailable. Please try again later.')
    }
    return Reflect.get(live, prop, receiver)
  },
})
