# Hosting optionmarkettraders.com on a Vultr VPS

The web app (`apps/web`) is a static Vite/React SPA. It is built on your PC, uploaded to a
Vultr Ubuntu server, and served by [Caddy](https://caddyserver.com), which also obtains and
renews HTTPS certificates automatically. Supabase and Deriv are called directly from the
browser, so no backend is required on the server. The Express API (`apps/api`) is **not**
deployed yet (see the optional section at the end).

Files used:

| File | Where it runs |
| --- | --- |
| `deploy/vultr/setup-server.sh` | Once, on the fresh server, as root |
| `deploy/vultr/Caddyfile` | Installed to `/etc/caddy/Caddyfile` by the setup script |
| `deploy/vultr/deploy.ps1` | On your Windows PC, every time you publish |

Server layout: each deploy uploads to `/var/www/optionmarkettraders/releases/<timestamp>/`
and the symlink `/var/www/optionmarkettraders/current` is switched atomically to it. Caddy
serves `current`. The last 5 releases are kept.

---

## a) Create the Vultr instance

1. **Generate an SSH key on Windows** (skip if you already have `~\.ssh\id_ed25519.pub`).
   In PowerShell:

   ```powershell
   ssh-keygen -t ed25519 -C "optionmarkettraders"
   Get-Content $HOME\.ssh\id_ed25519.pub
   ```

   Press Enter to accept the default path; a passphrase is recommended. Copy the single
   line printed by `Get-Content` (starts with `ssh-ed25519`).
2. In the [Vultr dashboard](https://my.vultr.com) → **Deploy +** → **Deploy New Server**:
   - Type: **Cloud Compute – Shared CPU** (Regular Performance is fine).
   - Location: the region closest to most of your users.
   - Image: **Ubuntu 24.04 LTS x64** (22.04 LTS also works).
   - Plan: the smallest plan (~$5–6/month, 1 vCPU / 1 GB) is plenty for a static site.
   - **SSH Keys** → **Add New** → paste the public key from step 1 and select it.
   - Optional: enable IPv6. Leave "Auto Backups" to your preference.
   - Hostname/label: e.g. `optionmarkettraders`.
3. Deploy, wait until the status is **Running**, then note the server's **public IPv4**
   (and **IPv6** if enabled) from the server's Overview page. Below these are called
   `<VULTR_IPV4>` and `<VULTR_IPV6>`.
4. If you attach a **Vultr Firewall Group** to the server, it must allow inbound
   **TCP 22, 80 and 443**. (Without a firewall group, only the server's own `ufw` applies,
   which the setup script configures.)

## b) Prepare the server (one time)

From the workspace folder on your PC, in PowerShell:

```powershell
cd C:\Users\User\OneDrive\Desktop\smartbasebinary.online
scp deploy\vultr\setup-server.sh deploy\vultr\Caddyfile root@<VULTR_IPV4>:/root/
ssh root@<VULTR_IPV4>
```

Answer `yes` to the host-key prompt the first time. Then, on the server:

```bash
cd /root
bash setup-server.sh
```

The script (safe to re-run) updates Ubuntu, creates a `deploy` user that reuses the SSH key
you added in Vultr, installs Caddy from its official apt repository, enables `ufw` with
OpenSSH/80/443, creates `/var/www/optionmarkettraders` with a "Coming soon" placeholder,
installs the Caddyfile, and starts Caddy. The `deploy` user can only run
`systemctl reload caddy` via sudo.

> If you edited the scripts on Windows and see `$'\r': command not found`, convert line
> endings first: `sed -i 's/\r$//' setup-server.sh Caddyfile`.

Check that the `deploy` user works (from your PC): `ssh deploy@<VULTR_IPV4> "echo ok"`.

To change the Caddyfile later: edit `deploy/vultr/Caddyfile`, `scp` it to the server as
root again and rerun `bash setup-server.sh` (or copy it to `/etc/caddy/Caddyfile` and run
`systemctl reload caddy`).

## c) Point the domain at the server (Namecheap)

1. Namecheap → **Domain List** → **Manage** next to `optionmarkettraders.com` →
   **Advanced DNS**.
2. Make sure **Nameservers** (Domain tab) is set to **Namecheap BasicDNS**.
3. Under **Host Records**, delete the default parking records:
   - `CNAME Record` · Host `www` · Value `parkingpage.namecheap.com`
   - `URL Redirect Record` · Host `@`
4. Add:

   | Type | Host | Value | TTL |
   | --- | --- | --- | --- |
   | A Record | `@` | `<VULTR_IPV4>` | Automatic |
   | A Record | `www` | `<VULTR_IPV4>` | Automatic |
   | AAAA Record (only if IPv6 enabled) | `@` | `<VULTR_IPV6>` | Automatic |
   | AAAA Record (only if IPv6 enabled) | `www` | `<VULTR_IPV6>` | Automatic |

   Only add AAAA records if IPv6 is enabled **and** working on the server; a wrong AAAA
   record breaks HTTPS issuance for IPv6 clients.
5. Save. Changes usually propagate in 5–30 minutes, occasionally up to 24–48 hours.
6. Verify from PowerShell (both must return `<VULTR_IPV4>`):

   ```powershell
   nslookup optionmarkettraders.com
   nslookup www.optionmarkettraders.com
   nslookup optionmarkettraders.com 1.1.1.1
   ```

## d) Deploy the site

From the workspace folder on your PC:

```powershell
cd C:\Users\User\OneDrive\Desktop\smartbasebinary.online
.\deploy\vultr\deploy.ps1 -ServerIp <VULTR_IPV4>
```

If PowerShell blocks the script, run it once with
`powershell -ExecutionPolicy Bypass -File .\deploy\vultr\deploy.ps1 -ServerIp <VULTR_IPV4>`.
Optional parameters: `-User deploy` (default), `-SshKey $HOME\.ssh\id_ed25519`,
`-KeepReleases 5`, `-ReloadCaddy`, `-SkipBuild`.

The script:

1. Runs `npm run build` in `apps/web` (typecheck + `vite build` in production mode).
   It requires `apps/web/.env.production` to contain `VITE_E2E_AUTH_BYPASS=false`, clears any
   `VITE_E2E_AUTH_BYPASS` environment variable, and aborts if the built bundle contains the
   bypass.
2. Uploads `apps/web/dist` with `scp` to a new release folder and switches `current` to it.

Build-time configuration comes from `apps/web/.env` (+ `.env.production`). The production
bundle needs these public values (see `apps/web/.env.example`):

- `VITE_SUPABASE_URL`
- `VITE_SUPABASE_PUBLISHABLE_KEY` (or `VITE_SUPABASE_ANON_KEY`)
- `VITE_MARKET_DATA_PROVIDER` (`deriv`)
- `VITE_DERIV_APP_ID`
- `VITE_MARKET_DATA_WS_URL`

Never put the Supabase service-role key or any trading token in `VITE_*` variables — they are
embedded in the public JavaScript. `VITE_E2E_AUTH_BYPASS` is for local Playwright only; the
code ignores it in production builds and `.env.production` forces it to `false`.

**HTTPS:** once DNS resolves to the server and ports 80/443 are reachable, Caddy obtains
Let's Encrypt certificates for both hostnames on the first request (usually within a
minute). `http://` and `https://www.` redirect to `https://optionmarkettraders.com`. If
certificates do not appear, check on the server: `journalctl -u caddy --no-pager -n 100`.

Quick checks after deploy:

- `https://optionmarkettraders.com` loads; a deep link such as
  `https://optionmarkettraders.com/app/markets` loads directly (SPA fallback).
- `https://www.optionmarkettraders.com` redirects to the apex domain.

## e) Supabase Auth URLs

Supabase Dashboard → project **wkfyavcjjuyzvyeprklz** → **Authentication** →
**URL Configuration**:

- **Site URL:** `https://optionmarkettraders.com`
- **Redirect URLs** (add all):
  - `https://optionmarkettraders.com/**`
  - `https://www.optionmarkettraders.com/**`
  - `http://localhost:5173/**` (keep for local development)

Without this, email confirmation / password-reset links will point to the old Site URL.

## f) Deriv app_id (recommended)

The app currently uses Deriv's public test `app_id` **1089**, which is shared and rate-limited
(ticks streaming may return `InvalidSymbol`; the client falls back to polling history).
Register your own application at [api.deriv.com](https://api.deriv.com) (Dashboard →
Register application) with `https://optionmarkettraders.com` as the website/redirect URL,
then set in `apps/web/.env`:

```env
VITE_DERIV_APP_ID=<your_app_id>
VITE_MARKET_DATA_WS_URL=wss://ws.derivws.com/websockets/v3?app_id=<your_app_id>
```

and redeploy.

## g) Updating the site later

Make your changes, then rerun:

```powershell
.\deploy\vultr\deploy.ps1 -ServerIp <VULTR_IPV4>
```

**Rollback:** SSH in as `deploy`, list `/var/www/optionmarkettraders/releases`, and repoint:

```bash
cd /var/www/optionmarkettraders
ln -sfn /var/www/optionmarkettraders/releases/<older-timestamp> current.tmp && mv -Tf current.tmp current
```

Keep the server patched: `ssh root@<VULTR_IPV4> "apt-get update && apt-get upgrade -y"`
(Caddy updates through apt as well).

---

## Optional: deploying the Express API later

`apps/api` listens on `PORT` (default `3001`) and exposes `/health` and `/market-data/*`.
To serve it from the same domain:

1. Run it on the server under a process manager (e.g. a systemd service) with
   `apps/api/.env` containing `PORT=3001` and
   `CORS_ORIGIN=https://optionmarkettraders.com,https://www.optionmarkettraders.com`
   (these origins are also in the API's built-in default list).
2. Uncomment the `handle_path /api/*` block in `deploy/vultr/Caddyfile` and reinstall it.
   The `/api` prefix is stripped, so `https://optionmarkettraders.com/api/health` → `/health`.
3. Build the web app with `VITE_MARKET_DATA_API_URL=https://optionmarkettraders.com/api`.
