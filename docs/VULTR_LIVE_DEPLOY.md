# Publish to live (Vultr + Supabase)

Production site: **https://optionmarkettraders.com**  
Host Supabase: **wkfyavcjjuyzvyeprklz**  
VPS role: static SPA + Caddy reverse proxy to Edge Functions (MegaPay, Daraja, payout STK, B2C).

---

## One-time on your PC

1. Node.js **22+**, OpenSSH (`ssh`, `scp`), repo dependencies: `npm install` from the repo root.
2. `apps/web/.env` — production `VITE_*` values (Supabase URL/anon key, Deriv, payout desk URL, etc.).
3. `apps/web/.env.production` — must include `VITE_E2E_AUTH_BYPASS=false`.
4. SSH to Vultr works: `ssh deploy@<VULTR_IPV4> "echo ok"` (see [DOMAIN_SETUP.md](DOMAIN_SETUP.md) if not).
5. Supabase CLI (for Edge deploy): `npx supabase login`.

Optional: copy `deploy/vultr/deploy.local.env.example` → `deploy/vultr/deploy.local.env` and set **VULTR_SERVER_IP** (+ **SUPABASE_DB_PASSWORD** for psql).  
Connect anytime: **[REMOTE_ACCESS.md](REMOTE_ACCESS.md)** or `.\deploy\vultr\connect-remote.ps1`.

---

## Every release (recommended order)

### 1. Database (Supabase Dashboard → SQL)

**Production host DB (Oct 2025):** current through **`20261005190000`**. One-off `deploy/supabase/*.sql` deltas were removed after apply; see `deploy/supabase/README.md`.

**Do not** run the full consolidated file on production if migrations were already applied incrementally.

1. Dashboard → **Database** → **Migrations** (or run `npx supabase migration list --project-ref wkfyavcjjuyzvyeprklz`) and note the latest version.
2. For anything **not** yet applied since your last deploy, run only the matching sections from  
   `supabase/migrations/20260920111952_smartbasebinary_host_schema.sql`  
   (search for `-- from: <filename>`). Object checklist: `supabase/migrations/MIGRATION_MANIFEST.md`.

| Section marker | Features |
| --- | --- |
| `20261005160000_payout_fee_stk_requests.sql` | Payout desk fee STK tracking on host |
| `20261005170000_account_win_rate_90.sql` | 90% settlement, payout rate |
| `20261005180000_payment_settings.sql` | Admin fees, stake limits |
| `20261005190000_place_real_trade_stake_bounds.sql` | Legacy `place_real_trade` bounds |

Use the table above only when `migration list --linked` shows a version is **missing** on remote.

Payout desk project (separate ref): only if that DB is new or missing admin RPCs — see [SUPABASE_DATABASE_DEPLOY.md](SUPABASE_DATABASE_DEPLOY.md).

### 2. Edge Functions (host project)

After `_shared/`, `payments/`, `outcome/`, or function `index.ts` changes:

```powershell
cd C:\Users\User\Desktop\smartbasebinary\smartbasebinary.online
.\deploy\vultr\deploy-supabase-functions.ps1
```

Or deploy a subset:

```powershell
.\deploy\vultr\deploy-supabase-functions.ps1 -Only admin-fees,real-trade,megapay-deposit,mpesa-deposit
```

Functions that use `--no-verify-jwt`: `megapay-webhook`, `mpesa-callback`, `mpesa-status`, `mpesa-b2c-result`, `payout-fee-callback`, `real-trade-settle`.

Confirm Edge secrets in the dashboard (Daraja, MegaPay, `PAYOUT_SUPABASE_*`, etc.) — unchanged keys do not need redeploy.

### 3. Frontend (Vultr VPS)

```powershell
cd C:\Users\User\Desktop\smartbasebinary\smartbasebinary.online
.\deploy\vultr\publish-live.ps1 -ServerIp <VULTR_IPV4>
```

All-in-one (web + Caddy + Edge):

```powershell
.\deploy\vultr\publish-live.ps1 -ServerIp <VULTR_IPV4> -SyncCaddy -DeployEdgeFunctions
```

What `deploy.ps1` does: production build → `scp` to `/var/www/optionmarkettraders/releases/<timestamp>` → switch `current` symlink.

If `deploy/vultr/Caddyfile` changed (new `/api/*` routes):

```powershell
.\deploy\vultr\sync-caddy.ps1 -ServerIp <VULTR_IPV4>
```

(requires `root@` SSH; same key as Vultr dashboard if configured for root.)

### 4. Smoke checks

- https://optionmarkettraders.com loads; hard refresh or incognito.
- `/app` login; **Admin → Fees** if you shipped admin fees.
- Deposit/withdraw test amounts in sandbox if applicable.
- `journalctl -u caddy -n 50` on the server if webhooks fail.

---

## Rollback (web only)

```bash
ssh deploy@<VULTR_IPV4>
cd /var/www/optionmarkettraders
ls -1 releases
ln -sfn /var/www/optionmarkettraders/releases/<older-timestamp> current.tmp && mv -Tf current.tmp current
```

Edge Functions and SQL are not rolled back by this — redeploy an older git commit if needed.

---

## Related docs

- [DOMAIN_SETUP.md](DOMAIN_SETUP.md) — first-time VPS + DNS + Caddy
- [SUPABASE_DATABASE_DEPLOY.md](SUPABASE_DATABASE_DEPLOY.md) — fresh vs existing DB
- [MEGAPAY_INTEGRATION.md](MEGAPAY_INTEGRATION.md), [DARAJA_INTEGRATION.md](DARAJA_INTEGRATION.md), [WITHDRAWALS.md](WITHDRAWALS.md)
