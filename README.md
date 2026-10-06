# SmartBaseBinary

Monorepo for a new SmartBaseBinary application. The previous website is not part of this repository. The existing SmartBaseBinary Supabase project (database and user data) is preserved and is **not connected yet**.

## Apps

- `apps/web` — Vite + React + TypeScript frontend
- `apps/api` — Node + Express + TypeScript backend (server-side secrets and privileged operations later)

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
- API health check: `GET http://localhost:3001/health`

## Other scripts

```bash
npm run typecheck
npm run build
```

## Environment files

Real credentials belong in `.env` files that are gitignored. Use `.env.example` files as the template. Never put the Supabase service role key in the frontend.

Connecting the existing Supabase project is a later step. This scaffold only prepares client modules that read environment variables.
