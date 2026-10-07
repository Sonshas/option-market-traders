function Get-DeployEnv {
  param(
    [string]$ScriptRoot = $PSScriptRoot
  )
  $vars = @{
    VultrServerIp       = ''
    VultrSshUser        = 'deploy'
    VultrSshKey         = ''
    SupabaseProjectRef  = 'wkfyavcjjuyzvyeprklz'
    SupabaseDbPassword  = ''
  }
  $localEnv = Join-Path $ScriptRoot 'deploy.local.env'
  if (-not (Test-Path $localEnv)) {
    return $vars
  }
  Get-Content $localEnv | ForEach-Object {
    if ($_ -match '^\s*#' -or $_ -match '^\s*$') { return }
    if ($_ -match '^\s*([^=]+)=(.*)$') {
      $k = $Matches[1].Trim()
      $v = $Matches[2].Trim().Trim('"').Trim("'")
      switch ($k) {
        'VULTR_SERVER_IP' { $vars.VultrServerIp = $v }
        'VULTR_SSH_USER' { $vars.VultrSshUser = $v }
        'VULTR_SSH_KEY' { $vars.VultrSshKey = $v }
        'SUPABASE_PROJECT_REF' { $vars.SupabaseProjectRef = $v }
        'SUPABASE_DB_PASSWORD' { $vars.SupabaseDbPassword = $v }
      }
    }
  }
  return $vars
}

function Get-SshOpts {
  param([string]$SshKey)
  $opts = @('-o', 'StrictHostKeyChecking=accept-new', '-o', 'ConnectTimeout=15')
  if ($SshKey) {
    $opts += @('-i', $SshKey)
  }
  return $opts
}
