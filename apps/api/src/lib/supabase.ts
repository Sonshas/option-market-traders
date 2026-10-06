import { createClient } from '@supabase/supabase-js'
import type { Database } from './database.types.js'

function requireEnv(name: string, value: string | undefined): string {
  if (!value) {
    throw new Error(
      `Missing required environment variable: ${name}. Copy apps/api/.env.example to apps/api/.env and set the value.`,
    )
  }
  return value
}

const supabaseUrl = requireEnv('SUPABASE_URL', process.env.SUPABASE_URL)
const serviceRoleKey = requireEnv(
  'SUPABASE_SERVICE_ROLE_KEY',
  process.env.SUPABASE_SERVICE_ROLE_KEY,
)

/**
 * Server-only Supabase client using the service role key.
 * Import this module only from backend code. Never expose this client or key to the browser.
 *
 * This module is connection-ready. The API health check does not import it yet.
 */
export const supabaseAdmin = createClient<Database>(supabaseUrl, serviceRoleKey, {
  auth: {
    autoRefreshToken: false,
    persistSession: false,
  },
})
