# SmartBaseBinary Supabase read-only audit

**Status:** live read-only audit completed via the official Supabase MCP (`plugin-supabase-supabase`, `namespaceStatus: ready`).  
**Date:** 2026-09-17  
**Scope:** schema, RLS, functions, triggers, views, storage, auth metadata. No writes, no migrations, no Edge Function deploys, no data mutation.  
**Secrets:** this file contains no passwords, hashes, service-role keys, database passwords, private API keys, payment credentials, or publishable/anon key values. Hash/ciphertext column **names** are listed; values were not selected.

---

## 1. Project identity

The authenticated account has **two** Supabase projects in organization id `rwswljnolimiqypiqvzh`. None is named “SmartBaseBinary”.

| Project name | Ref / id | Region | Status | Public tables | Match |
|---|---|---|---|---|---|
| **VAST DERIV TRADERS** | `ipczhtendvxlwljeyiyo` | `eu-west-1` | `ACTIVE_HEALTHY` | 35 application tables covering users, wallets, binary trades, payments, KYC, support, AI | **Audited.** This is the existing SmartBaseBinary backend. |
| Poa Match | `ddbqjoqkvvgzkoahnoye` | `eu-west-1` | `ACTIVE_HEALTHY` | none (`list_tables` returned `[]`) | Alternative only. Not audited beyond listing. |

**Audited project**

- **Name:** VAST DERIV TRADERS
- **Ref / project id:** `ipczhtendvxlwljeyiyo`
- **API URL:** `https://ipczhtendvxlwljeyiyo.supabase.co`
- **DB host:** `db.ipczhtendvxlwljeyiyo.supabase.co`
- **Postgres:** 17.6.1.166 (engine 17, GA)
- **Created:** 2026-08-30T22:17:02Z
- **Publishable / anon keys:** `get_publishable_keys` was not written into this repo (safety block). Fetch them from the Supabase dashboard or MCP when wiring the new app; never commit them.

Row counts below are **observed at audit time**, not schema.

---

## 2. How `auth.users` links to application profiles

There is **no `profiles` table**. Application identity lives in `public.users`.

1. **Primary key match + FK:** `public.users.id` is `uuid` PK and `FOREIGN KEY (id) REFERENCES auth.users(id) ON DELETE CASCADE`.
2. **Signup trigger:** `auth.users` has `AFTER INSERT` trigger `on_auth_user_created` → `public.handle_new_user()` (SECURITY DEFINER).
   - Inserts `public.users` with the same `id`, email, display name from `raw_user_meta_data->>'name'` (fallback: local-part of email), default role `trader`.
   - On conflict of `id`, updates email; promotes role to `superadmin` only in a hardcoded-email special case (email **redacted** here).
   - Inserts two wallets: `(user_id, kind='demo')` and `(user_id, kind='live')`, currency `USD`, balance `0`, `ON CONFLICT (user_id, kind) DO NOTHING`.
3. **Most child tables FK `user_id` → `auth.users(id)`**, not `public.users(id)`. The app profile is still 1:1 with Auth via shared UUID.
4. **Staff role** is **not** taken from `public.users.role` for RLS. `current_app_role()` reads JWT `app_metadata.role` (plus a hardcoded-email superadmin override, redacted). `is_platform_staff()` is true for `superadmin|admin|support|finance|compliance`.

Observed: `auth.users` 648 rows, `public.users` 648 rows, `public.wallets` 1296 rows (exactly 2 wallets per user).

---

## 3. Installed extensions (installed_version not null)

| Extension | Schema | Version |
|---|---|---|
| `plpgsql` | `pg_catalog` | 1.0 |
| `pgcrypto` | `extensions` | 1.3 |
| `uuid-ossp` | `extensions` | 1.1 |
| `pg_stat_statements` | `extensions` | 1.11 |
| `supabase_vault` | `vault` | 0.3.1 |

Not installed (available but `installed_version` null): `pg_cron`, `pg_net`, `pg_graphql`, `vector`, `http`, and the rest of the catalog list. Vault table `vault.secrets` exists with 0 rows; values were not read.

**Schemas present:** `auth`, `extensions`, `graphql`, `graphql_public`, `public`, `realtime`, `storage`, `supabase_migrations`, `vault`.

---

## 4. Auth configuration (non-secret)

Observed from Auth tables, triggers, advisors, and migration names — **GoTrue dashboard JSON was not readable as SQL**.

| Setting | Observation |
|---|---|
| Identity providers | Only `email` (648 identities). SSO / SAML / custom OAuth tables are empty. |
| Phone | 0 `auth.users.phone` values. |
| Email confirmation | Migration `auth_disable_email_confirmation`. BEFORE INSERT triggers `auth_users_autoconfirm` / `auth_identities_autoconfirm` set `email_confirmed_at` and `identity_data.email_verified=true` for email signups. All 648 users have `email_confirmed_at` set. |
| MFA | TOTP exists: 2 verified, 17 unverified. Recovery-code tables empty. |
| SSO users | 0 |
| Soft-deleted users | 0 |
| OAuth clients / WebAuthn | empty |
| Leaked password protection | Advisor: **disabled** ([docs](https://supabase.com/docs/guides/auth/password-security#password-strength-and-leaked-password-protection)) |

---

## 5. Tables by domain

All **public** tables have **RLS enabled**. Force RLS is off. Column types from live `list_tables` + `information_schema`. `numeric` columns are unconstrained Postgres `numeric` unless noted. Secret-bearing columns are named only.

### 5.1 Users, roles, admin

#### `public.users` (648 rows) — application profile

| Column | Type | Nullable | Default / check |
|---|---|---|---|
| `id` | uuid PK | no | FK → `auth.users(id)` ON DELETE CASCADE |
| `email` | text | yes | |
| `name` | text | yes | |
| `created_at` | timestamptz | no | `now()` |
| `updated_at` | timestamptz | no | `now()` |
| `role` | text | no | `'trader'`; check: `superadmin\|admin\|support\|finance\|compliance\|trader` |
| `account_status` | text | no | `'active'`; check: `active\|suspended` |
| `live_trading_enabled` | boolean | no | `false` |
| `kyc_status` | text | no | `'not_started'`; check: `not_started\|pending\|under_review\|approved\|rejected` |
| `suspended_at` | timestamptz | yes | |

No dedicated `admin`, `roles`, or `permissions` tables. Staff powers are JWT `app_metadata.role` + RPCs (`admin_*`).

#### `public.audit_log` (12587 rows)

| Column | Type | Nullable | Default |
|---|---|---|---|
| `id` | bigint identity PK | no | ALWAYS |
| `actor_id` | uuid | yes | FK → `auth.users(id)` (no ON DELETE specified) |
| `actor_email` | text | yes | |
| `action` | text | no | |
| `target_type` | text | yes | |
| `target_id` | text | yes | |
| `before_state` | jsonb | yes | |
| `after_state` | jsonb | yes | |
| `ip` | text | yes | |
| `created_at` | timestamptz | no | `now()` |

#### `public.feature_flags` (5 rows)

PK `key` text. Columns: `value` boolean default false, `updated_by` uuid FK `auth.users`, `updated_at` timestamptz default `now()`.

Keys present: `LIVE_BINARY_ENABLED`, `LIVE_FOREX_ENABLED`, `LIVE_TRADING_ENABLED`, `MPESA_ENABLED`, `UPESI_PAY_ENABLED`. Boolean values not copied here.

#### `public.provider_accounts` (0 rows)

Provider-linked trading accounts. Unique `(user_id, provider)`. Check: provider `deriv|mt5`; `account_kind` `demo|real`. Column `token_ciphertext` **exists** (token material; values not read).

#### `public.provider_connections` (0 rows)

Health of a provider feed: `provider`, `status`, `last_tick_at`, `last_error`, `reconnect_attempts`.

#### `public.provider_errors` (0 rows)

Per-user provider error log.

**Missing vs requested domains:** no `notifications` table.

---

### 5.2 Wallets, balances, ledger (financial-critical)

#### `public.wallets` (1296 rows)

Unique `(user_id, kind)`. FK `user_id` → `auth.users(id)` ON DELETE CASCADE.

| Column | Type | Nullable | Default / check |
|---|---|---|---|
| `id` | uuid PK | no | `gen_random_uuid()` |
| `user_id` | uuid | no | |
| `kind` | text | no | `demo\|live` |
| `currency` | text | no | `'USD'` |
| `balance` | numeric | no | `0` |
| `available_balance` | numeric | no | `0` |
| `locked_balance` | numeric | no | `0`; CHECK both available and locked ≥ 0 |
| `win_rate` | numeric | no | `0.90`; CHECK 0–1 |
| `created_at` / `updated_at` | timestamptz | no | `now()` |

#### `public.wallet_ledger` (12266 rows)

Append-style ledger tied to binary contracts.

| Column | Type | Nullable | Notes |
|---|---|---|---|
| `id` | uuid PK | no | |
| `wallet_id` | uuid | no | FK wallets ON DELETE CASCADE |
| `user_id` | uuid | no | FK auth.users ON DELETE CASCADE |
| `contract_id` | uuid | yes | FK binary_contracts ON DELETE SET NULL |
| `type` | text | no | (no check constraint observed) |
| `amount` | numeric | no | |
| `available_after` | numeric | no | |
| `locked_after` | numeric | no | |
| `note` | text | yes | |
| `created_at` | timestamptz | no | `now()` |

#### `public.wallet_transactions` (12275 rows)

| Column | Type | Nullable | Check / default |
|---|---|---|---|
| `id` | uuid PK | no | |
| `wallet_id` | uuid | no | FK wallets CASCADE |
| `user_id` | uuid | no | FK auth.users CASCADE |
| `type` | text | no | `deposit\|withdrawal\|trade_stake\|trade_payout\|trade_refund\|adjustment\|lock\|unlock\|win_credit\|loss_release` |
| `amount` | numeric | no | |
| `balance_after` | numeric | yes | |
| `status` | text | no | default `completed`; `pending\|completed\|rejected\|failed` |
| `reference` | text | yes | |
| `note` | text | yes | |
| `created_at` | timestamptz | no | `now()` |

---

### 5.3 Deposits, withdrawals, payments (financial-critical)

#### `public.payment_transactions` (278 rows)

Gateway row. Unique `provider_request_id`; unique partial index on `reference` where not null.

| Column | Type | Nullable | Default / check |
|---|---|---|---|
| `id` | uuid PK | no | |
| `user_id` | uuid | no | FK auth.users CASCADE |
| `provider` | text | no | `'none'` |
| `direction` | text | no | `deposit\|withdrawal\|fee` |
| `amount` | numeric | no | |
| `currency` | text | no | `'USD'` |
| `phone` | text | yes | (PII; not selected) |
| `reference` | text | yes | |
| `provider_request_id` | text | yes | unique |
| `provider_receipt` | text | yes | |
| `status` | text | no | default `not_connected`; `not_connected\|pending\|processing\|completed\|failed\|cancelled\|timeout` |
| `reconciliation_status` | text | no | `'unreconciled'` |
| `callback_metadata` | jsonb | yes | |
| `amount_kes` | numeric | yes | |
| `merchant_request_id` | text | yes | |
| `purpose` | text | yes | |
| `created_at` / `updated_at` | timestamptz | no | `now()` |

#### `public.deposit_requests` (210 rows)

FK `payment_id` → payment_transactions ON DELETE SET NULL. Method check: `mpesa|bank|crypto|upesi` or null. Default status `'not_connected'`. `details` jsonb default `{}`.

#### `public.withdrawal_requests` (31 rows)

Statuses: `pending|requested|processing|completed|failed|cancelled|under_review|approved|rejected|pending_compliance`. Destination type: `mpesa|bank|crypto` or null. `destination_details` jsonb default `{}`.

#### `public.platform_fee_payments` (74 rows)

Fee kinds: `compliance_fee_1|compliance_fee_2|ai_bot_fee|withdraw_release_fee`. Unique `(user_id, fee_kind)` **where status = completed**. Amount in KES.

#### `public.upesi_deposit_secrets` (278 rows) — secret table

Columns: `payment_id` PK FK payment_transactions CASCADE, `user_id` FK auth.users CASCADE, `apply_token_hash` text, `used_at` timestamptz, `created_at`. **RLS on, no policies** (deny-all via Data API). Hash values not read.

#### `public.upesi_gateway_secrets` (1 row) — secret table

Singleton (`id` CHECK `= 1`). Column `pepper_hash` text. **RLS on, no policies**. Hash values not read.

#### `public.transactions` (0 rows)

Older/generic provider money-movement table: `provider`, `amount`, `kind`, `status` default `pending`, `provider_ref`, `note`.

---

### 5.4 Trades and binary engine (financial-critical)

#### `public.binary_contracts` (5805 rows) — live binary book

Unique `(user_id, idempotency_key)`. Types: `buy|sell|odd|even|over|under|match|differ`. Mode `demo|live`. Status `open|won|lost|tie`. Optional `stop_loss` / `take_profit` (> 0). `close_reason` `expiry|stop_loss|take_profit` or null. `target_digit` 0–9 or null. Stake > 0.

#### `public.binary_settlements` (5791 rows)

1:1 unique `contract_id`. FK contract **ON DELETE RESTRICT**. Outcome `win|loss|tie`. Immutable via trigger (no UPDATE/DELETE).

#### `public.trades` (8 rows)

Provider/demo trade history (broader product). Unique `(user_id, idempotency_key)` where idempotency_key is not null. Record mode `demo|live`. Extra fields: `product_type`, `payout_rate`, `duration_ms`, `requested_price`, `purchase_price`, `payout`, `instrument_id`, `close_time`, `barrier`, `multiplier`, `stop_loss`, `target_profit`, `error_text`.

#### `public.orders` (0), `public.positions` (0), `public.contracts` (0), `public.trade_events` (0)

Provider-style (Deriv/MT5) order/position/contract surfaces. `contracts.record_mode` `demo|live`. `trade_events.payload` jsonb; `contract_id` FK `contracts` ON DELETE SET NULL.

#### `public.markets` (0 rows)

Catalog: PK `symbol`. Defaults include durations `{2000,15000,30000,60000,300000}` ms and contracts `{buy,sell}`.

#### `public.market_symbols` (0), `public.market_ticks` (5793)

Tick feed. `market_ticks.id` bigint identity. Indexed by `(provider, symbol, tick_timestamp DESC)` and `(symbol, tick_timestamp DESC)`.

#### `public.risk_settings` (1 row)

PK default `'global'`. Stake/exposure/multiplier/rate limits.

#### `public.risk_events` (978 rows)

`kind`, `reason`, `payload` jsonb. RLS SELECT policy is `false` (no client reads). FK user ON DELETE SET NULL.

---

### 5.5 KYC

#### `public.kyc_reviews` (0 rows)

Status same enum as `users.kyc_status`. `reviewer_id` FK auth.users (no cascade). User FK CASCADE.

Storage bucket `kyc-documents` (private) is the document store; path prefix must be `auth.uid()` (see Storage).

---

### 5.6 Support

#### `public.support_conversations` (60 rows)

Status `open|closed`. FK user CASCADE.

#### `public.support_messages` (49 rows)

`message` length 1–8000 after trim. `sender_role` text (no check). `read_at` nullable. Triggers prepare message and touch conversation `updated_at`.

No separate notifications inbox.

---

### 5.7 Predictions / AI

#### `public.prediction_models` (1 row)

`id`, `name`, `version`, `disclaimer`.

#### `public.prediction_signals` (0 rows)

Per-user signals; default `model_version` `'crasher-stat-v1'`, `simulated_source` true, `window_ms` 15000.

#### `public.prediction_results` (0 rows)

FK signal CASCADE.

#### `public.ai_predictions` (5967 rows)

Tied optionally to `binary_contracts` ON DELETE SET NULL. Fields: `prediction_type`, `predicted_outcome`, `confidence`, `input_window` default 120, `model_version`, `analysis`, `features` jsonb, `disclaimer`, `actual_outcome`, `was_correct`.

---

## 6. Foreign keys

| Source | Columns | Target | On delete |
|---|---|---|---|
| `users` | `id` | `auth.users(id)` | CASCADE |
| `wallets` | `user_id` | `auth.users(id)` | CASCADE |
| `wallet_ledger` | `wallet_id` | `wallets(id)` | CASCADE |
| `wallet_ledger` | `user_id` | `auth.users(id)` | CASCADE |
| `wallet_ledger` | `contract_id` | `binary_contracts(id)` | SET NULL |
| `wallet_transactions` | `wallet_id` | `wallets(id)` | CASCADE |
| `wallet_transactions` | `user_id` | `auth.users(id)` | CASCADE |
| `binary_contracts` | `user_id` | `auth.users(id)` | CASCADE |
| `binary_settlements` | `contract_id` | `binary_contracts(id)` | **RESTRICT** |
| `binary_settlements` | `user_id` | `auth.users(id)` | CASCADE |
| `ai_predictions` | `user_id` | `auth.users(id)` | CASCADE |
| `ai_predictions` | `contract_id` | `binary_contracts(id)` | SET NULL |
| `payment_transactions` | `user_id` | `auth.users(id)` | CASCADE |
| `deposit_requests` | `user_id` | `auth.users(id)` | CASCADE |
| `deposit_requests` | `payment_id` | `payment_transactions(id)` | SET NULL |
| `withdrawal_requests` | `user_id` | `auth.users(id)` | CASCADE |
| `withdrawal_requests` | `payment_id` | `payment_transactions(id)` | SET NULL |
| `platform_fee_payments` | `user_id` | `auth.users(id)` | CASCADE |
| `platform_fee_payments` | `payment_id` | `payment_transactions(id)` | SET NULL |
| `upesi_deposit_secrets` | `payment_id` | `payment_transactions(id)` | CASCADE |
| `upesi_deposit_secrets` | `user_id` | `auth.users(id)` | CASCADE |
| `kyc_reviews` | `user_id` | `auth.users(id)` | CASCADE |
| `kyc_reviews` | `reviewer_id` | `auth.users(id)` | (default NO ACTION) |
| `audit_log` | `actor_id` | `auth.users(id)` | (default NO ACTION) |
| `feature_flags` | `updated_by` | `auth.users(id)` | (default NO ACTION) |
| `orders`, `positions`, `contracts`, `trades`, `transactions`, `trade_events`, `provider_accounts`, `provider_errors`, `prediction_signals`, `support_conversations` | `user_id` (or equivalent) | `auth.users(id)` | CASCADE (trade_events user CASCADE; contract SET NULL) |
| `prediction_results` | `signal_id` | `prediction_signals(id)` | CASCADE |
| `support_messages` | `conversation_id` | `support_conversations(id)` | CASCADE |
| `support_messages` | `sender_user_id` | `auth.users(id)` | (default NO ACTION) |
| `risk_events` | `user_id` | `auth.users(id)` | SET NULL |

---

## 7. Indexes (public, excluding storage catalog)

Primary keys exist on every public table. Additional indexes:

| Table | Index | Definition (summary) |
|---|---|---|
| `users` | `users_role_idx`, `users_kyc_idx` | btree role; btree kyc_status |
| `wallets` | `wallets_user_id_kind_key` UNIQUE | `(user_id, kind)` |
| `wallets` | `wallets_user_idx` | `(user_id)` |
| `wallet_ledger` | `wallet_ledger_user_idx` | `(user_id, created_at DESC)` |
| `wallet_transactions` | `wallet_tx_user_idx`, `wallet_tx_wallet_idx` | user/wallet + time |
| `binary_contracts` | `binary_contracts_user_id_idempotency_key_key` UNIQUE | `(user_id, idempotency_key)` |
| `binary_contracts` | `binary_contracts_user_status_idx` | `(user_id, status, created_at DESC)` |
| `binary_settlements` | `binary_settlements_contract_id_key` UNIQUE | `(contract_id)` |
| `payment_transactions` | `payment_transactions_provider_request_id_key` UNIQUE | `(provider_request_id)` |
| `payment_transactions` | `payment_transactions_reference_idx` UNIQUE partial | `reference` WHERE NOT NULL |
| `payment_transactions` | `payment_tx_user_idx`, `payment_tx_status_idx`, `payment_tx_merchant_idx` | user/status/merchant |
| `platform_fee_payments` | `platform_fee_paid_unique` UNIQUE partial | `(user_id, fee_kind)` WHERE completed |
| `trades` | `trades_user_idempotency_idx` UNIQUE partial | `(user_id, idempotency_key)` WHERE NOT NULL |
| `trades` | `trades_user_idx`, `trades_status_idx`, `trades_product_idx` | |
| `market_ticks` | `market_ticks_symbol_idx`, `market_ticks_symbol_time_idx` | |
| `provider_accounts` | unique `(user_id, provider)` | |
| `ai_predictions` | `ai_predictions_user_idx` | `(user_id, created_at DESC)` |
| `audit_log` | actor + created_at; created_at | |
| `support_*`, `kyc_reviews`, `deposit_requests`, `withdrawal_requests`, `orders`, `positions`, `contracts`, `trade_events`, `prediction_signals` | user/time or conversation indexes | |

---

## 8. RLS policies

Roles on all listed policies: `{authenticated}`. Permissive. No `anon` table policies were found.

| Table | Policy | Command | USING / WITH CHECK |
|---|---|---|---|
| `users` | `users_self` | ALL | `id = auth.uid()` |
| `users` | `admin_users_staff` | SELECT | `id = auth.uid() OR is_platform_staff()` |
| `wallets` | `wallets_self_select` | SELECT | `user_id = auth.uid()` |
| `wallet_ledger` | `wallet_ledger_own` | SELECT | `user_id = auth.uid()` |
| `wallet_transactions` | `wallet_tx_self_select` | SELECT | `user_id = auth.uid()` |
| `binary_contracts` | `binary_contracts_own` | SELECT | `user_id = auth.uid()` |
| `binary_settlements` | `binary_settlements_own` | SELECT | `user_id = auth.uid()` |
| `ai_predictions` | `ai_predictions_own` | SELECT | `user_id = auth.uid()` |
| `payment_transactions` | `payment_tx_self_select` | SELECT | `user_id = auth.uid()` |
| `deposit_requests` | `deposit_req_self_select` | SELECT | `user_id = auth.uid()` |
| `withdrawal_requests` | `withdrawal_req_self_select` | SELECT | `user_id = auth.uid()` |
| `withdrawal_requests` | `withdrawal_req_self_insert` | INSERT | `user_id = auth.uid() AND status = 'requested'` |
| `platform_fee_payments` | `platform_fee_self_select` | SELECT | `user_id = auth.uid()` |
| `kyc_reviews` | `kyc_reviews_self_select` | SELECT | `user_id = auth.uid()` |
| `audit_log` | `audit_log_staff_select` | SELECT | `is_platform_staff()` |
| `feature_flags` | `feature_flags_read` | SELECT | `true` |
| `market_symbols`, `market_ticks`, `markets`, `prediction_models`, `provider_connections`, `risk_settings` | `*_read` | SELECT | `true` |
| `orders`, `positions`, `contracts`, `trades`, `transactions`, `provider_accounts` | `*_self` | ALL | `user_id = auth.uid()` |
| `trade_events` | `trade_events_self` | SELECT | `user_id = auth.uid()` |
| `trade_events` | `trade_events_insert_self` | INSERT | `user_id = auth.uid()` |
| `provider_errors` | `provider_errors_self` | SELECT | `user_id = auth.uid()` |
| `prediction_signals` | `prediction_signals_own` | ALL | `user_id = auth.uid()` |
| `prediction_results` | `prediction_results_own` | SELECT | signal owned by `auth.uid()` |
| `risk_events` | `risk_events_none` | SELECT | `false` |
| `support_conversations` | select/update | SELECT/UPDATE | owner or staff |
| `support_conversations` | insert | INSERT | owner **and not staff** |
| `support_messages` | select/update/insert | | conversation owner or staff; insert requires `sender_user_id = auth.uid()` |

**Tables with RLS enabled and zero policies (deny-all for `anon`/`authenticated` via Data API):** `upesi_deposit_secrets`, `upesi_gateway_secrets`. Confirmed by security advisor `rls_enabled_no_policy`.

**Implication for rebuild:** wallet/ledger/binary/payment **writes go through SECURITY DEFINER RPCs**, not direct table INSERT (SELECT-only policies on those financial tables).

Storage object policies (bucket `kyc-documents`): insert/select/update own objects where `split_part(name, '/', 1) = auth.uid()::text`. No delete policy observed.

---

## 9. Database functions (`public`)

Source bodies were **not** dumped except auth-linkage helpers (emails redacted). Payment pepper/token functions exist; their source was **not** fetched.

Legend: SD = SECURITY DEFINER. Execute: A = anon, U = authenticated.

### Auth / role

| Name | Args | Returns | Lang | Volatile | SD | Execute |
|---|---|---|---|---|---|---|
| `handle_new_user` | | trigger | plpgsql | volatile | yes | neither (trigger only) |
| `auth_users_autoconfirm` | | trigger | plpgsql | volatile | yes | A+U |
| `auth_identities_autoconfirm` | | trigger | plpgsql | volatile | yes | A+U |
| `current_app_role` | | text | plpgsql | stable | yes | U |
| `is_platform_staff` | | boolean | sql | stable | yes | U |
| `require_staff` | | void | plpgsql | stable | yes | U |

### Binary / wallet (user RPCs)

| Name | Args | Returns | Notes |
|---|---|---|---|
| `open_binary_contract` | id, idempotency, mode, symbol, type, stake, duration_ms, entry price/ts/expiry, barrier, target_digit, payout_rate, precision, prediction_id, entry_sequence, stop_loss, take_profit | jsonb | SD, U |
| `settle_binary_contract` | contract_id, settlement price/ts/sequence, digit, outcome, payout, profit, close_reason | jsonb | SD, U |
| `place_demo_trade` | idempotency, product_type, symbol, instrument_id, direction, contract_type, stake, duration_ms, entry, payout_rate, barrier | jsonb | SD, U |
| `settle_demo_trade` | trade_id | jsonb | SD, U |
| `platform_binary_wallet` | kind text | jsonb | SD, U, **volatile** |
| `platform_binary_ledger` | kind text | jsonb | SD, U |
| `platform_ensure_demo_wallet` | starting_balance | jsonb | SD, U |
| `platform_my_binary_history` / `platform_my_binary_open` / `platform_my_ledger` / `platform_my_open_demo_trades` / `platform_my_trades` / `platform_my_profile` | | jsonb | SD, U |
| `calculate_binary_outcome` | type, barrier, target_digit, price, stake, payout_rate, precision, entry_price | jsonb | invoker, immutable, A+U |
| `binary_settlement_digit` | price, precision | integer | invoker, immutable, A+U |
| `binary_forced_win` | seed, win_rate | boolean | invoker, immutable, **no A/U execute** |
| `binary_win_unit` | seed | numeric | invoker, immutable, **no A/U execute** |
| `demo_exit_price` / `demo_last_digit` | | numeric / integer | U |
| `forbid_binary_history_mutation` | | trigger | invoker |

### Payments / Upesi (do not log args that are secrets)

Gateway RPCs take `p_pepper` / `p_apply_token` arguments. Treat those as secrets at call time.

| Name | Execute | SD |
|---|---|---|
| `platform_create_upesi_deposit` | A+U | yes |
| `platform_apply_upesi_deposit` | A+U | yes |
| `platform_expire_upesi_deposit` | A+U | yes |
| `platform_gateway_apply_upesi_deposit` | A+U | yes |
| `platform_attach_upesi_reference` | A+U | yes |
| `platform_create_upesi_fee` | U | yes |
| `platform_apply_upesi_fee` | A+U | yes |
| `platform_expire_upesi_fee` | A+U | yes |
| `platform_set_upesi_pepper` | A+U | yes |
| `platform_my_upesi_deposit` | A+U | yes |
| `platform_my_upesi_fee` | U | yes |
| `platform_my_payment_request` | A+U | yes |
| `platform_request_manual_deposit` | A+U | yes |
| `platform_request_withdrawal` | A+U | yes |
| `request_live_withdrawal` | U | yes |
| `complete_live_withdrawal` / `fail_live_withdrawal` | U | yes |
| `platform_my_withdrawals` | U | yes (volatile) |
| `upesi_sha256` | A+U | no (immutable sql) |

Advisor warns many of these are **anon-callable SECURITY DEFINER**. That is an API-surface fact for rebuild, not a change made here.

### Compliance / fees

`platform_compliance_state`, `platform_compliance_can_withdraw`, `platform_fee_amount_kes`, `platform_user_fee_paid`, `platform_user_has_deposit`, `platform_user_has_completed_trade`, `platform_user_has_winning_trade`, `platform_user_has_completed_withdrawal`, `platform_withdraw_release_is_required`, `platform_withdraw_release_state`, `platform_require_withdraw_release_fee`. Several helpers have **no** anon/authenticated EXECUTE (internal).

### Admin (authenticated EXECUTE; functions themselves call `require_staff` or equivalent — source not fully dumped)

`admin_app_users`, `admin_dashboard_stats`, `admin_list_audit`, `admin_list_kyc`, `admin_list_payments`, `admin_list_trades`, `admin_list_users`, `admin_list_withdrawals`, `admin_ops_overview`, `admin_provider_links`, `admin_set_account_status`, `admin_set_kyc_status`.

### Other

`save_ai_prediction`, `platform_ai_history`, `record_risk_event`, `write_audit`, `platform_health` (A+U), `support_prepare_message`, `support_touch_conversation`.

---

## 10. Triggers

| Table | Trigger | Timing | Events | Function |
|---|---|---|---|---|
| `auth.users` | `on_auth_user_created` | AFTER INSERT | INSERT | `handle_new_user()` |
| `auth.users` | `auth_users_autoconfirm` | BEFORE INSERT | INSERT | `auth_users_autoconfirm()` |
| `auth.identities` | `auth_identities_autoconfirm` | BEFORE INSERT | INSERT | `auth_identities_autoconfirm()` |
| `public.binary_settlements` | `binary_settlements_immutable` | BEFORE | UPDATE, DELETE | `forbid_binary_history_mutation()` |
| `public.support_messages` | `support_messages_prepare` | BEFORE INSERT | INSERT | `support_prepare_message()` |
| `public.support_messages` | `support_messages_touch` | AFTER INSERT | INSERT | `support_touch_conversation()` |

No other public/auth user triggers were returned by `information_schema.triggers`.

---

## 11. Views

| Schema | Name | Definition | RLS / security |
|---|---|---|---|
| `public` | `audit_logs` | `SELECT` of all `audit_log` columns | `security_invoker=true` (does not bypass base-table RLS) |

No other public views.

---

## 12. Edge Functions

`list_edge_functions` returned **no functions**. `get_edge_function` was not needed. Payments and trading appear to run in **Postgres RPCs**, not Edge Functions.

---

## 13. Storage

One bucket:

| Name | Public | File size limit | MIME types | Objects |
|---|---|---|---|---|
| `kyc-documents` | **private** | 10485760 (10 MiB) | jpeg, png, webp, pdf | 0 objects at audit time |

Object RLS: own-prefix path = `auth.uid()`. No delete policy listed.

---

## 14. Migrations (names only)

Applied versions (newest last):

`provider_trading`, `admin_directory`, `kyc_storage`, `platform_expansion_schema`, `platform_expansion_functions_core`, `platform_expansion_demo_ledger`, `platform_expansion_admin_rpcs`, `platform_expansion_grants_trigger`, `binary_contract_types`, `predictions_and_risk_tables`, `revoke_anon_admin_rpcs`, `own_binary_engine`, `own_binary_engine_core_tables`, `own_binary_engine_rls`, `own_binary_engine_functions`, `own_binary_wallet_rpcs`, `platform_binary_wallet_rpc`, `open_binary_contract_rpc`, `settle_binary_contract_rpc`, `binary_engine_list_ai_rpcs`, `ensure_demo_wallet_dual_balance`, `upesi_deposits`, `buy_sell_binary_schema`, `buy_sell_calculate_outcome`, `buy_sell_settle_contract`, `support_chat`, `support_chat_triggers`, `payment_destination_columns`, `payment_request_withdrawal_rpc`, `payment_request_manual_deposit_rpc`, `payment_my_request_lookup_rpc`, `upesi_gateway_apply_by_reference`, `upesi_apply_locks_payment_row`, `buy_sell_equal_is_loss`, `buy_sell_tie_refund`, `wallet_rpc_defaults_and_live_withdrawals`, `fix_binary_wallet_kind_shadowing`, `admin_ops_overview`, `delete_cleverserugo_account`, `delete_cleverserugo_reregistered_v2`, `fix_upesi_pepper_and_msisdn`, `upesi_01_numbers_and_late_credit`, `upesi_late_success_credit`, `upesi_admin_withdrawals`, `wallet_win_rate_90`, `wallet_win_rate_settle`, `wallet_win_rate_demo_settle`, `expire_stuck_upesi_deposits`, `timeout_unpaid_processing_deposits`, `platform_compliance_fees`, `platform_compliance_fees_tables`, `platform_compliance_fee_helpers`, `platform_compliance_state_rpc`, `platform_create_and_read_fees`, `platform_apply_expire_fees`, `platform_guard_deposits_and_withdrawals`, `guard_upesi_deposit_direction`, `auth_disable_email_confirmation`, `delete_cleverserugo_gmail_account`, `binary_stop_loss_take_profit`, `withdraw_release_fee`, `compliance_and_gate_disclosure`.

SQL bodies of migrations were not pulled (would duplicate function source, including payment hashing). Names are sufficient to see evolution: provider trading → own binary engine → Upesi deposits → support chat → compliance fees → SL/TP.

---

## 15. Security advisor snapshot (read-only)

Fetched `get_advisors` type `security`. Not remediated (audit-only).

- RLS enabled, no policy: `upesi_deposit_secrets`, `upesi_gateway_secrets` ([lint 0008](https://supabase.com/docs/guides/database/database-linter?lint=0008_rls_enabled_no_policy)).
- Mutable `search_path` on several invoker helpers (binary digit/outcome/win helpers, `platform_fee_amount_kes`) ([lint 0011](https://supabase.com/docs/guides/database/database-linter?lint=0011_function_search_path_mutable)).
- 17 SECURITY DEFINER functions executable by `anon` ([lint 0028](https://supabase.com/docs/guides/database/database-linter?lint=0028_anon_security_definer_function_executable)), including Upesi apply/create/expire and `platform_set_upesi_pepper`.
- 59 SECURITY DEFINER functions executable by `authenticated` ([lint 0029](https://supabase.com/docs/guides/database/database-linter?lint=0029_authenticated_security_definer_function_executable)) — expected for staff-gated RPCs if they call `require_staff` internally.
- Leaked password protection disabled.

Performance advisors were not fetched.

---

## 16. Domain summary for rebuilding the app

### Financial-critical

`wallets`, `wallet_ledger`, `wallet_transactions`, `binary_contracts`, `binary_settlements`, `payment_transactions`, `deposit_requests`, `withdrawal_requests`, `platform_fee_payments`, `upesi_deposit_secrets`, `upesi_gateway_secrets`, plus RPCs `open_binary_contract`, `settle_binary_contract`, `platform_binary_wallet`, Upesi/payment RPCs, live withdrawal complete/fail.

Direct client writes to ledger/wallet/binary tables are blocked by SELECT-only RLS. Use RPCs.

### Support

`support_conversations`, `support_messages` (+ triggers). Staff vs trader split in RLS. **No notifications table.**

### Admin / roles / permissions

`public.users.role` enum + `current_app_role()` from JWT `app_metadata` (and one redacted hardcoded email). Admin RPCs listed above. `audit_log` / view `audit_logs`. `feature_flags`. `admin_set_account_status`, `admin_set_kyc_status`.

### KYC

`users.kyc_status`, `kyc_reviews`, private bucket `kyc-documents`, `admin_list_kyc` / `admin_set_kyc_status`. Document objects currently **zero**.

### Predictions / AI

`prediction_models`, `prediction_signals`, `prediction_results` (empty usage), `ai_predictions` (heavy usage), `save_ai_prediction`, `platform_ai_history`. Linked to binary contracts when a trade is placed from a prediction.

### Provider / legacy trading

Empty `orders` / `positions` / `contracts` / `provider_accounts`. `trades` has 8 rows. `market_ticks` is populated. Feature flags mention live binary/forex/trading and M-Pesa/Upesi.

---

## 17. What was not read / not present

- **Not present:** `notifications` table; dedicated `profiles` / `permissions` tables; Edge Functions; `pg_cron` jobs; Poa Match public schema.
- **Not dumped:** function source for payment/pepper/hashing; `apply_token_hash` / `pepper_hash` / `token_ciphertext` **values**; publishable/anon/service_role keys; Auth dashboard SMTP secrets; user PII; hardcoded superadmin email (redacted).
- **GoTrue full config JSON** (SMTP, redirect URLs, JWT expiry seconds) is not in SQL catalogs; only table/trigger/advisor evidence above.
- **Numeric precision/scale:** information_schema reports unconstrained `numeric` (typical for this project).

---

## 18. Audit constraints honored

- No new Supabase project.
- No `apply_migration`, `deploy_edge_function`, `create_project`, pause/restore, branch write ops, or mutating SQL.
- SELECT / catalog / list_* / get_project / get_advisors only.
- This workspace was not wired to Supabase in code; this document is the connection map only.
