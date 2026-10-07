<#
.SYNOPSIS
  Open an SSH session to the optionmarkettraders.com Vultr VPS.

.EXAMPLE
  .\deploy\vultr\connect-vultr.ps1 -ServerIp 203.0.113.10
.EXAMPLE
  .\deploy\vultr\connect-vultr.ps1
  # uses VULTR_SERVER_IP from deploy/vultr/deploy.local.env
#>
[CmdletBinding()]
param(
  [string]$ServerIp = '',

  [string]$User = '',

  [string]$SshKey = '',

  [string]$RemoteCommand = ''
)

$ErrorActionPreference = 'Stop'
. (Join-Path $PSScriptRoot '_load-deploy-env.ps1')
$cfg = Get-DeployEnv -ScriptRoot $PSScriptRoot

if (-not $ServerIp) { $ServerIp = $cfg.VultrServerIp }
if (-not $User) { $User = $cfg.VultrSshUser }
if (-not $SshKey) { $SshKey = $cfg.VultrSshKey }

if (-not $ServerIp) {
  throw @'
Vultr IP required.

  1. Vultr dashboard → your server → IPv4 (origin IP, not Cloudflare).
  2. Copy deploy/vultr/deploy.local.env.example → deploy.local.env
  3. Set VULTR_SERVER_IP=<that IPv4>

Then run: .\deploy\vultr\connect-vultr.ps1
Or:       .\deploy\vultr\connect-vultr.ps1 -ServerIp <IPv4>
'@
}

if (-not (Get-Command ssh -ErrorAction SilentlyContinue)) {
  throw 'ssh.exe not found. Install the Windows OpenSSH Client (Settings → Apps → Optional features).'
}

$sshOpts = Get-SshOpts -SshKey $SshKey
$target = "$User@$ServerIp"

Write-Host "==> SSH to $target (optionmarkettraders.com VPS)" -ForegroundColor Cyan
Write-Host '    Tip: active release is under /var/www/optionmarkettraders/current' -ForegroundColor DarkGray

if ($RemoteCommand) {
  ssh @sshOpts $target $RemoteCommand
} else {
  ssh @sshOpts $target
}
