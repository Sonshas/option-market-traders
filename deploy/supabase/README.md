# Host DB — production status

**Smart Base Binary** (`wkfyavcjjuyzvyeprklz`) production schema is current through migration version **`20261005210000`** (including payout fee STK, payment settings, stake bounds, natural EVEN/ODD/MATCH/DIFFER/OVER/UNDER settlement, and the `system_issues` log).

One-off delta SQL files that were used to patch live in Oct 2025 have been **removed** after apply. Do not re-run them on production.

## Source of truth (repo)

| Purpose | Path |
| --- | --- |
| Full host schema (fresh installs) | `supabase/migrations/20260920111952_smartbasebinary_host_schema.sql` |
| Section checklist | `supabase/migrations/MIGRATION_MANIFEST.md` |
| Deploy web + Edge | `deploy/vultr/publish-live.ps1` |

## New schema changes

Add a **new** dated file under `supabase/migrations/` (or run SQL in the dashboard and record the version), then deploy Edge Functions if needed.

Verify remote history:

```powershell
npx supabase link --project-ref wkfyavcjjuyzvyeprklz
npx supabase migration list --linked
```
