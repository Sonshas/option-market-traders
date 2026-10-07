# UI-only pages and sections

Inventory of **user-side** and **admin-side** surfaces that are preview / mock / placeholder / localStorage-only, or not wired to production Supabase / Edge backends.

**Date:** 2026-10-05  
**Scope:** `apps/web` routes in `App.tsx`, `pages/`, related `features/`

**Legend**

| Tag | Meaning |
| --- | --- |
| **UI_ONLY** | Whole page (or clearly named section) has no production data/mutations |
| **PARTIAL · UI section** | Page has some real wiring; listed subsections are still UI-only |

DEMO localStorage practice is intentional for DEMO mode; it is listed where it is the *only* behaviour or where REAL/admin production is missing.

---

## 1. User app — fully UI_ONLY pages

| Route | Page | What’s UI-only | Evidence |
| --- | --- | --- | --- |
| `/two-factor` | Two-factor | Entire page — TOTP never verifies | `TwoFactorForm`: “Project TOTP is not enabled yet”; `authService.verifyTwoFactor` returns not connected |
| `/contact` | Contact & Support | No form; static copy only | “Email placeholders and production support channels are not connected” |
| `/about` | About | Static marketing only | No fetches; REAL described as NOT CONNECTED (copy may be stale vs live REAL) |
| `/legal/risk` | Risk disclosure | Static preview legal copy | “does not operate live trading… in this interface preview” |
| `/legal/terms` | Terms of use | Static UI-phase terms | “not connected to production accounts”; “preview-only” |
| `/legal/privacy` | Privacy | Static copy (partly **stale** — claims auth is local; Auth is actually wired) | “Auth forms are local. Submissions are not sent to Supabase” |

**Not in top nav (URL-only):**

| Route | Page | What’s UI-only | Evidence |
| --- | --- | --- | --- |
| `/app/copy` (REAL mode) | Copy Trading | Entire REAL board | EmptyState: “Real copy trading is coming soon” |
| `/app/copy/:traderId` (REAL) | Copy trader profile | Entire REAL profile | “Real copy trading is coming soon”; copy disabled |

`/app/bots` and `/app/markets` redirect to Trade — no standalone UI pages.

---

## 2. User app — PARTIAL pages (UI-only sections)

| Route | Page | UI-only / mock sections | Wired parts (for contrast) |
| --- | --- | --- | --- |
| `/app/copy` (DEMO) | Copy Trading | Trader cards = `COPY_TRADER_PLACEHOLDERS`; fake metrics (N/A historical); localStorage start/stop only | DEMO local copy state only |
| `/app/copy/:traderId` (DEMO) | Trader profile | Placeholder trader; N/A P&L / ROI / win rate; “not a verified live trader” | Local DEMO start-copy dialog |
| `/app/profile` | Profile | All fields **read-only**; no save / KYC / avatar mutation | Loads session + `profiles` extras |
| `/app/security` | Security | **Two-factor card** — “Authenticator app sign-in is not available yet” / Coming soon | Password change via Supabase |
| `/app/security` | Security | **Sessions** — text only (“Signed in on this browser”); no list/revoke API | — |
| `/app/support` | Support | Create ticket always DEMO/local path; success text: “saved in this browser. Live support tickets are coming soon.” | Ticket **list** can show DEMO store / REAL `support_tickets` by mode |
| `/app/notifications` | Notifications | DEMO = localStorage only; no mark-all / admin broadcast from user UI | REAL can read Supabase `notifications` when connected |
| `/app/wallet` | Wallet | DEMO deposit/withdraw = simulated local methods / destination; REAL actions gated by feature flags (`Coming soon` when off) | REAL deposit (M-Pesa) + payout-desk withdraw when enabled |
| `/app/dashboard` | Dashboard | DEMO charts/activity from local ledger only | REAL P/L / activity from Supabase when signed in |
| `/app/history` | Trade History | DEMO history = simulated practice ledger | REAL history from backend when connected |
| `/app/transactions` | Transactions | DEMO ledger = localStorage | REAL transactions from backend when connected |
| `/` (Landing) | Landing | **TicketMock** illustration; hardcoded contract teaching digits; decorative terminal chrome | Live Deriv ticker / terminal prices when feed is up |

---

## 3. Admin — fully UI_ONLY pages

Admin chrome: `AdminLayout` badge **“Preview — not production”**.

| Route | Page | What’s UI-only | Evidence |
| --- | --- | --- | --- |
| `/admin` | Overview | All stats `—` / “Not loaded”; no DB | “Staff console preview”; “Not connected to any remote database” |
| `/admin/users` | Users | Empty shell table | “Admin tools are not connected to production data.”; no production user list |
| `/admin/accounts` | Accounts | Empty shell | “Balances are not fetched from production.” |
| `/admin/ledger` | Ledger | Empty shell | “REAL ledger is not connected and never fabricated.” |
| `/admin/support` | Support tickets | Empty shell | “Conversations are not loaded from production.” |
| `/admin/notifications` | Notifications | Broadcast UI shell only | “Broadcast UI only. No notification table is invented or written remotely.” |
| `/admin/copy-traders` | Copy traders | Placeholder / DEMO list only | `COPY_TRADER_PLACEHOLDERS`; “DEMO / placeholder records only.” |
| `/admin/settings` | System settings | Hardcoded flag **labels** (not production values); demo reset is localStorage only | “Flags as UI labels only — values are not read from production.” |
| `/admin/audit` | Audit logs | Always empty | “Empty until a backend audit stream is connected”; `listAuditLogs` → disconnected |

`/admin/bots` redirects to `/admin` (no page).

---

## 4. Admin — PARTIAL pages (UI-only sections)

| Route | Page | UI-only / local-only sections | Wired sections |
| --- | --- | --- | --- |
| `/admin/deposits` | Deposits | **REAL tab** — empty / NOT CONNECTED (never fabricated) | **DEMO tab** — localStorage DEMO deposits only (not production) |
| `/admin/trades` | Trades | **REAL tab** — NOT CONNECTED | **DEMO tab** — local DEMO trades only |
| `/admin/withdrawals` | Withdrawals | **DEMO tab** — localStorage simulated rows | **Payout desk** + **Legacy REAL** panels (wired to backends) |
| `/admin/fees` | Fees & payments | *(none material)* — panel is DB-backed; still sits under generic admin shell | `AdminFeesPanel` → Edge `admin-fees` |
| `/admin/dashboard` | Dashboard | *(none material)* | `RealAdminDashboard` → staff Edge/dashboard service |

---

## 5. Shared UI-only sources

| Source | File | Used by |
| --- | --- | --- |
| `COPY_TRADER_PLACEHOLDERS` | `apps/web/src/lib/constants.ts` | `/app/copy*`, `/admin/copy-traders` |
| `BOT_CATALOG` + “N/A — historical results are not connected” | `lib/constants.ts` | Bot catalog (bots route redirected) |
| `demo-store` / localStorage | `lib/demo-store.ts` | DEMO wallet, trades, tx, tickets, notifications, copies |
| `AdminTablePage` default alert | `features/admin/AdminTables.tsx` | Most admin pages: “Admin tools are not connected to production data.” |
| `REAL_COMING_SOON` | `domain/account.ts` | REAL copy, gated wallet actions |
| Legal / About / Contact copy | `pages/legal/LegalPages.tsx` | Public marketing/legal still describe “UI preview” |

---

## 6. Quick checklist — pure UI_ONLY to implement later

**Public / auth**

- [ ] `/two-factor`
- [ ] `/contact` (form + channels)
- [ ] Refresh `/about`, `/legal/*` copy so it matches live Auth / REAL trading

**User app**

- [ ] REAL copy trading (`/app/copy`, `/app/copy/:traderId`)
- [ ] DEMO copy traders → replace placeholders with real data (or hide)
- [ ] Profile edit / KYC mutations
- [ ] Security 2FA + remote sessions
- [ ] Support create → production tickets (and honest success messaging)
- [ ] Landing: TicketMock / teaching blocks (optional keep as marketing)

**Admin**

- [ ] `/admin` overview stats
- [ ] `/admin/users`
- [ ] `/admin/accounts`
- [ ] `/admin/ledger`
- [ ] `/admin/support`
- [ ] `/admin/notifications` (broadcast)
- [ ] `/admin/copy-traders`
- [ ] `/admin/settings` (real feature flags / trading_settings UI beyond Fees)
- [ ] `/admin/audit`
- [ ] `/admin/deposits` REAL tab
- [ ] `/admin/trades` REAL tab

---

## 7. Intentionally not UI_ONLY (wired)

Listed so they are not mistaken for gaps:

| Area | Notes |
| --- | --- |
| Auth (`/login`, `/signup`, `/forgot-password`, `/reset-password`, `/auth/confirm`, verify-email) | Supabase Auth |
| `/app/trade` | Live market data; DEMO local engine; REAL Edge + SQL when flags on |
| `/app/wallet` REAL deposit / payout withdraw | When feature flags + secrets allow |
| `/admin/dashboard` | Real staff dashboard |
| `/admin/fees` | Editable payment / trading / payout-desk settings |
| `/admin/withdrawals` → Payout desk + Legacy REAL | Wired panels |

---

*Generated from route + page audit. Re-check after wiring any item above.*
