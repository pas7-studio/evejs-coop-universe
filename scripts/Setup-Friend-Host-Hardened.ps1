#Requires -Version 5.1
<#
.SYNOPSIS
  Hardened host setup for one friend over a forwarded SSH port.

.DESCRIPTION
  Unlike Setup-Friend-Host.ps1 this never authorises the friend as the desktop
  owner. It creates (or reuses) a dedicated local account, authorises only that
  account's key, and restricts the session to port forwarding towards the six
  loopback ports EveJS actually publishes. No shell, no TTY, no agent, no X11,
  no TUN, and no forward target outside that list.

  Installation never waits on Windows Update indefinitely: the OpenSSH Server
  capability is attempted with a hard timeout and falls back to the official
  Win32-OpenSSH release.

.EXAMPLE
  .\Setup-Friend-Host-Hardened.ps1 -Apply -ListenPort 48819 `
      -AllowedSourceIp 176.37.43.83 -FriendPublicKeyFile .\sasha.pub
#>
[CmdletBinding()]
param(
  [int]$ListenPort = 48819,
  [string]$AllowedSourceIp = '',
  [string]$FriendPublicKeyFile = '',
  [string]$SshUser = 'evefriend',
  [int]$InstallTimeoutSeconds = 240,
  [switch]$Apply
)
$ErrorActionPreference = 'Stop'

$identity = [Security.Principal.WindowsIdentity]::GetCurrent()
$principal = New-Object Security.Principal.WindowsPrincipal($identity)
$isAdmin = $principal.IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)

if ($ListenPort -lt 1024 -or $ListenPort -gt 65535) { throw 'ListenPort must be 1024..65535.' }
if ($SshUser -notmatch '^[A-Za-z0-9._-]{1,20}$') { throw 'SshUser must be an unambiguous local username.' }
if ($SshUser -eq $env:USERNAME) { throw 'Refusing to reuse the desktop owner account; pass a dedicated -SshUser.' }
if ($Apply) {
  if (-not $isAdmin) { throw 'Run elevated (Run as administrator).' }
  if (-not $AllowedSourceIp) { throw '-Apply requires -AllowedSourceIp.' }
  if (-not [System.Net.IPAddress]::TryParse($AllowedSourceIp, [ref]$null)) { throw "Invalid -AllowedSourceIp: $AllowedSourceIp" }
  if (-not $FriendPublicKeyFile -or -not (Test-Path -LiteralPath $FriendPublicKeyFile -PathType Leaf)) {
    throw '-Apply requires -FriendPublicKeyFile (his public key).'
  }
}

# EveJS publishes exactly these on 127.0.0.1; a forward target outside the list
# is refused by sshd instead of silently exposing another local service.
$forwardPorts = @(443, 5222, 26000, 26001, 26002, 40110)
$permitOpen = ($forwardPorts | ForEach-Object { "127.0.0.1:$_" }) -join ' '
$configDir = Join-Path $env:ProgramData 'ssh'
$dropInDir = Join-Path $configDir 'sshd_config.d'
$dropIn = Join-Path $dropInDir 'coop-friend.conf'
$ruleName = "EveJS co-op SSH $ListenPort"

function Write-Step($text) { Write-Host ("[STEP] " + $text) }

function Test-SshdPresent {
  return (Get-Service sshd -ErrorAction SilentlyContinue) -or (Test-Path 'C:\Windows\System32\OpenSSH\sshd.exe')
}

function Install-OpenSshServer {
  if (Test-SshdPresent) { Write-Step 'sshd already present'; return }
  if ($InstallTimeoutSeconds -gt 0) {
    Write-Step ("installing OpenSSH Server (capability, timeout ${InstallTimeoutSeconds}s)")
    $job = Start-Job -ScriptBlock {
      try {
        $cap = Get-WindowsCapability -Online -Name 'OpenSSH.Server~~~~0.0.1.0' -ErrorAction Stop
        if ($cap.State -ne 'Installed') {
          Add-WindowsCapability -Online -Name 'OpenSSH.Server~~~~0.0.1.0' -ErrorAction Stop | Out-Null
        }
        'CAPABILITY_OK'
      } catch { 'CAPABILITY_FAILED: ' + $_.Exception.Message }
    }
    $done = Wait-Job -Job $job -Timeout $InstallTimeoutSeconds
    $result = if ($done) { Receive-Job -Job $job } else { 'CAPABILITY_TIMEOUT' }
    # A stuck DISM call inside the job can make Stop-Job block forever, so the
    # job is only stopped when it actually finished.
    if ($done) {
      Remove-Job -Job $job -Force -ErrorAction SilentlyContinue
    } else {
      Write-Step 'capability job still running; leaving it to the OS'
    }
    Write-Step ("capability result: " + ($result -join ' '))
    if (Test-SshdPresent) { return }
  } else {
    Write-Step 'skipping the Windows Update capability (InstallTimeoutSeconds 0)'
  }

  Write-Step 'falling back to the official Win32-OpenSSH release'
  $zip = Join-Path $env:TEMP 'OpenSSH-Win64.zip'
  $target = Join-Path $env:ProgramData 'OpenSSH-Win64'
  Invoke-WebRequest -Uri 'https://github.com/PowerShell/Win32-OpenSSH/releases/latest/download/OpenSSH-Win64.zip' -OutFile $zip -UseBasicParsing
  if (Test-Path $target) { Remove-Item $target -Recurse -Force }
  Expand-Archive -LiteralPath $zip -DestinationPath (Split-Path -Parent $target) -Force
  $src = Join-Path (Split-Path -Parent $target) 'OpenSSH-Win64'
  if ($src -ne $target) { Move-Item -LiteralPath $src -Destination $target -Force }
  & (Join-Path $target 'install-sshd.ps1')
  if (-not (Test-SshdPresent)) { throw 'OpenSSH Server still not installed after the fallback.' }
}

function Ensure-FriendAccount {
  $existing = Get-LocalUser -Name $SshUser -ErrorAction SilentlyContinue
  if ($existing) {
    Write-Step "account $SshUser already exists"
    return
  }
  # Nobody ever types this password: login is key-only. It exists so the account
  # is not passwordless, which Windows treats as a security hole.
  $alphabet = [char[]]'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz23456789!@#$%^&*-_=+'
  $password = -join (1..40 | ForEach-Object { $alphabet[(Get-Random -Maximum $alphabet.Length)] })
  New-LocalUser -Name $SshUser -Password (ConvertTo-SecureString $password -AsPlainText -Force) `
    -PasswordNeverExpires -AccountNeverExpires -Description 'EVE co-op friend tunnel (key-only, forward-only)' | Out-Null
  Write-Step "account $SshUser created (random password, not stored, not an administrator)"
}

function Install-FriendKey {
  $profileDir = Join-Path 'C:\Users' $SshUser
  if (-not (Test-Path -LiteralPath $profileDir)) {
    # The profile is created on first logon; sshd reads it, so create it now.
    New-Item -ItemType Directory -Path $profileDir -Force | Out-Null
  }
  $sshDir = Join-Path $profileDir '.ssh'
  $authorized = Join-Path $sshDir 'authorized_keys'
  if (-not (Test-Path -LiteralPath $sshDir)) { New-Item -ItemType Directory -Path $sshDir -Force | Out-Null }

  $key = (Get-Content -LiteralPath $FriendPublicKeyFile -Raw).Trim()
  if ($key -notmatch '^(ssh-ed25519|ssh-rsa|ecdsa-sha2-)') { throw 'That file is not an OpenSSH public key.' }
  $current = if (Test-Path -LiteralPath $authorized) { @(Get-Content -LiteralPath $authorized) } else { @() }
  if ($current -notcontains $key) { Add-Content -LiteralPath $authorized -Value $key }
  Write-Step "friend key authorised for $SshUser only"

  icacls $authorized /inheritance:r /grant:r "SYSTEM:(F)" "Administrators:(F)" "$($SshUser):(F)" | Out-Null
  icacls $sshDir /inheritance:r /grant:r "SYSTEM:(F)" "Administrators:(F)" "$($SshUser):(F)" | Out-Null
}

function Write-DropIn {
  if (-not (Test-Path -LiteralPath $dropInDir)) { New-Item -ItemType Directory -Path $dropInDir -Force | Out-Null }
  $configFile = Join-Path $configDir 'sshd_config'
  if (-not (Test-Path -LiteralPath $configFile)) {
    # The zip installer does not always leave a base config behind.
    $template = Join-Path $env:ProgramData 'OpenSSH-Win64\sshd_config_default'
    if (Test-Path -LiteralPath $template) {
      Copy-Item -LiteralPath $template -Destination $configFile -Force
      Write-Step 'base sshd_config created from the official default'
    } else {
      [System.IO.File]::WriteAllText($configFile, "# Minimal base config`r`n", (New-Object System.Text.UTF8Encoding($false)))
      Write-Step 'base sshd_config created (minimal)'
    }
  }
  $configText = Get-Content -LiteralPath $configFile -Raw
  # The stock Windows config ends with a `Match Group administrators` block, so
  # an Include appended at the end would be parsed INSIDE that Match block and
  # every global directive in the drop-in would be rejected. The include must be
  # the first line.
  $includeLine = 'Include sshd_config.d/*.conf'
  $allLines = @(Get-Content -LiteralPath $configFile)
  $includeIndexes = @(0..([Math]::Max(0, $allLines.Count - 1)) | Where-Object { $allLines[$_] -match '^\s*Include\s+.*sshd_config\.d' })
  $includeIsFirst = ($allLines.Count -gt 0 -and $allLines[0] -match '^\s*Include\s+.*sshd_config\.d')
  if (-not $includeIsFirst) {
    Copy-Item -LiteralPath $configFile -Destination ($configFile + '.coop-backup') -Force
    $body = @($allLines | Where-Object { $_ -notmatch '^\s*Include\s+.*sshd_config\.d' })
    $rewritten = @($includeLine) + $body
    [System.IO.File]::WriteAllText($configFile, (($rewritten -join "`r`n") + "`r`n"), (New-Object System.Text.UTF8Encoding($false)))
    Write-Step ('include moved to the top of sshd_config (backup: sshd_config.coop-backup)')
  }
  $lines = @(
    '# Managed by scripts/Setup-Friend-Host-Hardened.ps1',
    "Port $ListenPort",
    'PasswordAuthentication no',
    'PubkeyAuthentication yes',
    'PermitRootLogin no',
    'GatewayPorts no',
    'PermitTunnel no',
    "AllowUsers $SshUser",
    'AllowTcpForwarding yes',
    "Match User $SshUser",
    '  PermitTTY no',
    '  X11Forwarding no',
    '  AllowAgentForwarding no',
    '  PermitTunnel no',
    "  PermitOpen $permitOpen",
    '  ForceCommand echo Access denied'
  )
  [System.IO.File]::WriteAllText($dropIn, (($lines -join "`r`n") + "`r`n"), (New-Object System.Text.UTF8Encoding($false)))
  Write-Step "wrote $dropIn (forward targets: $permitOpen)"
}

function Write-FirewallRule {
  $existing = @(Get-NetFirewallRule -DisplayName $ruleName -ErrorAction SilentlyContinue)
  if ($existing.Count -eq 0) {
    New-NetFirewallRule -DisplayName $ruleName -Direction Inbound -Action Allow -Protocol TCP `
      -LocalPort $ListenPort -RemoteAddress $AllowedSourceIp -Profile Any | Out-Null
    Write-Step "firewall rule created (TCP $ListenPort from $AllowedSourceIp only)"
  } else {
    Set-NetFirewallRule -DisplayName $ruleName -RemoteAddress $AllowedSourceIp -Enabled True | Out-Null
    Write-Step 'firewall rule updated'
  }
}

function Ensure-HostKeys {
  $existing = @(Get-ChildItem -LiteralPath $configDir -Filter 'ssh_host_*_key' -ErrorAction SilentlyContinue)
  if ($existing.Count -gt 0) { Write-Step ("host keys present: " + $existing.Count); return }
  $keygen = Join-Path $env:ProgramData 'OpenSSH-Win64\ssh-keygen.exe'
  if (-not (Test-Path $keygen)) { $keygen = (Get-Command ssh-keygen.exe -ErrorAction SilentlyContinue).Source }
  if (-not $keygen) { throw 'ssh-keygen not found; cannot generate host keys.' }
  & $keygen -A
  Write-Step 'host keys generated (ssh-keygen -A)'
}

function Ensure-SshdServicePath {
  $svc = Get-CimInstance Win32_Service -Filter "Name='sshd'" -ErrorAction SilentlyContinue
  if (-not $svc) { Write-Step 'no sshd service registered'; return }
  $wanted = Join-Path $env:ProgramData 'OpenSSH-Win64\sshd.exe'
  $current = [string]$svc.PathName
  if (-not (Test-Path -LiteralPath $wanted)) { Write-Step ("service path kept: " + $current); return }
  # The capability build (9.5) and the GitHub build (10.x) generate different
  # host key types; the service must run the binary that matches the keys.
  if ($current -and (Test-Path -LiteralPath $current) -and ($current -like '*OpenSSH-Win64*')) {
    Write-Step ("service path OK: " + $current)
    return
  }
  & sc.exe config sshd binPath= "`"$wanted`"" | Out-Null
  Write-Step ("service path repaired: " + $current + " -> " + $wanted)
}

function Repair-HostKeyAcls {
  # sshd refuses any private host key that another principal can read, and
  # `icacls /grant:r` keeps existing ACEs (the owner stays). Reset the whole ACL
  # and hand the key to SYSTEM + Administrators only.
  $keys = @(Get-ChildItem -LiteralPath $configDir -Filter 'ssh_host_*_key' -ErrorAction SilentlyContinue)
  foreach ($keyFile in $keys) {
    $acl = Get-Acl -LiteralPath $keyFile.FullName
    $acl.SetAccessRuleProtection($true, $false)
    foreach ($rule in @($acl.Access)) { $acl.RemoveAccessRule($rule) | Out-Null }
    foreach ($id in @('NT AUTHORITY\SYSTEM', 'BUILTIN\Administrators')) {
      $acl.AddAccessRule((New-Object System.Security.AccessControl.FileSystemAccessRule($id, 'FullControl', 'Allow'))) | Out-Null
    }
    $acl.SetOwner((New-Object System.Security.Principal.NTAccount('NT AUTHORITY\SYSTEM')))
    Set-Acl -LiteralPath $keyFile.FullName -AclObject $acl
  }
  Write-Step ("host key ACLs reset to SYSTEM+Administrators: " + $keys.Count)
}

Write-Step ("admin=$isAdmin user=$SshUser port=$ListenPort source=$AllowedSourceIp")
if (-not $Apply) {
  Write-Host ''
  Write-Host 'Dry run. Re-run elevated with -Apply.'
  Write-Host ("  -ListenPort {0} -AllowedSourceIp <friend ip> -FriendPublicKeyFile <key.pub>" -f $ListenPort)
  return
}

try {
  Install-OpenSshServer
  Ensure-FriendAccount
  Install-FriendKey
  Write-DropIn
  Write-FirewallRule
  Ensure-HostKeys
  Repair-HostKeyAcls
  Ensure-SshdServicePath
} catch {
  Write-Step ("FATAL: " + $_.Exception.Message)
  Write-Step ("FATAL_AT: " + $_.InvocationInfo.PositionMessage.Split("`n")[0])
  exit 1
}

$sshdExe = 'C:\Windows\System32\OpenSSH\sshd.exe'
if (-not (Test-Path $sshdExe)) { $sshdExe = (Get-Command sshd.exe -ErrorAction SilentlyContinue).Source }
if ($sshdExe) {
  $test = & $sshdExe -t 2>&1
  $testExit = $LASTEXITCODE
  Write-Step ("sshd -t (exit $testExit): " + ($(if ($test) { $test -join ' ' } else { 'config OK' })))
  if ($testExit -ne 0) { throw ("sshd rejected the configuration: " + ($test -join ' ')) }
}

Set-Service -Name sshd -StartupType Automatic
if ((Get-Service sshd).Status -eq 'Running') { Restart-Service -Name sshd } else { Start-Service -Name sshd }
Write-Step 'sshd running'

$listener = @(Get-NetTCPConnection -State Listen -LocalPort $ListenPort -ErrorAction SilentlyContinue)
if ($listener.Count -eq 0) { throw "sshd is not listening on $ListenPort" }
Write-Step ("listening on {0}" -f $ListenPort)

$hostKey = Join-Path $configDir 'ssh_host_ed25519_key.pub'
if (Test-Path -LiteralPath $hostKey) {
  $fingerprint = (& ssh-keygen -lf $hostKey) 2>&1
  Write-Step ("host key: " + ($fingerprint -join ' '))
}
Write-Host '[DONE] friend access is forward-only and key-only'
