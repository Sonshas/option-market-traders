<#
.SYNOPSIS
  Uploads deploy/vultr/Caddyfile to the Vultr VPS and reloads Caddy.

.EXAMPLE
  .\deploy\vultr\sync-caddy.ps1 -ServerIp 203.0.113.10
#>
[CmdletBinding()]
param(
  [Parameter(Mandatory = $true)]
  [string]$ServerIp,

  [string]$User = 'deploy',

  [string]$SshKey = ''
)

$ErrorActionPreference = 'Stop'
$Caddyfile = Join-Path $PSScriptRoot 'Caddyfile'
if (-not (Test-Path $Caddyfile)) {
  throw "Caddyfile not found at $Caddyfile"
}

$sshOpts = @('-o', 'StrictHostKeyChecking=accept-new', '-o', 'BatchMode=yes', '-o', 'ConnectTimeout=15')
if ($SshKey) {
  $sshOpts += @('-i', $SshKey)
}
$sshTarget = "$User@$ServerIp"
if ($ServerIp.Contains(':')) {
  $scpHost = "$User@[$ServerIp]"
} else {
  $scpHost = $sshTarget
}

Write-Host '==> Uploading Caddyfile (requires root on server)' -ForegroundColor Cyan
scp @sshOpts $Caddyfile "root@${scpHost}:/tmp/Caddyfile.new"
if ($LASTEXITCODE -ne 0) { throw 'scp failed' }

$remote = @(
  'set -e',
  'install -m 644 /tmp/Caddyfile.new /etc/caddy/Caddyfile',
  'caddy validate --config /etc/caddy/Caddyfile --adapter caddyfile',
  'systemctl reload caddy',
  'echo Caddy reloaded OK'
) -join '; '

ssh @sshOpts "root@$ServerIp" $remote
if ($LASTEXITCODE -ne 0) { throw 'Remote Caddy reload failed' }

Write-Host '==> Caddy updated on server.' -ForegroundColor Green
