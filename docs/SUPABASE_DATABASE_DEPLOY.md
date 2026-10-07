# Supabase database deploy — host + payout desk

SmartBaseBinary uses **two** Supabase projects:

| Project | SQL in repo | Purpose |
| --- | --- | --- |
| **Host** (trading, wallets, deposits, legacy withdrawals) | `supabase/migrations/` | Main app database |
| **Payout desk** (fee-gated M-Pesa desk) | `supabase/payout-desk/migrations/` | Separate DB — must not share host schema |

Incremental host migrations were merged into one file. Use this guide to avoid double-applying SQL on production.

---

## Host project

### Fresh database (new project or empty public schema)

1. Apply any **base** migrations that live only on the remote (if your project still relies on them), e.g. the `20260919*` core chain documented in `docs/SUPABASE_SCHEMA_MIGRATION.md`.
2. Run **once** in the SQL editor (or `supabase db push` if you treat this file as the only delta after core):

   `supabase/migrations/20260920111952_smartbasebinary_host_schema.sql`

3. Deploy Edge Functions and set secrets (deposits, withdrawals, `real-trade`, `admin-fees`, etc.).

**What’s inside:** twelve former files concatenated in order. Each block is labeled:

```sql
-- from: 20261004090000_daraja_deposits.sql
```

**Object checklist:** `supabase/migrations/MIGRATION_MANIFEST.md` lists tables, functions, policies, and cron jobs per original file.

### Existing database (Smart Base Binary / production already migrated)

**Do not** run `20260920111952_smartbasebinary_host_schema.sql` on a database that already applied the old incremental files (`20260920111952_align_markets_catalog_with_app.sql` through `20261005190000_place_real_trade_stake_bounds.sql`).

Those objects already exist; re-running the consolidated script will fail on `CREATE TABLE`, duplicate policies, or conflicting cron jobs.

For schema changes after consolidation:

- Add a **new** dated migration file under `supabase/migrations/` (single change set), or
- Apply the equivalent SQL manually in the dashboard and record the version in your runbook.

To see what’s applied on remote: Supabase Dashboard → **Database** → **Migrations**, or `supabase migration list` against the linked project.

---

## Payout desk project

### Fresh database

Run **once**:

`supabase/payout-desk/migrations/20261004140000_payout_desk.sql`

This file includes the desk schema and admin payout settings RPCs (formerly a second migration).

Mirror copy for the standalone app: `apps/payout-desk/supabase/migrations/20261004140000_payout_desk.sql` (keep in sync with `supabase/payout-desk/migrations/`).

### Existing payout desk

If you already ran `20261004140000_payout_desk.sql` and `20261005180000_admin_payout_settings.sql` separately, **do not** re-run the merged file. You already have those objects; only apply **new** forward migrations from here on.

---

## Host ↔ payout wiring (after SQL)

On the **host** Edge Function secrets (see `supabase/payout-desk/README.md`):

- `PAYOUT_SUPABASE_URL`
- `PAYOUT_SUPABASE_SERVICE_ROLE_KEY`

On **web** (Vite): `VITE_PAYOUT_SUPABASE_URL`, `VITE_PAYOUT_SUPABASE_ANON_KEY`.

Admin-editable fees: host `payment_settings` + `trading_settings`; payout `payout_settings` via `admin-fees` on the host project.

---

## Quick reference

| Scenario | Host SQL | Payout desk SQL |
| --- | --- | --- |
| Brand-new Supabase projects | Consolidated host schema (after core, if needed) | `20261004140000_payout_desk.sql` |
| Production already on incremental migrations | **Skip** consolidated file; use new deltas only | **Skip** merged file if both old files were applied |
| Find a feature in SQL | Search `-- from: <old_filename>` or `MIGRATION_MANIFEST.md` | Header comments in payout desk SQL |
