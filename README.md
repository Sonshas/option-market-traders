# SmartBaseBinary

Monorepo for a new SmartBaseBinary application. The previous website is not part of this repository. The existing SmartBaseBinary Supabase project (database and user data) is preserved and is **not connected yet**.

## Apps

- `apps/web` — Vite + React + TypeScript frontend (includes embedded payout desk under `src/features/payout-desk`)
- `apps/api` — Node + Express + TypeScript backend (server-side secrets and privileged operations later)
- `apps/payout-desk` — Standalone fee-gated M-Pesa payout desk (also embedded in web). Uses a **separate** Supabase project — see `supabase/payout-desk/`.

## Prerequisites

- Node.js 22 or newer (required by the installed `@supabase/supabase-js`)
- npm 10 or newer (comes with Node)

## Setup

From the repository root:

```bash
npm install
```

Copy environment placeholders (do not commit real keys):

```bash
copy apps\web\.env.example apps\web\.env
copy apps\api\.env.example apps\api\.env
```

On macOS/Linux:

```bash
cp apps/web/.env.example apps/web/.env
cp apps/api/.env.example apps/api/.env
```

Fill in values from the existing Supabase project **when you are ready to connect**. Until then, the placeholder UI and the API health check run without talking to Supabase.

## Development

```bash
npm run dev
```

Runs the web app and the API together.

- Web only: `npm run dev:web` (Vite, typically http://localhost:5173)
- API only: `npm run dev:api` (Express, typically http://localhost:3001)
- Payout desk only: `npm run dev:payout` (Vite, typically http://localhost:5174)
- API health check: `GET http://localhost:3001/health`

## Other scripts

```bash
npm run typecheck
npm run build
```

## Environment files

Real credentials belong in `.env` files that are gitignored. Use `.env.example` files as the template. Never put the Supabase service role key in the frontend.

Connecting the existing Supabase project is a later step. This scaffold only prepares client modules that read environment variables.

## Database migrations (Supabase)

Schema SQL lives in two places: **host** (`supabase/migrations/`) and **payout desk** (`supabase/payout-desk/migrations/`, separate Supabase project).

| File | When to run |
| --- | --- |
| `supabase/migrations/20260920111952_smartbasebinary_host_schema.sql` | **Fresh host DB only** — merges 12 incremental migrations (MegaPay, real trading, Daraja, withdrawals, fees, 90% settlement, etc.) |
| `supabase/payout-desk/migrations/20261004140000_payout_desk.sql` | **Fresh payout desk DB only** |

**Already on production** with the old incremental host migrations (or the old two-file payout desk setup)? **Do not** re-run those consolidated scripts — apply only new forward migrations.

Full checklist, manifest, and wiring: **[docs/SUPABASE_DATABASE_DEPLOY.md](docs/SUPABASE_DATABASE_DEPLOY.md)** and **`supabase/migrations/MIGRATION_MANIFEST.md`**.

**Publish to live (Vultr + Supabase Edge):** **[docs/VULTR_LIVE_DEPLOY.md](docs/VULTR_LIVE_DEPLOY.md)** — or from PowerShell:

```powershell
.\deploy\vultr\publish-live.ps1 -ServerIp <VULTR_IPV4> -DeployEdgeFunctions
```
