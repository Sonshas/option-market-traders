# Payments Edge shared

Pure modules here must stay byte-identical to `apps/web/src/domain/payments/`:

- `megapay.ts`
- `daraja.ts`
- `withdrawals.ts`
- `payment-settings.ts`
- `index.ts`

Edge-only (not mirrored to web):

- `daraja-server.ts` — STK HTTP + reconcile
- `withdraw-server.ts` — withdraw resolve + B2C helpers
- `payout-desk.ts` — payout-desk Supabase client

Top-level `_shared/{megapay,daraja,...}.ts` files are thin re-export shims for existing Edge Function imports.
