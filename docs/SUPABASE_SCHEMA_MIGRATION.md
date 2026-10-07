# Smart Base Binary — schema migration

**Date:** 2026-09-20  
**Target project:** Smart Base Binary (`wkfyavcjjuyzvyeprklz`)  
**API URL:** `https://wkfyavcjjuyzvyeprklz.supabase.co`  
**Secrets:** none in this file

---

## Project selection

| Project | Ref | Used? |
|---|---|---|
| **Smart Base Binary** | `wkfyavcjjuyzvyeprklz` | **Yes** |
| VAST DERIV TRADERS | `ipczhtendvxlwljeyiyo` | **No** |
| Poa Match | `ddbqjoqkvvgzkoahnoye` | **No** |

---

## Migrations on remote

| Version | Name |
|---|---|
| `20260919163323` | `core_identity_accounts_helpers` |
| `20260919163356` | `wallets_ledger_deposits_withdrawals` |
| `20260919163417` | `markets_trades_settlements` |
| `20260919163501` | `bots_copy_notifications_support_kyc_audit` |
| `20260919163523` | `fix_function_search_path` |
| `20260920111952` | `align_markets_catalog_with_app` **(new)** |

Local copy (fresh installs): `supabase/migrations/20260920111952_smartbasebinary_host_schema.sql` — see section `from: 20260920111952_align_markets_catalog_with_app.sql` in `supabase/migrations/MIGRATION_MANIFEST.md`

---

## What this latest migration did

- Allowed `markets.category = crypto` (in addition to synthetic/forex)
- Expanded `price_status` for reconnecting/error
- Upserted **8 Binance catalog symbols** (BTCUSDT…AVAXUSDT) with `last_price = NULL`, `is_simulated = false`, `feed_label = binance_public`
- Kept synthetic Volatility R_* markets
- Kept `REAL_TRADING_ENABLED = false` and `REAL_PAYMENTS_ENABLED = false`
- Set `REAL_MARKET_CATALOG_SYNCED = true` (catalog only — not execution)

**Markets now:** 13 total (8 crypto + 5 synthetic)

---

## Confirmed preserved

- Existing auth users / wallets / accounts **not deleted**
- No fake balances, deposits, withdrawals, trades, or settlements created
- DEMO local simulator untouched
- REAL order execution still **disabled**

---

## Security advisor

Warn only: Auth leaked-password protection disabled in project Auth settings  
([remediation](https://supabase.com/docs/guides/auth/password-security#password-strength-and-leaked-password-protection))

---

## Still not migrated / still disabled

App UI and DEMO engine live in the frontend repo — not “migrated” as SQL.  
Still gated until separately approved:

- REAL trade execution / settlement RPCs
- Payment provider completion
- KYC upload workflows
- TOTP 2FA
