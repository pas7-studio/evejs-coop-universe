#Requires -Version 5.1
[CmdletBinding()]
param(
  [int]$ListenPort = 36933,
  [string]$AllowedSourceIp = '',
  [string]$FriendPublicKeyFile = '',
  [string]$SshUser = "$env:USERNAME",
  [switch]$Apply
)
# One-shot host setup for the friend-PC path on a VPN with port forwarding
# (ProtonVPN-style NAT-PMP: the client shows one public port and forwards it to
# the SAME local port, so sshd must listen on that number).
#
# Only SSH is published. EveJS keeps listening on 127.0.0.1 and the friend
# reaches it through an SSH loopback forward.
$ErrorActionPreference = 'Stop'
$identity = [Security.Principal.WindowsIdentity]::GetCurrent()
$principal = New-Object Security.Principal.WindowsPrincipal($identity)
$isAdmin = $principal.IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)

if ($ListenPort -lt 1024 -or $ListenPort -gt 65535) { throw 'ListenPort must be 1024..65535 (never 22 on a forwarded public port).' }
if ($SshUser -notmatch '^[A-Za-z0-9._-]{1,64}$') { throw 'SshUser must be an unambiguous local username.' }
if ($Apply) {
  if (-not $isAdmin) { throw 'Run this script from an elevated PowerShell (Run as administrator).' }
  if (-not $AllowedSourceIp) { throw '-Apply requires -AllowedSourceIp (the friend''s own public IP) so the rule is not open to the internet.' }
  $parsed = $null
  if (-not [System.Net.IPAddress]::TryParse($AllowedSourceIp, [ref]$parsed)) { throw "Invalid -AllowedSourceIp: $AllowedSourceIp" }
}

$configDir = Join-Path $env:ProgramData 'ssh'
$configFile = Join-Path $configDir 'sshd_config'
$dropInDir = Join-Path $configDir 'sshd_config.d'
$dropIn = Join-Path $dropInDir 'coop-friend.conf'
$ruleName = "EveJS co-op SSH $ListenPort"

Write-Host '[SETUP] Friend-PC host setup (SSH only; no EveJS port is published).'
Write-Host ("[SETUP] admin: {0} | sshd config: {1}" -f $isAdmin, $configFile)
Write-Host ''

Write-Host '1) OpenSSH Server capability'
$capability = $null
try { $capability = Get-WindowsCapability -Online -Name 'OpenSSH.Server*' -ErrorAction Stop | Select-Object -First 1 } catch { }
if ($capability) { Write-Host ("   {0}: {1}" -f $capability.Name, $capability.State) }
else { Write-Host '   unknown (elevation required to query)' }

Write-Host ''
Write-Host '2) Planned sshd drop-in'
Write-Host ("   Port {0}" -f $ListenPort)
Write-Host '   PasswordAuthentication no'
Write-Host '   PubkeyAuthentication yes'
Write-Host ("   AllowUsers {0}" -f $SshUser)

Write-Host ''
Write-Host '3) Planned firewall rule'
Write-Host ("   inbound TCP {0} allow only from {1}" -f $ListenPort, $(if ($AllowedSourceIp) { $AllowedSourceIp } else { '<-AllowedSourceIp>' }))

Write-Host ''
Write-Host '4) EveJS must stay loopback-only (informational)'
foreach ($port in @(26000, 26001, 26002, 26003, 443, 5222, 40110)) {
  $listeners = @(Get-NetTCPConnection -State Listen -LocalPort $port -ErrorAction SilentlyContinue)
  foreach ($listener in $listeners) {
    if ($listener.LocalAddress -notin @('127.0.0.1', '::1')) {
      Write-Warning ("   {0}:{1} is NOT loopback - fix the compose binding before playing." -f $listener.LocalAddress, $port)
    }
  }
}

if (-not $Apply) {
  Write-Host ''
  Write-Host 'Dry run. Re-run elevated with:'
  Write-Host ("  .\scripts\Setup-Friend-Host.ps1 -Apply -ListenPort {0} -AllowedSourceIp <friend public ip> -FriendPublicKeyFile <key.pub>" -f $ListenPort)
  return
}

Write-Host ''
Write-Host '[SETUP] Applying...'
if (-not $capability -or $capability.State -ne 'Installed') {
  Add-WindowsCapability -Online -Name 'OpenSSH.Server~~~~0.0.1.0' | Out-Null
  Write-Host '   OpenSSH Server installed'
}
if (-not (Test-Path -LiteralPath $dropInDir)) { New-Item -ItemType Directory -Path $dropInDir -Force | Out-Null }
# The stock sshd_config includes sshd_config.d/*.conf on Windows 11; assert it.
$configText = Get-Content -LiteralPath $configFile -Raw
if ($configText -notmatch '(?m)^\s*Include\s+.*sshd_config\.d') {
  Copy-Item -LiteralPath $configFile -Destination ($configFile + '.coop-backup') -Force
  Add-Content -LiteralPath $configFile -Value "`r`nInclude sshd_config.d/*.conf"
  Write-Host '   added Include sshd_config.d/*.conf (backup: sshd_config.coop-backup)'
}
$dropInText = @(
  '# Managed by scripts/Setup-Friend-Host.ps1 - co-op friend access',
  "Port $ListenPort",
  'PasswordAuthentication no',
  'PubkeyAuthentication yes',
  'PermitRootLogin no',
  "AllowUsers $SshUser"
) -join "`r`n"
[System.IO.File]::WriteAllText($dropIn, $dropInText + "`r`n", (New-Object System.Text.UTF8Encoding($false)))
Write-Host "   wrote $dropIn"

if ($FriendPublicKeyFile) {
  if (-not (Test-Path -LiteralPath $FriendPublicKeyFile -PathType Leaf)) { throw "Missing friend public key: $FriendPublicKeyFile" }
  $key = (Get-Content -LiteralPath $FriendPublicKeyFile -Raw).Trim()
  if ($key -notmatch '^(ssh-ed25519|ssh-rsa|ecdsa-sha2-)') { throw 'That file is not an OpenSSH public key.' }
  $authorized = Join-Path $env:USERPROFILE '.ssh\authorized_keys'
  $sshDir = Split-Path -Parent $authorized
  if (-not (Test-Path -LiteralPath $sshDir)) { New-Item -ItemType Directory -Path $sshDir -Force | Out-Null }
  $current = if (Test-Path -LiteralPath $authorized) { @(Get-Content -LiteralPath $authorized) } else { @() }
  if ($current -notcontains $key) {
    Add-Content -LiteralPath $authorized -Value $key
    Write-Host '   friend public key authorized'
  } else { Write-Host '   friend public key already present' }
  # sshd runs as a service account; authorized_keys must be readable by it.
  icacls $authorized /inheritance:r /grant:r "$($env:USERNAME):(F)" "SYSTEM:(F)" "Administrators:(F)" | Out-Null
} else {
  Write-Warning 'No -FriendPublicKeyFile: password login is disabled, so the friend cannot connect yet.'
}

$existing = @(Get-NetFirewallRule -DisplayName $ruleName -ErrorAction SilentlyContinue)
if ($existing.Count -eq 0) {
  New-NetFirewallRule -DisplayName $ruleName -Direction Inbound -Action Allow -Protocol TCP `
    -LocalPort $ListenPort -RemoteAddress $AllowedSourceIp -Profile Any | Out-Null
  Write-Host "   firewall rule created (only $AllowedSourceIp)"
} else {
  Set-NetFirewallRule -DisplayName $ruleName -RemoteAddress $AllowedSourceIp -Enabled True | Out-Null
  Write-Host '   firewall rule updated'
}

Set-Service -Name sshd -StartupType Automatic
Restart-Service -Name sshd
Write-Host '   sshd restarted'
$listener = @(Get-NetTCPConnection -State Listen -LocalPort $ListenPort -ErrorAction SilentlyContinue)
if ($listener.Count -eq 0) { throw "sshd is not listening on $ListenPort - check sshd_config syntax with: sshd -T" }
Write-Host ("   listening on {0}" -f $ListenPort)

Write-Host ''
Write-Host '[SETUP] Next:'
Write-Host ("   1. VPN client: enable port forwarding for {0} (it must map to the same local port)." -f $ListenPort)
Write-Host ("   2. Friend: .\scripts\Start-Friend-Tunnel.ps1 -Action Start -HostVpnIPv4 <your vpn ip> -SshPort {0} -SshUser {1} -IdentityFile <his key> -AllowPublicPeer" -f $ListenPort, $SshUser)
Write-Host '   3. Friend: .\scripts\Start-Friend-Tunnel.ps1 -Action Verify'
Write-Host '   4. Host:   .\scripts\Local-Two-Client-Test.ps1 -Action CoopStart -NpcSystemID 30000142'
Write-Host ''
Write-Warning 'Only SSH is exposed, restricted to one source address, key-only. EveJS ports remain loopback-only.'
