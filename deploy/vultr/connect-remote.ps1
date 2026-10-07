<#
.SYNOPSIS
  Menu: connect to Supabase (CLI/Postgres) and/or Vultr (SSH).

.EXAMPLE
  .\deploy\vultr\connect-remote.ps1
.EXAMPLE
  .\deploy\vultr\connect-remote.ps1 -Supabase -Vultr
#>
[CmdletBinding()]
param(
  [switch]$Supabase,

  [switch]$Vultr,

  [string]$ServerIp = ''
)

$ScriptDir = $PSScriptRoot

if (-not $Supabase -and -not $Vultr) {
  Write-Host @'
Remote connections for SmartBaseBinary

  [1] Supabase — CLI login, link, migration list, psql (host DB)
  [2] Vultr    — SSH shell on the web server
  [3] Both     — Supabase checks first, then Vultr SSH

'@ -ForegroundColor Cyan
  $choice = Read-Host 'Choose 1, 2, or 3'
  switch ($choice) {
    '1' { $Supabase = $true }
    '2' { $Vultr = $true }
    '3' { $Supabase = $true; $Vultr = $true }
    default { throw 'Invalid choice.' }
  }
}

if ($Supabase) {
  & (Join-Path $ScriptDir 'connect-supabase.ps1')
}

if ($Vultr) {
  $vultrArgs = @{}
  if ($ServerIp) { $vultrArgs.ServerIp = $ServerIp }
  & (Join-Path $ScriptDir 'connect-vultr.ps1') @vultrArgs
}
