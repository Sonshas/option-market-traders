<#
.SYNOPSIS
  Deploys all Supabase Edge Functions for the host project (Smart Base Binary).

.DESCRIPTION
  Uses the Supabase CLI with --use-api. Requires `npx supabase login` once on this PC
  (or SUPABASE_ACCESS_TOKEN in the environment).

  Redeploy after changes under supabase/functions/, especially _shared/ and _shared/payments/.

.EXAMPLE
  .\deploy\vultr\deploy-supabase-functions.ps1
.EXAMPLE
  .\deploy\vultr\deploy-supabase-functions.ps1 -ProjectRef wkfyavcjjuyzvyeprklz -Only admin-fees,real-trade
#>
[CmdletBinding()]
param(
  [string]$ProjectRef = 'wkfyavcjjuyzvyeprklz',

  [string[]]$Only = @()
)

$ErrorActionPreference = 'Stop'
$RepoRoot = (Resolve-Path (Join-Path $PSScriptRoot '..\..')).Path
$FunctionsDir = Join-Path $RepoRoot 'supabase\functions'

if (-not (Get-Command npx -ErrorAction SilentlyContinue)) {
  throw 'npx not found. Install Node.js 22+ from https://nodejs.org and run npm install in the repo root.'
}

$all = @(
  'admin-dashboard',
  'admin-fees',
  'admin-withdrawals',
  'megapay-deposit',
  'megapay-status',
  'megapay-webhook',
  'mpesa-b2c-result',
  'mpesa-callback',
  'mpesa-deposit',
  'mpesa-status',
  'mpesa-withdraw',
  'mpesa-withdraw-dispatch',
  'real-trade',
  'real-trade-settle',
  'system-issues'
)

$toDeploy = if ($Only.Count -gt 0) { $Only } else { $all }
$noJwt = @('mpesa-callback', 'mpesa-status', 'megapay-webhook', 'mpesa-b2c-result', 'real-trade-settle')

foreach ($name in $toDeploy) {
  $path = Join-Path $FunctionsDir $name
  if (-not (Test-Path (Join-Path $path 'index.ts'))) {
    throw "Function folder missing: $path"
  }
}

Push-Location $RepoRoot
try {
  foreach ($name in $toDeploy) {
    $extra = if ($noJwt -contains $name) { ' --no-verify-jwt' } else { '' }
    Write-Host "==> Deploying $name$extra" -ForegroundColor Cyan
    # cmd /c required on Windows — PowerShell splat of npx drops supabase args.
    $out = cmd /c "npx supabase functions deploy $name --project-ref $ProjectRef --use-api$extra 2>&1"
    $text = ($out | Out-String)
    if ($LASTEXITCODE -ne 0 -or $text -notmatch 'Deployed Functions') {
      Write-Host $text
      throw "Deploy failed for $name (exit $LASTEXITCODE)."
    }
    Write-Host "    OK $name" -ForegroundColor Green
  }
  Write-Host '==> All requested Edge Functions deployed.' -ForegroundColor Green
} finally {
  Pop-Location
}
