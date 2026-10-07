<#
.SYNOPSIS
  Publishes SmartBaseBinary to production: Vultr static site + optional Caddy + Supabase Edge Functions.

.DESCRIPTION
  1. Web: build apps/web and upload to /var/www/optionmarkettraders (deploy.ps1).
  2. Optional: sync Caddyfile (MegaPay/Daraja/payout/B2C proxies).
  3. Optional: deploy all host Edge Functions to Supabase.

  Server IP: pass -ServerIp, or create deploy/vultr/deploy.local.env (see deploy.local.env.example).

  Database SQL is NOT run by this script — see docs/VULTR_LIVE_DEPLOY.md and docs/SUPABASE_DATABASE_DEPLOY.md.

.EXAMPLE
  .\deploy\vultr\publish-live.ps1 -ServerIp 203.0.113.10
.EXAMPLE
  .\deploy\vultr\publish-live.ps1 -ServerIp 203.0.113.10 -SyncCaddy -DeployEdgeFunctions
#>
[CmdletBinding()]
param(
  [string]$ServerIp = '',

  [string]$User = '',

  [string]$SshKey = '',

  [switch]$SyncCaddy,

  [switch]$DeployEdgeFunctions,

  [switch]$SkipWeb,

  [switch]$SkipBuild,

  [string]$ProjectRef = 'wkfyavcjjuyzvyeprklz'
)

$ErrorActionPreference = 'Stop'
$ScriptDir = $PSScriptRoot
$LocalEnv = Join-Path $ScriptDir 'deploy.local.env'

if (Test-Path $LocalEnv) {
  Get-Content $LocalEnv | ForEach-Object {
    if ($_ -match '^\s*#' -or $_ -match '^\s*$') { return }
    if ($_ -match '^\s*([^=]+)=(.*)$') {
      $k = $Matches[1].Trim()
      $v = $Matches[2].Trim().Trim('"').Trim("'")
      switch ($k) {
        'VULTR_SERVER_IP' { if (-not $ServerIp) { $ServerIp = $v } }
        'VULTR_SSH_USER' { if (-not $User) { $User = $v } }
        'VULTR_SSH_KEY' { if (-not $SshKey) { $SshKey = $v } }
        'SUPABASE_PROJECT_REF' { if ($ProjectRef -eq 'wkfyavcjjuyzvyeprklz') { $ProjectRef = $v } }
      }
    }
  }
}

if (-not $User) { $User = 'deploy' }

if (-not $SkipWeb) {
  if (-not $ServerIp) {
    throw @'
Server IP required. Either:
  - .\deploy\vultr\publish-live.ps1 -ServerIp <VULTR_IPV4>
  - Copy deploy/vultr/deploy.local.env.example to deploy.local.env and set VULTR_SERVER_IP

Use the Vultr instance IPv4 (Cloudflare orange-cloud DNS does not show it in nslookup).
'@
  }

  $deployArgs = @{
    ServerIp = $ServerIp
    User     = $User
  }
  if ($SshKey) { $deployArgs.SshKey = $SshKey }
  if ($SkipBuild) { $deployArgs.SkipBuild = $true }

  & (Join-Path $ScriptDir 'deploy.ps1') @deployArgs
  if ($LASTEXITCODE -ne 0) { throw 'Web deploy failed.' }
}

if ($SyncCaddy) {
  if (-not $ServerIp) { throw '-SyncCaddy requires -ServerIp (or deploy.local.env).' }
  $caddyArgs = @{ ServerIp = $ServerIp; User = $User }
  if ($SshKey) { $caddyArgs.SshKey = $SshKey }
  & (Join-Path $ScriptDir 'sync-caddy.ps1') @caddyArgs
  if ($LASTEXITCODE -ne 0) { throw 'Caddy sync failed.' }
}

if ($DeployEdgeFunctions) {
  & (Join-Path $ScriptDir 'deploy-supabase-functions.ps1') -ProjectRef $ProjectRef
  if ($LASTEXITCODE -ne 0) { throw 'Edge function deploy failed.' }
}

Write-Host ''
Write-Host '==> Live publish step finished.' -ForegroundColor Green
Write-Host '    Site: https://optionmarkettraders.com'
Write-Host '    Host DB is current through 20261005190000 — new SQL only via forward migrations (deploy/supabase/README.md).'
if (-not $DeployEdgeFunctions) {
  Write-Host '    Tip: re-run with -DeployEdgeFunctions after `npx supabase login`.'
}
