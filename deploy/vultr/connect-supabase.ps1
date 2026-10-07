<#
.SYNOPSIS
  Connect to the hosted Supabase Postgres (Smart Base Binary) — not SSH; uses Supabase CLI + psql.

.DESCRIPTION
  Supabase Cloud does not offer an SSH shell. This script:
  1. Ensures you are logged in (`npx supabase login` if needed).
  2. Links the repo to project wkfyavcjjuyzvyeprklz (if not already).
  3. Lists remote migrations.
  4. Opens an interactive psql session when SUPABASE_DB_PASSWORD is in deploy.local.env.

  Get the database password: Supabase Dashboard → Project → Connect → URI → password.

.EXAMPLE
  .\deploy\vultr\connect-supabase.ps1
.EXAMPLE
  .\deploy\vultr\connect-supabase.ps1 -MigrationListOnly
#>
[CmdletBinding()]
param(
  [switch]$MigrationListOnly,

  [switch]$LoginOnly
)

$ErrorActionPreference = 'Stop'
. (Join-Path $PSScriptRoot '_load-deploy-env.ps1')
$env = Get-DeployEnv -ScriptRoot $PSScriptRoot
$RepoRoot = (Resolve-Path (Join-Path $PSScriptRoot '..\..')).Path
$ref = $env.SupabaseProjectRef
$dbHost = "db.$ref.supabase.co"

if (-not (Get-Command npx -ErrorAction SilentlyContinue)) {
  throw 'npx not found. Install Node.js 22+ from https://nodejs.org and run npm install in the repo root.'
}

Push-Location $RepoRoot
try {
  Write-Host "==> Supabase project: $ref (Smart Base Binary)" -ForegroundColor Cyan
  Write-Host "    Dashboard: https://supabase.com/dashboard/project/$ref" -ForegroundColor DarkGray

  $whoami = & npx supabase projects list 2>&1
  if ($LASTEXITCODE -ne 0) {
    Write-Host '==> Not logged in. Opening browser for Supabase CLI login...' -ForegroundColor Yellow
    & npx supabase login
    if ($LASTEXITCODE -ne 0) { throw 'supabase login failed.' }
  } else {
    Write-Host '==> Supabase CLI session OK' -ForegroundColor Green
  }

  if ($LoginOnly) { return }

  Write-Host '==> Linking repo to remote project (idempotent)...' -ForegroundColor Cyan
  & npx supabase link --project-ref $ref
  if ($LASTEXITCODE -ne 0) {
    Write-Host '    link failed — you may need to enter the database password when prompted.' -ForegroundColor Yellow
  }

  Write-Host '==> Remote migrations on host project:' -ForegroundColor Cyan
  & npx supabase migration list --linked
  if ($LASTEXITCODE -ne 0) {
    Write-Host '    migration list failed (link or password may be missing).' -ForegroundColor Yellow
  }

  if ($MigrationListOnly) { return }

  if (-not $env.SupabaseDbPassword) {
    Write-Host @'

==> Interactive Postgres (psql)
    Add your database password to deploy/vultr/deploy.local.env:

      SUPABASE_DB_PASSWORD=your_password_from_dashboard

    Or run manually:
      npx supabase db connect --linked

    Or SQL Editor (no CLI):
      https://supabase.com/dashboard/project/wkfyavcjjuyzvyeprklz/sql/new

'@ -ForegroundColor Yellow
    return
  }

  $psql = Get-Command psql -ErrorAction SilentlyContinue
  if (-not $psql) {
    Write-Host '==> psql not on PATH. Use: npx supabase db connect --linked' -ForegroundColor Yellow
    & npx supabase db connect --linked
    return
  }

  Write-Host "==> Opening psql to $dbHost ..." -ForegroundColor Cyan
  $env:PGPASSWORD = $env.SupabaseDbPassword
  & psql -h $dbHost -p 5432 -U postgres -d postgres
} finally {
  Remove-Item Env:PGPASSWORD -ErrorAction SilentlyContinue
  Pop-Location
}
