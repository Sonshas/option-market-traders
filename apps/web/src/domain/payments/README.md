# Payments domain

Backend logic for deposits, withdrawals, fees, and M-Pesa rails lives here so future payment edits stay in one place.

## Layout

| File | Purpose |
| --- | --- |
| `megapay.ts` | MegaPay deposit phone/amount/rate helpers |
| `daraja.ts` | Safaricom STK Push / provider pure helpers |
| `withdrawals.ts` | Legacy REAL withdrawal quotes, B2C payload, fee |
| `payment-settings.ts` | Admin-editable deposit / withdraw / desk / stake fee maps |
| `index.ts` | Barrel re-exports of the four pure modules |

Edge-only (under `supabase/functions/_shared/payments/` only):

| File | Purpose |
| --- | --- |
| `daraja-server.ts` | Daraja STK HTTP + deposit reconcile |
| `withdraw-server.ts` | Withdrawal config resolve + B2C send helpers |
| `payout-desk.ts` | Separate payout-desk Supabase client |

## Mirror rule

`apps/web/src/domain/payments/{megapay,daraja,withdrawals,payment-settings,index}.ts` must stay **byte-identical** to `supabase/functions/_shared/payments/` copies.

Edit the web copy, then sync the Edge mirror. Tests in this folder enforce the match via `?raw` imports.

## Imports

Preferred: `@/domain/payments` or `@/domain/payments/megapay`.

Legacy top-level `@/domain/megapay` etc. still work via thin re-export shims.

Admin UI for amounts: **Admin → Fees** (`/admin/fees`).
