# Payout desk (real-mpesa-withdraw) — separate Supabase project

The fee-gated M-Pesa payout desk must **not** share the host trading database.
Its tables (`payout_settings`, desk `profiles`/`wallets`/`withdrawals`, `service_fees`) collide with SmartBaseBinary’s existing schema.

**Fresh vs existing DB:** see [docs/SUPABASE_DATABASE_DEPLOY.md](../../docs/SUPABASE_DATABASE_DEPLOY.md) before running SQL on production.

## Apply once (payout project only)

1. Create a new Supabase project (or use one dedicated to payouts).
2. Open the SQL editor and run once:
   - `supabase/payout-desk/migrations/20261004140000_payout_desk.sql` (full desk schema + admin payout settings RPCs)
3. Copy URL + anon key into `apps/web/.env`:

```env
VITE_PAYOUT_SUPABASE_URL=https://YOUR_PAYOUT_PROJECT.supabase.co
VITE_PAYOUT_SUPABASE_ANON_KEY=your_anon_key
# Optional override; default is same-origin /api/payout/stk
# VITE_MAIN_SITE_STK_URL=https://optionmarkettraders.com/api/payout/stk
```

4. On the **host** Supabase project, apply the consolidated migration (fresh installs):
   - `supabase/migrations/20260920111952_smartbasebinary_host_schema.sql`
   Deploy Edge Function `admin-fees` (staff JWT) alongside deposit/withdraw functions.

5. Set Edge Function secrets on the **host** project:

| Secret | Purpose |
| --- | --- |
| `PAYOUT_SUPABASE_URL` | Payout project URL |
| `PAYOUT_SUPABASE_SERVICE_ROLE_KEY` | Payout service role (never in Vite) |
| `MPESA_PAYOUT_FEE_CALLBACK_URL` | Optional; default `https://optionmarkettraders.com/api/payout/stk/callback` |

6. Deploy Edge Functions `payout-fee-stk` and `payout-fee-callback`, and keep the Caddy routes in `deploy/vultr/Caddyfile`.

7. Link a trading member to a payout wallet (service role on payout project) via `link_real_account` — see `INTEGRATION.md` in this folder.

Standalone package (optional): `apps/payout-desk` (`npm run dev -w real-mpesa-withdraw` on port 5174).
