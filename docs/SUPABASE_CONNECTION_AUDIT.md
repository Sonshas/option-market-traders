# Supabase Connection Audit (read-only)

**Status:** live read-only audit via official Supabase MCP (`plugin-supabase-supabase`, `namespaceStatus: ready`).  
**Date:** 2026-09-19  
**Scope:** connection verification + emptiness confirmation for the **selected** project only.  
**Hard stops honored:** no migrations, no writes, no Edge deploys, no project create/pause/restore, no DEMO engine changes, no REAL-mode / production app wiring.  
**Secrets:** this file contains **no** service-role keys, database passwords, JWT secrets, vault contents, or raw API key values. Project URL and public identifiers only.

**Replaces prior audit content** that treated **Poa Match** (`ddbqjoqkvvgzkoahnoye`) as the connection target. Per explicit user override, the connected target is now **Smart Base Binary**. **VAST DERIV TRADERS** and **Poa Match** remain non-targets for this session.

---

## 1. Authentication & MCP visibility

| Item | Result |
|---|---|
| MCP namespace | `plugin-supabase-supabase` |
| namespaceStatus | `ready` (authenticated) |
| Official remote URL | `https://mcp.supabase.com/mcp` |
| Organization | `rwswljnolimiqypiqvzh` (`sonshasopunga@gmail.com`) |
| Auth method | Existing MCP OAuth session (no re-auth required this run) |

### Projects MCP can see

| Project name | Ref | Region | Status | Role this audit |
|---|---|---|---|---|
| **Smart Base Binary** | `wkfyavcjjuyzvyeprklz` | `eu-west-1` | `ACTIVE_HEALTHY` | **SELECTED / connected target** — audited |
| Poa Match | `ddbqjoqkvvgzkoahnoye` | `eu-west-1` | `ACTIVE_HEALTHY` | **NOT the target** — do not use |
| VAST DERIV TRADERS | `ipczhtendvxlwljeyiyo` | `eu-west-1` | `ACTIVE_HEALTHY` | **EXCLUDED** — do not connect / do not invent schema here |

MCP currently exposes **all three** projects (account-scoped), not a single project-scoped token. Selection for this audit follows the user override: audit **Smart Base Binary** only.

### Optional later frontend `.env` (not created)

When REAL-mode wiring is approved later, the frontend would typically use:

- `VITE_SUPABASE_URL` / `NEXT_PUBLIC_SUPABASE_URL` = `https://wkfyavcjjuyzvyeprklz.supabase.co`
- Publishable / anon key from Dashboard or MCP `get_publishable_keys` at connect time

**Do not** commit real keys. No `.env` with secrets was written in this audit.

---

## 2. Selected project — Smart Base Binary

| Field | Value |
|---|---|
| **Name** | Smart Base Binary |
| **Ref / project id** | `wkfyavcjjuyzvyeprklz` |
| **API URL** | `https://wkfyavcjjuyzvyeprklz.supabase.co` |
| **DB host** | `db.wkfyavcjjuyzvyeprklz.supabase.co` |
| **Region** | `eu-west-1` |
| **Status** | `ACTIVE_HEALTHY` |
| **Postgres** | 17.6.1.166 (engine 17, GA) |
| **Created** | 2026-09-18T07:58:55Z |
| **Publishable / anon keys** | Present via MCP (`get_publishable_keys`) — **not written into this repo**. Fetch from Dashboard or MCP at connect time; never commit. |

### Empty status (confirmed live)

This project is an **empty Supabase shell**: platform defaults only, **no application schema**.

### Installed extensions (active)

- `plpgsql` (pg_catalog)
- `pgcrypto` (extensions)
- `uuid-ossp` (extensions)
- `pg_stat_statements` (extensions)
- `supabase_vault` (vault)

(Many other extensions are available but not installed.)

### Migrations / Edge Functions

| Item | Result |
|---|---|
| Application migrations (`list_migrations`) | **none** (`[]`) |
| Edge Functions (`list_edge_functions`) | **none** (`[]`) |

---

## 3. Schema map (selected project only)

### Public schema

**No application tables.**  
`list_tables` on `public` → `[]`.  
`pg_class` table count for `public` → **0** (schema exists but empty).

### Auth

| Item | Result |
|---|---|
| `auth.users` count | **0** |
| Custom profiles table | **missing** |
| App-level users/roles tables | **missing** |

Stock Supabase Auth tables exist (`auth` schema: 27 platform tables) — platform defaults only. No app linkage tables.

### Storage

| Item | Result |
|---|---|
| Custom buckets | **none** (`storage.buckets` empty) |
| Custom storage RLS policies | **none** (app-level) |

Stock `storage.*` system tables only (8 platform tables).

### Application domains inspected (all missing on Smart Base Binary)

| Domain | Found? | Notes |
|---|---|---|
| Users / profiles | No | No `profiles` / `users` public table; 0 auth users |
| Wallets / balances / ledger | No | No wallet, balance, or ledger tables |
| Deposits / withdrawals / payments | No | No payment or cashflow tables |
| Trades / contracts / settlements | No | No trading tables |
| KYC | No | No KYC tables |
| AI / prediction | No | No AI/prediction tables |
| Admin / roles / permissions | No | No admin/RBAC tables |
| Support / notifications | No | No support/notification tables |
| Custom functions (public) | No | `pg_proc` in `public` empty |
| Storage buckets | No | none |
| Edge Functions | No | none |
| Application migrations | No | none |

### Schemas present (platform defaults only)

`auth`, `extensions`, `graphql`, `graphql_public`, `public`, `realtime`, `storage`, `vault`

---

## 4. What is missing (for a trading platform backend)

Relative to a SmartBaseBinary-style app, this project still needs (later, only when approved):

1. Application tables: profiles, wallets/ledger, trades/contracts, deposits/withdrawals/payments, KYC, admin/RBAC, notifications (as designed)
2. RLS policies matching the product access model
3. Auth users / signup flows wired to the app
4. Storage buckets if KYC / assets require them
5. Edge Functions if needed for settlement, webhooks, or privileged ops
6. Migrations tracked in-repo and applied via approved process
7. Frontend REAL-mode env pointing at this URL + publishable key (not yet)

---

## 5. Local app status (unchanged)

- **DEMO engine** left exactly as-is (Even/Odd, Match/Differ, Over/Under, demo balance/trades/settlement/history/transactions).
- **REAL mode** remains **disconnected** from production — no app wiring performed.
- No `.env` / client config written with Supabase keys in this audit step.

---

## 6. Integrity statement

- **Read-only operations only:** `list_*`, `get_*`, and `SELECT` against catalogs / `auth.users` count / `storage.buckets` / schema emptiness checks.
- **No Supabase data or schema was modified.**
- **No project was created, paused, or restored.**
- **Non-target projects** (Poa Match, VAST DERIV TRADERS) were listed for inventory only; schema deep-dive was not the goal for them in this pass.

---

## 7. Gaps / next steps (not executed)

Smart Base Binary is confirmed as the **MCP-connected empty target**. Before any REAL-mode wiring:

1. Design and apply application schema in a later **explicitly approved** step — **not this audit**.
2. Keep DEMO local; wire REAL only after explicit approval.
3. Prefer project-scoped + read-only MCP when re-authenticating, if the UI offers it.

**STOP after audit.** No production wiring in this session.

---

## 8. Follow-up (2026-09-19) — schema migration completed

Application schema was later applied to **Smart Base Binary** only. See [`docs/SUPABASE_SCHEMA_MIGRATION.md`](./SUPABASE_SCHEMA_MIGRATION.md).

- Migrations: `core_identity_accounts_helpers`, `wallets_ledger_deposits_withdrawals`, `markets_trades_settlements`, `bots_copy_notifications_support_kyc_audit`, `fix_function_search_path`
- VAST DERIV TRADERS / Poa Match: not modified
- DEMO / REAL frontend wiring: still not connected
- No secrets written to the repo
