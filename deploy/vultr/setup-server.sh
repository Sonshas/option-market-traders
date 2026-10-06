#!/usr/bin/env bash
# One-time setup for a fresh Vultr Ubuntu 22.04/24.04 LTS VPS serving optionmarkettraders.com.
# Run as root from the directory containing this script and the Caddyfile:
#   bash setup-server.sh
# Safe to re-run: every step checks or overwrites idempotently.
set -euo pipefail

DEPLOY_USER="${DEPLOY_USER:-deploy}"
SITE_ROOT="/var/www/optionmarkettraders"
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

if [[ "${EUID}" -ne 0 ]]; then
  echo "Run this script as root (e.g. ssh root@SERVER_IP, then bash setup-server.sh)." >&2
  exit 1
fi

if [[ ! -f "${SCRIPT_DIR}/Caddyfile" ]]; then
  echo "Caddyfile not found next to setup-server.sh (${SCRIPT_DIR})." >&2
  exit 1
fi

echo "==> Updating packages"
export DEBIAN_FRONTEND=noninteractive
apt-get update -y
apt-get upgrade -y
apt-get install -y debian-keyring debian-archive-keyring apt-transport-https curl gnupg ufw

echo "==> Creating deploy user '${DEPLOY_USER}'"
if ! id "${DEPLOY_USER}" >/dev/null 2>&1; then
  adduser --disabled-password --gecos "" "${DEPLOY_USER}"
fi
install -d -m 700 -o "${DEPLOY_USER}" -g "${DEPLOY_USER}" "/home/${DEPLOY_USER}/.ssh"
if [[ -f /root/.ssh/authorized_keys ]]; then
  # Reuse the SSH key(s) added in the Vultr dashboard so the deploy user can log in too.
  touch "/home/${DEPLOY_USER}/.ssh/authorized_keys"
  while IFS= read -r key; do
    [[ -z "${key}" ]] && continue
    grep -qxF "${key}" "/home/${DEPLOY_USER}/.ssh/authorized_keys" || echo "${key}" >> "/home/${DEPLOY_USER}/.ssh/authorized_keys"
  done < /root/.ssh/authorized_keys
  chown "${DEPLOY_USER}:${DEPLOY_USER}" "/home/${DEPLOY_USER}/.ssh/authorized_keys"
  chmod 600 "/home/${DEPLOY_USER}/.ssh/authorized_keys"
else
  echo "WARNING: /root/.ssh/authorized_keys not found; add a key to /home/${DEPLOY_USER}/.ssh/authorized_keys manually."
fi

# The deploy user may only reload Caddy as root; nothing else.
cat > /etc/sudoers.d/90-${DEPLOY_USER}-caddy <<EOF
${DEPLOY_USER} ALL=(root) NOPASSWD: /usr/bin/systemctl reload caddy
EOF
chmod 440 /etc/sudoers.d/90-${DEPLOY_USER}-caddy
visudo -cf /etc/sudoers.d/90-${DEPLOY_USER}-caddy

echo "==> Installing Caddy from the official apt repository"
if [[ ! -f /usr/share/keyrings/caddy-stable-archive-keyring.gpg ]]; then
  curl -1sLf 'https://dl.cloudsmith.io/public/caddy/stable/gpg.key' \
    | gpg --dearmor -o /usr/share/keyrings/caddy-stable-archive-keyring.gpg
fi
curl -1sLf 'https://dl.cloudsmith.io/public/caddy/stable/debian.deb.txt' \
  > /etc/apt/sources.list.d/caddy-stable.list
chmod o+r /usr/share/keyrings/caddy-stable-archive-keyring.gpg /etc/apt/sources.list.d/caddy-stable.list
apt-get update -y
apt-get install -y caddy

echo "==> Configuring firewall (OpenSSH, 80, 443)"
ufw allow OpenSSH
ufw allow 80/tcp
ufw allow 443/tcp
ufw --force enable

echo "==> Preparing ${SITE_ROOT}"
install -d -m 755 -o "${DEPLOY_USER}" -g "${DEPLOY_USER}" "${SITE_ROOT}" "${SITE_ROOT}/releases"
if [[ ! -e "${SITE_ROOT}/current" ]]; then
  placeholder="${SITE_ROOT}/releases/placeholder"
  install -d -m 755 -o "${DEPLOY_USER}" -g "${DEPLOY_USER}" "${placeholder}"
  echo '<!doctype html><title>optionmarkettraders.com</title><p>Coming soon.</p>' > "${placeholder}/index.html"
  chown "${DEPLOY_USER}:${DEPLOY_USER}" "${placeholder}/index.html"
  ln -sfn "${placeholder}" "${SITE_ROOT}/current"
  chown -h "${DEPLOY_USER}:${DEPLOY_USER}" "${SITE_ROOT}/current"
fi

echo "==> Installing Caddyfile"
install -m 644 "${SCRIPT_DIR}/Caddyfile" /etc/caddy/Caddyfile
caddy validate --config /etc/caddy/Caddyfile --adapter caddyfile
systemctl enable caddy
if systemctl is-active --quiet caddy; then
  systemctl reload caddy
else
  systemctl start caddy
fi

echo
echo "Done. Next steps:"
echo "  1. Point DNS A records for optionmarkettraders.com and www to this server's IPv4."
echo "  2. From your PC run deploy/vultr/deploy.ps1 -ServerIp <this server's IP>."
echo "  3. Check certificates/logs with: journalctl -u caddy -f"
