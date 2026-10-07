# Remote access — Supabase + Vultr

| Target | How you connect | What you get |
| --- | --- | --- |
| **Supabase (host)** | CLI + Postgres (`psql`) or Dashboard SQL | Database, migrations, Edge deploy — **no SSH shell** |
| **Vultr VPS** | `ssh deploy@<IPv4>` | Linux shell, `/var/www/optionmarkettraders`, Caddy logs |

Project ref (host): **`wkfyavcjjuyzvyeprklz`**  
Site: **https://optionmarkettraders.com**

---

## Setup once

1. Copy `deploy/vultr/deploy.local.env.example` → `deploy/vultr/deploy.local.env` (gitignored).

2. Fill in:

```env
VULTR_SERVER_IP=<Vultr IPv4 from dashboard>
VULTR_SSH_USER=deploy
VULTR_SSH_KEY=C:\Users\You\.ssh\id_ed25519

SUPABASE_PROJECT_REF=wkfyavcjjuyzvyeprklz
SUPABASE_DB_PASSWORD=<Database password from Supabase Dashboard → Connect>
```

3. Optional SSH alias: merge `deploy/vultr/ssh-config.snippet` into `%USERPROFILE%\.ssh\config`.

4. From repo root (Node 22+ installed):

```powershell
npm install
```

---

## Supabase (database + CLI)

**Not SSH.** Hosted Supabase runs Postgres in the cloud; you use the dashboard or CLI.

### Interactive helper

```powershell
.\deploy\vultr\connect-supabase.ps1
```

This runs `supabase login` (browser) if needed, `supabase link`, `migration list`, and opens **psql** when `SUPABASE_DB_PASSWORD` is set.

### Manual equivalents

```powershell
cd C:\Users\User\Desktop\smartbasebinary\smartbasebinary.online
npx supabase login
npx supabase link --project-ref wkfyavcjjuyzvyeprklz
npx supabase migration list --linked
npx supabase db connect --linked
```

### SQL without CLI

[Supabase SQL editor](https://supabase.com/dashboard/project/wkfyavcjjuyzvyeprklz/sql/new)

Postgres host: `db.wkfyavcjjuyzvyeprklz.supabase.co` · port **5432** · user **postgres** · database **postgres**

---

## Vultr (web server)

```powershell
.\deploy\vultr\connect-vultr.ps1
# or
ssh deploy@<VULTR_IPV4>
```

Useful paths:

| Path | Purpose |
| --- | --- |
| `/var/www/optionmarkettraders/current` | Live static site (symlink) |
| `/var/www/optionmarkettraders/releases/` | Past deploy timestamps |
| `/etc/caddy/Caddyfile` | Reverse proxy to Supabase Edge (`/api/megapay`, `/api/mpesa`, …) |

Logs: `journalctl -u caddy -f` (as root or via `sudo`).

Root SSH (Caddy updates): `ssh root@<VULTR_IPV4>` or `ssh optionmarket-vultr-root` if using the snippet.

---

## Both in one menu

```powershell
.\deploy\vultr\connect-remote.ps1
```

Choose Supabase, Vultr, or both.

---

## Payout desk Supabase

Separate project — link with `npx supabase link --project-ref <PAYOUT_REF>` from a different folder or use that project’s dashboard only. See `supabase/payout-desk/README.md`.
