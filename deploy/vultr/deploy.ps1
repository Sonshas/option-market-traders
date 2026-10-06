<#
.SYNOPSIS
  Builds apps/web for production and publishes it to the Vultr VPS for optionmarkettraders.com.

.DESCRIPTION
  1. Builds apps/web in production mode (auth bypass forced off and verified absent from dist).
  2. Uploads dist with scp into /var/www/optionmarkettraders/releases/<timestamp>.
  3. Atomically repoints /var/www/optionmarkettraders/current to the new release (Caddy serves it).
  4. Keeps the newest -KeepReleases releases for quick rollback.

  Requires the server to be prepared once with deploy/vultr/setup-server.sh.
  Uses the OpenSSH client that ships with Windows 10/11 (ssh.exe, scp.exe).

.EXAMPLE
  .\deploy\vultr\deploy.ps1 -ServerIp 203.0.113.10
.EXAMPLE
  .\deploy\vultr\deploy.ps1 -ServerIp 203.0.113.10 -User deploy -SshKey $HOME\.ssh\id_ed25519 -ReloadCaddy
#>
[CmdletBinding()]
param(
  [Parameter(Mandatory = $true)]
  [string]$ServerIp,

  [string]$User = 'deploy',

  [string]$SshKey = '',

  [ValidateRange(1, 50)]
  [int]$KeepReleases = 5,

  [switch]$ReloadCaddy,

  [switch]$SkipBuild
)

$ErrorActionPreference = 'Stop'

$SiteRoot = '/var/www/optionmarkettraders'
$RepoRoot = (Resolve-Path (Join-Path $PSScriptRoot '..\..')).Path
$WebDir = Join-Path $RepoRoot 'apps\web'
$DistDir = Join-Path $WebDir 'dist'
$Release = Get-Date -Format 'yyyyMMdd-HHmmss'

function Assert-LastExit([string]$Step) {
  if ($LASTEXITCODE -ne 0) {
    throw "$Step failed (exit code $LASTEXITCODE)."
  }
}

foreach ($tool in 'npm', 'ssh', 'scp') {
  if (-not (Get-Command $tool -ErrorAction SilentlyContinue)) {
    throw "'$tool' was not found on PATH. Install Node.js 22+ and the Windows OpenSSH Client."
  }
}

$sshOpts = @('-o', 'StrictHostKeyChecking=accept-new', '-o', 'BatchMode=yes', '-o', 'ConnectTimeout=15')
if ($SshKey) {
  $sshOpts += @('-i', $SshKey)
}
$sshTarget = "$User@$ServerIp"
# scp needs IPv6 literals wrapped in brackets.
if ($ServerIp.Contains(':')) {
  $scpHost = "$User@[$ServerIp]"
} else {
  $scpHost = $sshTarget
}

if (-not $SkipBuild) {
  Write-Host '==> Building apps/web (production)' -ForegroundColor Cyan

  $envProduction = Join-Path $WebDir '.env.production'
  if (-not (Test-Path $envProduction) -or -not (Select-String -Path $envProduction -Pattern '^\s*VITE_E2E_AUTH_BYPASS\s*=\s*false\s*$' -Quiet)) {
    throw "apps/web/.env.production must contain VITE_E2E_AUTH_BYPASS=false."
  }
  # Process env vars override .env files in Vite, so make sure nothing re-enables the bypass.
  Remove-Item Env:VITE_E2E_AUTH_BYPASS -ErrorAction SilentlyContinue

  Push-Location $WebDir
  try {
    npm run build
    Assert-LastExit 'npm run build'
  } finally {
    Pop-Location
  }
}

if (-not (Test-Path (Join-Path $DistDir 'index.html'))) {
  throw "Build output not found at $DistDir."
}

Write-Host '==> Verifying the auth bypass is not in the bundle' -ForegroundColor Cyan
$distFiles = Get-ChildItem $DistDir -Recurse -File -Include *.js, *.html
if ($distFiles | Select-String -SimpleMatch -Pattern 'E2E auth bypass', 'VITE_E2E_AUTH_BYPASS:`true`' -List) {
  throw 'The production bundle still contains the E2E auth bypass. Aborting deploy.'
}

Write-Host "==> Uploading dist to $sshTarget`:$SiteRoot/releases/$Release" -ForegroundColor Cyan
# Target directory must not exist yet so scp -r copies the *contents* of dist into it.
scp @sshOpts -r $DistDir "${scpHost}:$SiteRoot/releases/$Release"
Assert-LastExit 'scp upload'

Write-Host '==> Activating release' -ForegroundColor Cyan
$pruneFrom = $KeepReleases + 1
$remote = @(
  'set -e',
  "cd $SiteRoot",
  "test -f releases/$Release/index.html",
  # Windows scp creates directories as owner-only (0500/0700), which Caddy cannot read.
  "chmod -R u+rwX,go+rX,go-w releases/$Release",
  "ln -sfn $SiteRoot/releases/$Release current.tmp",
  'mv -Tf current.tmp current',
  "ls -1 releases | grep -E '^[0-9]{8}-[0-9]{6}$' | sort -r | tail -n +$pruneFrom | while read -r old; do rm -rf -- releases/`$old; done",
  'echo Active release: $(readlink current)'
)
if ($ReloadCaddy) {
  $remote += 'sudo -n /usr/bin/systemctl reload caddy'
}
ssh @sshOpts $sshTarget ($remote -join '; ')
Assert-LastExit 'Remote activation'

Write-Host "==> Deployed release $Release. Open https://optionmarkettraders.com" -ForegroundColor Green
