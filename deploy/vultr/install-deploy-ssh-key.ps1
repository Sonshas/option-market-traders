<#
.SYNOPSIS
  One-time: copy your Windows SSH public key to the Vultr deploy user (password prompt once).

.EXAMPLE
  powershell -ExecutionPolicy Bypass -File .\deploy\vultr\install-deploy-ssh-key.ps1
#>
[CmdletBinding()]
param(
  [string]$ServerIp = '139.84.240.227',
  [string]$User = 'deploy'
)

$ErrorActionPreference = 'Stop'
$keyEd = Join-Path $env:USERPROFILE '.ssh\id_ed25519.pub'
$keyRsa = Join-Path $env:USERPROFILE '.ssh\id_rsa.pub'
$pub = if (Test-Path $keyEd) { $keyEd } elseif (Test-Path $keyRsa) { $keyRsa } else {
  Write-Host 'No SSH key found. Creating id_ed25519...' -ForegroundColor Cyan
  ssh-keygen -t ed25519 -f (Join-Path $env:USERPROFILE '.ssh\id_ed25519') -N '""'
  $keyEd
}

Write-Host "==> Copying $pub to ${User}@${ServerIp}" -ForegroundColor Cyan
Write-Host '    Enter the Vultr/deploy password when ssh asks (once).' -ForegroundColor Yellow
Get-Content $pub | ssh -o StrictHostKeyChecking=accept-new "${User}@${ServerIp}" "mkdir -p ~/.ssh && chmod 700 ~/.ssh && cat >> ~/.ssh/authorized_keys && chmod 600 ~/.ssh/authorized_keys && echo Key installed."

Write-Host '==> Test key login:' -ForegroundColor Cyan
ssh -o BatchMode=yes "${User}@${ServerIp}" "echo SSH key OK"
