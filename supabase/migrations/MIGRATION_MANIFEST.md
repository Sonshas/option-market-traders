# Host Supabase migration manifest

Consolidated file: **`20260920111952_smartbasebinary_host_schema.sql`**  
For **fresh Supabase installs only** — replaces the incremental migrations listed below (already applied on production, then deleted).

Verification: each key object was searched in the consolidated SQL (grep). ✅ = found.

---

## `20260920111952_align_markets_catalog_with_app.sql`

| Object | In consolidated |
| --- | --- |
| Constraint `markets_category_check` (crypto category) | ✅ |
| Constraint `markets_price_status_check` | ✅ |
| Seed `markets` (BTCUSDT … AVAXUSDT) | ✅ |
| `feature_flags` updates: `REAL_TRADING_ENABLED`, `REAL_PAYMENTS_ENABLED` | ✅ |
| `feature_flags` insert: `REAL_MARKET_CATALOG_SYNCED` | ✅ |

---

## `20261003000000_megapay_deposits.sql`

| Object | In consolidated |
| --- | --- |
| Indexes: `deposits_provider_reference_uniq`, `deposits_megapay_*`, `wallet_ledger_deposit_reference_uniq` | ✅ |
| Policy `deposits_block_client_megapay` | ✅ |
| Table `megapay_webhook_events` | ✅ |
| Function `credit_megapay_deposit` | ✅ |
| Function `fail_megapay_deposit` | ✅ |

---

## `20261003120000_real_trading_engine.sql`

| Object | In consolidated |
| --- | --- |
| Columns on `trades` / `trade_settlements` (`entry_epoch`, `details`, …) | ✅ |
| Constraint `trades_exit_digit_check` | ✅ |
| Seed `markets` (1HZ10V … 1HZ100V) | ✅ |
| Restrictive RLS policies `*_block_client_*` on money tables | ✅ |
| Indexes: `wallet_ledger_real_trade_entry_uniq`, `trades_user_idempotency_idx`, `trades_real_open_idx` | ✅ |
| Function `place_real_trade` | ✅ |
| Function `settle_real_trade` | ✅ |
| Function `refund_real_trade` | ✅ |
| Vault secret `real_trade_sweep_secret` | ✅ |
| Function `verify_real_trade_sweep_secret` | ✅ |

---

## `20261003120100_real_trading_settlement_cron.sql`

| Object | In consolidated |
| --- | --- |
| Extensions `pg_cron`, `pg_net` | ✅ |
| Cron job `real-trade-settle-sweep` | ✅ |

---

## `20261003170000_real_trading_payout_model.sql`

| Object | In consolidated |
| --- | --- |
| Table `trading_settings` | ✅ |
| Policy `trading_settings_read` | ✅ |
| Setting `REAL_DAILY_PROFIT_LIMIT_USD` | ✅ |
| Function `real_digit_payout_rate` | ✅ |
| Function `real_trade_daily_status` | ✅ |
| Replaced `place_real_trade` / `settle_real_trade` (payout model) | ✅ |

---

## `20261003200000_real_trading_tick_duration.sql`

| Object | In consolidated |
| --- | --- |
| Columns `duration_ticks`, `tick_anchor_epoch`; constraint `trades_duration_ticks_chk` | ✅ |
| Function `place_real_tick_trade` | ✅ |
| Replaced `settle_real_trade` (tick branch) | ✅ |
| Replaced `refund_real_trade` (tick refund window) | ✅ |

---

## `20261004090000_daraja_deposits.sql`

| Object | In consolidated |
| --- | --- |
| Columns on `deposits` (Daraja / M-Pesa result fields) | ✅ |
| Indexes: `deposits_checkout_request_id_uniq`, `deposits_daraja_*` | ✅ |
| Policy `deposits_block_client_daraja` | ✅ |
| Updated `credit_megapay_deposit` / `fail_megapay_deposit` (daraja provider) | ✅ |
| Cron job `mpesa-deposit-sweep` | ✅ |

---

## `20261004130000_real_withdrawals.sql`

| Object | In consolidated |
| --- | --- |
| Columns / constraints on `withdrawals` | ✅ |
| `wallet_ledger_entry_type_check` (+ withdrawal hold/paid/refund) | ✅ |
| Index `wallet_ledger_withdrawal_entry_uniq` | ✅ |
| Policies `withdrawals_block_client_*` | ✅ |
| Realtime on `withdrawals` | ✅ |
| Flag `REAL_WITHDRAWALS_ENABLED` | ✅ |
| Function `request_real_withdrawal` | ✅ |
| Function `mark_withdrawal_processing` | ✅ |
| Function `complete_withdrawal` | ✅ |
| Function `fail_withdrawal` | ✅ |
| Cron job `mpesa-withdraw-dispatch` | ✅ |

---

## `20261005160000_payout_fee_stk_requests.sql`

| Object | In consolidated |
| --- | --- |
| Table `payout_fee_stk_requests` | ✅ |
| Index `payout_fee_stk_requests_ref` | ✅ |
| RLS (service_role only) | ✅ |

---

## `20261005170000_account_win_rate_90.sql`

| Object | In consolidated |
| --- | --- |
| `real_digit_payout_rate` (fixed n=9 / 90% margin) | ✅ |
| `settle_real_trade` (digit 0–8 won, 9 lost) | ✅ |
| Comment `ACCOUNT_WINNING_DIGIT_COUNT` | ✅ |

---

## `20261005180000_payment_settings.sql`

| Object | In consolidated |
| --- | --- |
| Table `payment_settings` | ✅ |
| Policy `payment_settings_read` | ✅ |
| `trading_settings` keys: stake min/max, max open trades | ✅ |
| Function `real_stake_bounds` | ✅ |
| Function `real_max_open_trades` | ✅ |
| Replaced `place_real_tick_trade` (settings-driven bounds) | ✅ |

---

## `20261005190000_place_real_trade_stake_bounds.sql`

| Object | In consolidated |
| --- | --- |
| Replaced `place_real_trade` (uses `real_stake_bounds` / `real_max_open_trades`) | ✅ |

---

## `20261005200000_natural_contract_settlement.sql`

| Object | In consolidated |
| --- | --- |
| Replaced `settle_real_trade` (natural EVEN/ODD/MATCH/DIFFER/OVER/UNDER) | ✅ |

---

## `20261005210000_system_issues.sql`

| Object | In consolidated |
| --- | --- |
| Table `system_issues` (RLS, no client access) | ✅ |
| Function `report_system_issue` (service_role only) | ✅ |

---

## `20261007120000_flat_digit_payout_rate.sql`

| Object | In consolidated |
| --- | --- |
| Replaced `real_digit_payout_rate` (flat 0.9 for winnable contracts, 0 otherwise) | ✅ |

---

## `20261007150000_superadmin_panel.sql`

| Object | In consolidated |
| --- | --- |
| Table `app_admins` (seed `sonshasopunga@gmail.com` as `superadmin`) | ✅ |
| Functions `is_superadmin_user`, `is_superadmin`, `admin_access_level`, `assert_superadmin`, `clean_admin_reason` | ✅ |
| Trigger `sync_superadmin_app_role` on `auth.users` (+ backfill of `app_metadata.role` / `public.users.role`) | ✅ |
| Table `admin_audit_log` (+ indexes, policy `admin_audit_log_read`), function `write_admin_audit` | ✅ |
| Tables `simulated_balances`, `simulated_open_stakes`, `simulated_balance_ledger` (+ policies) | ✅ |
| Functions `ensure_simulated_balances`, `my_simulated_balances`, `apply_simulated_change` | ✅ |
| Functions `admin_set_simulated_balance`, `admin_reset_simulated_balances` | ✅ |
| Tables `simulation_settings`, `simulated_win_rate_overrides`, `simulation_signals` (+ policies) | ✅ |
| Functions `my_simulated_win_rate`, `admin_set_global_win_rate`, `admin_set_user_win_rate` | ✅ |

---

## Section markers

All `-- from: <filename>` section markers are present in the consolidated file. ✅

## Workflow for new migrations

1. Create `supabase/migrations/<timestamp>_name.sql`.
2. Apply to production (`npx supabase db query --linked -f …`) and record it (`npx supabase migration repair --status applied <timestamp> --linked`).
3. Append it to the consolidated file under a `-- from: <filename>` marker, add it to the header list and to this manifest.
4. Delete the individual file.
