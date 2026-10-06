import { fileURLToPath, URL } from 'node:url'
import { defineConfig } from 'vitest/config'

export default defineConfig({
  resolve: {
    alias: {
      '@': fileURLToPath(new URL('./src', import.meta.url)),
    },
  },
  test: {
    environment: 'node',
    include: ['src/**/*.test.ts'],
    // Keep unit tests offline — do not load apps/web/.env keys or live market feeds into vitest.
    env: {
      VITE_SUPABASE_URL: '',
      VITE_SUPABASE_PUBLISHABLE_KEY: '',
      VITE_SUPABASE_ANON_KEY: '',
      VITE_E2E_AUTH_BYPASS: '',
      VITE_MARKET_DATA_PROVIDER: '',
      VITE_MARKET_DATA_API_URL: '',
      VITE_MARKET_DATA_WS_URL: '',
      VITE_DERIV_APP_ID: '',
    },
  },
})
