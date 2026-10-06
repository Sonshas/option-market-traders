# Final Supabase Verification — Smart Base Binary

**Date:** 2026-09-21  
**Mode:** READ-ONLY (no writes, no migrations, no resets, no data changes)  
**Verified via:** Supabase MCP (`list_projects`, `get_project`, `list_tables`, `list_migrations`, `execute_sql`) + application source inspection  

---

## Scope and exclusions

| Rule | Status |
|------|--------|
| Use **only** Smart Base Binary | **PASS** — all SQL against `wkfyavcjjuyzvyeprklz` |
| Do **not** touch VAST DERIV TRADERS | **PASS** — project `ipczhtendvxlwljeyiyo` listed only, never queried |
| Do **not** create another project | **PASS** |
| Do **not** delete/reset/migrate financial/user data | **PASS** — SELECT / metadata only |
| Do **not** enable REAL trade execution / payments | **PASS** — flags remain `false` |
| Do **not** modify production data | **PASS** |

Other org projects (not used):

| Name | Ref | Action |
|------|-----|--------|
| Poa Match | `ddbqjoqkvvgzkoahnoye` | Ignored |
| VAST DERIV TRADERS | `ipczhtendvxlwljeyiyo` | Ignored |
| **Smart Base Binary** | **`wkfyavcjjuyzvyeprklz`** | **Verified** |

---

## 1. Current Supabase project

| Field | Value |
|-------|--------|
| **Name** | Smart Base Binary |
| **Reference / id** | `wkfyavcjjuyzvyeprklz` |
| **API URL** | `https://wkfyavcjjuyzvyeprklz.supabase.co` |
| **DB host** | `db.wkfyavcjjuyzvyeprklz.supabase.co` |
| **Region** | `eu-west-1` |
| **Status** | `ACTIVE_HEALTHY` |
| **Postgres** | 17.6.x |
| **Created** | 2026-09-18 |

**App config:** `apps/web/.env` and `apps/api/.env` point at this project only (`VITE_SUPABASE_URL` / `SUPABASE_URL` = `https://wkfyavcjjuyzvyeprklz.supabase.co`).

---

## 2. Existing users / profiles / accounts

### Row counts

| Store | Count |
|-------|------:|
| `auth.users` | 1 |
| `public.users` | 1 |
| `public.profiles` | 1 |
| `public.accounts` | 2 |

### Logged-in identity (sole user)

| Field | Value |
|-------|--------|
| Auth / public user id | `774d72c7-b97e-4205-8f48-8531a786efa0` |
| Email | `sonshasopunga@gmail.com` |
| Email confirmed | **Yes** |
| Auth created | 2026-09-20 11:15:23 UTC |
| Role | `trader` |
| Account status | `active` |
| KYC status | `not_started` |
| Profile display name | `Sonsha Sopunga` |
| Profile `user_id` | same UUID (1:1 with auth) |

### Accounts

| Account id | Mode | Status |
|------------|------|--------|
| `85bf87b0-ff14-4272-8436-1909d72bb907` | `demo` | `active` |
| `88eae5dd-5fa4-4fd4-a6e4-a20748760fc0` | `real` | `active` |

Both accounts belong to the same user above (signup trigger provisioned demo + real).

---

## 3. Demo and real wallets and relationships

| Wallet id | Mode | Account id | Currency | Balance | Available | Locked | `is_simulated` | Status |
|-----------|------|------------|----------|--------:|----------:|-------:|:--------------:|--------|
| `e49aa000-214b-410d-af46-281273342dce` | `demo` | `85bf87b0-…` | USD | **0** | **0** | **0** | `true` | `ready` |
| `22f57d87-ad8f-4b68-a3ad-7074ba6cb3da` | `real` | `88eae5dd-…` | USD | **0** | **0** | **0** | `false` | `ready` |

**Relationships:**

```
auth.users.id
  → public.users.id
  → public.profiles.user_id
  → public.accounts.user_id  (demo + real)
       → public.wallets.account_id  (1 wallet per account)
```

**App behavior note:**

- **DEMO UI balance** comes from **local** `localStorage` demo store (`DEMO_STARTING_BALANCE = 10000`), not from the Supabase demo wallet row (which is `0` / simulated flag). DEMO is explicitly labelled simulated.
- **REAL UI balance** is loaded from Supabase `wallets` where `account_mode = 'real'` and `is_simulated = false` (`realWalletProvider`). No fabricated positive REAL balance.

---

## 4. Wallet ledger / transaction relationships

| Table | Count | Notes |
|-------|------:|-------|
| `wallet_ledger` | **0** | Empty — no ledger postings |
| `transactions` | **0** | Empty |

**FK graph (financial):**

| Table | FK → |
|-------|------|
| `wallets.account_id` | `accounts.id` |
| `wallet_ledger.wallet_id` | `wallets.id` |
| `wallet_ledger.account_id` | `accounts.id` |
| `transactions.wallet_id` | `wallets.id` |
| `transactions.account_id` | `accounts.id` |
| `deposits.wallet_id` / `account_id` | `wallets` / `accounts` |
| `withdrawals.wallet_id` / `account_id` | `wallets` / `accounts` |
| `trades.wallet_id` / `account_id` / `symbol` | `wallets` / `accounts` / `markets` |
| `trade_settlements.trade_id` / `account_id` | `trades` / `accounts` |

---

## 5. Deposits and withdrawals

| Table | Count |
|-------|------:|
| `deposits` | **0** |
| `withdrawals` | **0** |

RLS allows authenticated **INSERT** of own `PENDING` / `real` / `is_simulated = false` deposit/withdrawal rows, but the **application** keeps payment APIs disabled (`paymentConfigured: false` → `REAL_PAYMENTS_UNAVAILABLE`). No rows exist.

---

## 6. Trade and settlement tables

| Table | Count |
|-------|------:|
| `trades` | **0** |
| `trade_settlements` | **0** |

RLS: **SELECT** only for own rows (or staff). No client INSERT policies for trades — consistent with execution remaining off.

---

## 7. Bots / AI / prediction / copy tables

| Table | Count | Notes |
|-------|------:|-------|
| `bots` | **0** | Catalog empty (no bot definitions seeded) |
| `bot_runs` | **0** | |
| `copy_traders` | **0** | |
| `copy_trades` | **0** | |

Feature flags: `REAL_BOTS_ENABLED = false`, `REAL_COPY_ENABLED = false`.

No separate “AI/prediction” tables beyond bots/copy in `public`.

---

## 8. KYC / support / admin tables

| Table | Count |
|-------|------:|
| `kyc_reviews` | **0** |
| `support_tickets` | **0** |
| `support_messages` | **0** |
| `notifications` | **0** |
| `audit_log` | **0** |
| `feature_flags` | **6** |
| `markets` | **13** |

`feature_flags` keys: `KYC_REQUIRED`, `REAL_BOTS_ENABLED`, `REAL_COPY_ENABLED`, `REAL_MARKET_CATALOG_SYNCED`, `REAL_PAYMENTS_ENABLED`, `REAL_TRADING_ENABLED`.

---

## 9. RLS policies affecting the logged-in user

- **RLS enabled** on **all 21** `public` tables.
- Role used by the app client: **`authenticated`** (anon key + user JWT).

### What the trader (`auth.uid() = 774d72c7-…`) can do

| Area | Policies (summary) |
|------|-------------------|
| Identity | `users` / `profiles` / `accounts` / `wallets`: **SELECT** own rows; limited **UPDATE** on own `users`/`profiles` |
| Money reads | `wallet_ledger`, `transactions`, `trades`, `trade_settlements`, `deposits`, `withdrawals`: **SELECT** own only |
| Money writes | **No** INSERT/UPDATE on wallets, ledger, transactions, trades, settlements |
| Deposits / withdrawals | **INSERT** own `PENDING` + `account_mode = real` + `is_simulated = false` only (app still refuses to call this path) |
| Catalog | `markets`, `feature_flags`, active `bots`/`copy_traders`: **SELECT** |
| Support | Own tickets/messages insert/select; staff via `is_platform_staff()` |
| Audit | `audit_log`: **SELECT** staff only |

There is **no** policy granting traders the ability to invent balances or complete deposits/withdrawals/trades via the Data API.

---

## 10. Auth user → public user / profile relationship

**Confirmed 1:1:**

```
auth.users.id = public.users.id = public.profiles.user_id
= 774d72c7-b97e-4205-8f48-8531a786efa0
```

Email matches across `auth.users` and `public.users`. Profile row present with display name.

---

## 11. Application reads existing database vs local fake data

| Mode | Source of truth | Fake / local? |
|------|-----------------|---------------|
| **Auth / session** | Supabase Auth (`wkfyavcjjuyzvyeprklz`) | No |
| **REAL wallet / tx / deposits / withdrawals / trades** | Supabase tables via `realWalletProvider` / `realTradingProvider` (RLS) | No — empty or authentic `0` |
| **DEMO wallet / trades / ledger** | Browser `localStorage` (`sbb.demo.v1`) | **Yes — simulated only**, labelled DEMO |
| **REAL market prices/charts** | Deriv public WebSocket (not Supabase) | Live provider ticks; not DEMO simulation |
| **Markets catalog in DB** | `public.markets` (13 symbols) | Metadata only; app REAL feed uses Deriv/Binance providers, not DB ticks |

**Verdict:** REAL financial identity and wallet reads use the existing Supabase project. DEMO practice money is local/simulated and must not be treated as REAL.

---

## 12. No fake balances / fake financial transactions shown as REAL

| Check | Result |
|-------|--------|
| REAL Supabase wallet balance | Authentic **$0** (no deposits) |
| REAL ledger / transactions / deposits / withdrawals / trades | **All empty** |
| REAL UI capability labels | Balance / Trading / Deposits / Withdrawals shown as **NOT CONNECTED** in REAL header (`buildRealAccountView` / TradeTicket) |
| DEMO $10,000 practice balance | Local only; `isSimulated`; DEMO labels |
| Fabricated profits / completed REAL txs | **None** in DB or REAL providers |

When signed in, a connected REAL wallet may surface the authentic ledger **0** via `formatMoney` — that is the real row, not a invented profit balance.

---

## 13. `REAL_TRADING_ENABLED` remains false

| Layer | Value |
|-------|--------|
| Supabase `feature_flags.REAL_TRADING_ENABLED` | **`false`** |
| App `REAL_INTEGRATION.executionConfigured` | **`false`** (`apps/web/src/providers/config.ts`) |
| `realTradingProvider.placeTrade` | Returns `REAL_TRADING_UNAVAILABLE` / execution not connected |

---

## 14. `REAL_PAYMENTS_ENABLED` remains false

| Layer | Value |
|-------|--------|
| Supabase `feature_flags.REAL_PAYMENTS_ENABLED` | **`false`** |
| App `REAL_INTEGRATION.paymentConfigured` | **`false`** |
| `realWalletProvider` deposit/withdrawal create | Returns `REAL_PAYMENTS_UNAVAILABLE` |

---

## 15. Market-data work did not modify financial records

Market-data Phase 1 (Deriv WS / charts) is **frontend-only**. Evidence from DB:

| Check | Value |
|-------|--------|
| `wallet_ledger` / `transactions` / `deposits` / `withdrawals` / `trades` rows after market-data window | **0** |
| `wallets.updated_at` (both wallets) | `2026-09-20 11:15:23` — **unchanged since signup** |
| Ledger max `updated_at` | `null` (no rows) |

Applied migrations on this project (historical; **none applied during this verification**):

1. `20260919163323_core_identity_accounts_helpers`
2. `20260919163356_wallets_ledger_deposits_withdrawals`
3. `20260919163417_markets_trades_settlements`
4. `20260919163501_bots_copy_notifications_support_kyc_audit`
5. `20260919163523_fix_function_search_path`
6. `20260920111952_align_markets_catalog_with_app` — markets catalog + feature-flag notes only (not balances/ledger)

---

## Public schema inventory (21 tables)

`accounts`, `audit_log`, `bot_runs`, `bots`, `copy_traders`, `copy_trades`, `deposits`, `feature_flags`, `kyc_reviews`, `markets`, `notifications`, `profiles`, `support_messages`, `support_tickets`, `trade_settlements`, `trades`, `transactions`, `users`, `wallet_ledger`, `wallets`, `withdrawals`

---

## Summary verdict

| # | Question | Answer |
|---|----------|--------|
| 1 | Project | **Smart Base Binary** / `wkfyavcjjuyzvyeprklz` |
| 2 | Users/profiles/accounts | 1 auth+public user, 1 profile, 2 accounts (demo+real) |
| 3 | Wallets | 2 wallets linked 1:1 to accounts; demo simulated $0 DB / real non-simulated $0 |
| 4 | Ledger/transactions | Empty; FKs intact |
| 5 | Deposits/withdrawals | Empty |
| 6 | Trades/settlements | Empty |
| 7 | Bots/copy | Empty tables; flags off |
| 8 | KYC/support/admin | Empty operational tables; 6 feature flags; 13 markets |
| 9 | RLS | On everywhere; trader self-select; no balance mutation paths |
| 10 | Auth→profile | 1:1 UUID match |
| 11 | App reads existing DB for REAL | **Yes** (DEMO local simulated) |
| 12 | No fake REAL money | **Confirmed** |
| 13 | REAL trading enabled | **`false`** |
| 14 | REAL payments enabled | **`false`** |
| 15 | Market data mutated finance | **No** |

**STOP.** No further database changes were made in this verification. Await explicit instruction before any schema or financial work.
