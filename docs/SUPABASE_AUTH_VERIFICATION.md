# Supabase Auth Verification — Smart Base Binary

**Date:** 2026-10-02 / 03 (UTC+3)
**Project:** Smart Base Binary · ref `wkfyavcjjuyzvyeprklz` · `eu-west-1` · `ACTIVE_HEALTHY`
**Database changes:** **None.** No migrations, schema, trigger, function, RLS, grant, feature-flag, or data edits. The only writes were from one normal public signup made through the website UI.
**Secrets:** This file contains no key values.

---

## 1. Connection

| Check | Result |
|-------|--------|
| `apps/web/.env` `VITE_SUPABASE_URL` | `https://wkfyavcjjuyzvyeprklz.supabase.co`. Matches MCP `get_project_url` |
| `VITE_SUPABASE_PUBLISHABLE_KEY` | Present · `sb_publishable_` · length 46 · accepted by `/auth/v1/settings` |
| `VITE_SUPABASE_ANON_KEY` (fallback) | Present · `eyJ` JWT · length 208 · payload `ref=wkfyavcjjuyzvyeprklz`, `role=anon` · accepted |
| Client key used | Publishable key first, then anon (`src/lib/supabase.ts`) |
| Client auth options | `persistSession: true`, `autoRefreshToken: true`, `detectSessionInUrl: true` |
| `.env.production` | Only `VITE_E2E_AUTH_BYPASS=false` |
| Live bundle | Contains the project ref. No `service_role` and no secret key; the only `sb_secret_` text is supabase-js key-format detection code. Bypass code is absent. |

## 2. Auth configuration (read-only, via public `/auth/v1/settings`)

| Setting | Value |
|---------|-------|
| Email provider | Enabled |
| Signups | Allowed (`disable_signup=false`) |
| **Confirm email** | **ON** (`mailer_autoconfirm=false`). Signup returns no session, and login is blocked until the email link is clicked. |
| Site URL / redirect allow-list | Not readable with public keys. **Action for owner:** in Dashboard → Auth → URL Configuration, set Site URL to `https://optionmarkettraders.com` and add `https://optionmarkettraders.com/**` to Redirect URLs. If the domain isn't on the allow-list, Supabase ignores the app's `emailRedirectTo` and falls back to the Site URL. |

## 3. Database (read-only SQL)

- Trigger `on_auth_user_created` (enabled) on `auth.users` runs `private.handle_new_user()` (SECURITY DEFINER, `search_path public, private`). It inserts:
  - `public.users` (role `trader`)
  - `public.profiles` (display name from metadata or the email local part)
  - `public.accounts` × 2 (`demo`, `real`)
  - `public.wallets` × 2: DEMO `is_simulated=true`, balance 0; REAL `is_simulated=false`, balance 0, USD
- Column defaults on `wallets`: `balance`, `available_balance`, `locked_balance` all `0`; `currency 'USD'`; `status 'ready'`; `is_simulated false`.
- RLS is enabled on `users`, `profiles`, `accounts`, and `wallets`. The owner SELECT policies are `user_id = auth.uid() OR is_platform_staff()` (`id = auth.uid()` on `users`). The `authenticated` role has SELECT on all four tables and EXECUTE on `is_platform_staff()`.
- **DEMO note (not a defect):** the app's DEMO balance is local (`localStorage sbb.demo.v1`, $10,000 starting balance). The DB DEMO wallet stays at 0 (simulated) and the app doesn't read it. This matches the documented design, so no schema change is needed.
- The DB has no `country` column, constraint, or enum. Country lives only in the auth user's `raw_user_meta_data`, so `Kenya` is accepted with no schema change.

## 4. End-to-end test (real, production Supabase, via the website UI)

Local Vite dev server with `VITE_E2E_AUTH_BYPASS=false`, driven by Playwright.

| Step | Result | Evidence |
|------|--------|----------|
| Signed out, open `/app` or `/app/wallet` | **PASS**: redirects to `/login` | Playwright |
| Register `sbb.e2e.test+202610022100@gmail.com` | **PASS** | `POST /auth/v1/signup?redirect_to=http://localhost:5174/app` returned 200 (edge logs) |
| `auth.users` row | Created · `email_confirmed_at = NULL` · `confirmation_sent_at` set | SQL |
| Trigger provisioning | **PASS**: `users` 1, `profiles` 1, DEMO wallet 0 (simulated), REAL wallet 0 USD (`ready`, not simulated) | SQL |
| Login (unconfirmed user) | **Blocked by design**: `400 email_not_confirmed`; UI shows "Email not confirmed"; no `sb-*` session stored | Playwright |
| Session persistence, DEMO default, REAL $0.00 read, logout (with the test user) | **Not run**: needs a confirmed email. Nobody set `email_confirmed_at` manually or changed the Confirm-email setting. | — |
| Existing account `sonshasopunga@gmail.com` | Login skipped: no password is stored in the workspace. API logs show a successful password login from the owner's browser at 21:00:25 UTC. | edge logs |

To finish the in-session checks, click the confirmation link sent to the test address, or log in as the owner account. Because the test signup ran from the local dev server, its confirmation link points to `http://localhost:5174/app`. Signups from the live site will use `https://optionmarkettraders.com/app`.

## 5. "Balance unavailable" for sonshasopunga@gmail.com

- **Database is fine:** the user has a REAL wallet row (`real`, USD, balance/available 0, `ready`, `is_simulated=false`). RLS and grants allow the owner to read it. **No SQL fix is needed.**
- **Frontend query is correct:** table `wallets`, `user_id = session.user.id` (auth uid), `account_mode = 'real'` (lowercase, matching the DB), `maybeSingle()`.
- **Root cause (frontend):** `useWallet` showed `"Balance unavailable"` whenever the REAL read hadn't produced a row yet. It used the same text for "still loading", "request failed", and "request stalled", and it had no timeout or retry. The API logs after the 21:00:25 login show the browser sending the wallet preflight (`OPTIONS`), but the first `GET /rest/v1/wallets` didn't complete until 21:01:03 (it returned 200). For that whole window the UI showed "Balance unavailable".
- **Fix:**
  - `real-wallet-provider.ts`: the REAL wallet read now has an 8-second timeout and one retry.
  - `useWallet.ts`: shows `Loading…` while pending, the real DB amount once read (`$0.00`), and a short `—` if the read genuinely fails. No number is ever invented.
  - `domain/account.ts`: the placeholder is now `—` instead of the long text.

## 6. Frontend changes

| File | Change |
|------|--------|
| `src/services/auth.ts` | `signUp` and `resend` pass `emailRedirectTo: ${window.location.origin}/app` |
| `src/features/auth/AuthForms.tsx` | After login/signup, opens in **DEMO** (was forced to REAL). Country list is alphabetical and includes **Kenya**, with "Other" last. |
| `src/pages/account/ProfilePage.tsx` | Logout resets the mode to DEMO. Supabase `signOut` clears the stored session; REAL wallet state refetches and shows NOT CONNECTED. |
| `src/layouts/AppLayout.tsx` | Removed the REAL status strip. The header keeps the Demo/Real switch, the REAL ACCOUNT badge, and `Balance <db value>`. |
| `src/pages/trading/TradingPage.tsx` | Removed the Trading/Deposits/Withdrawals lines and the "Live chart and prices only…" note. Kept the REAL badge, market-data badges, and Balance. |
| `src/features/trading/TradeTicket.tsx` | Replaced the verbose REAL block with a compact `REAL Balance` row plus a `NOT CONNECTED` badge. REAL buttons are disabled with the label "Real trading not available yet". |
| `src/features/wallet/WalletPanels.tsx` | Removed the REAL status card and status lines; a sign-in prompt shows only when signed out. Deposit/Withdraw stay disabled, with `NOT CONNECTED` and "Real deposits and withdrawals not available yet". |
| `src/pages/dashboard/UserDashboardPage.tsx` | Removed the REAL status card (sign-in prompt shows only when signed out) |
| `src/providers/wallet/real-wallet-provider.ts`, `src/hooks/useWallet.ts`, `src/domain/account.ts` | Balance fix (section 5) |
| `scripts/verify-ui.mjs` | REAL button check now matches `SELECT EVEN`. Asserts the new label is present and the removed note is absent. |

Backups: `Desktop\sbb-backup-20261002-235846` (original auth files) and `Desktop\sbb-backup-20261003-000249`.

REAL gating is unchanged: `REAL_INTEGRATION.executionConfigured=false`, `paymentConfigured=false`; DB flags `REAL_TRADING_ENABLED`, `REAL_PAYMENTS_ENABLED`, `REAL_BOTS_ENABLED`, `REAL_COPY_ENABLED` are all `false`. The DEMO engine is unchanged.

## 7. Checks and deploy

| Check | Result |
|-------|--------|
| `tsc -b` | PASS |
| `oxlint` | PASS (only pre-existing warnings) |
| `vitest` | PASS: 66/66 |
| `vite build` | PASS |
| `verify-ui` (Playwright, 39 routes, desktop and mobile, DEMO/REAL contract flows) | PASS: no issues |
| Deploy | Release `20261003-000856` · live bundle `index-uAMxdlqy.js` has the project ref, the new label, and Kenya; no removed note, no "Balance unavailable", no bypass, no `service_role` |

## 8. Final DB state (read-only)

`auth.users` 2 · `users` 2 · `profiles` 2 · `accounts` 4 · `wallets` 4 (all balances 0) · ledger/transactions/deposits/withdrawals/trades 0 · migrations 6 (latest `20260920111952`, unchanged) · flags unchanged.

**Test user to remove later (only with the owner's approval):** `sbb.e2e.test+202610022100@gmail.com` (id `748c2aa1-922a-4d1f-8bf0-f29e1dea0b6d`).
