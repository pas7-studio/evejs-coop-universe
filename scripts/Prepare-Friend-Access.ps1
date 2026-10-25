#Requires -Version 5.1
[CmdletBinding()]
param(
  [string]$FriendAddress = '',
  [int]$SshPort = 22,
  [string]$FriendPublicKeyFile = '',
  # Some P2P VPNs (for example a WireGuard mesh that hands out real public
  # addresses) require this acknowledgement; the firewall rule stays
  # peer-scoped either way.
  [switch]$AllowPublicPeer,
  [switch]$Apply
)
# Host side of the friend-PC path. Read-only unless -Apply.
# It never exposes EveJS ports: the friend reaches them through an SSH
# loopback forward, so the game server stays bound to 127.0.0.1.
$ErrorActionPreference = 'Stop'
$projectRoot = Split-Path -Parent $PSScriptRoot

function Test-CidrMatch([byte[]]$Bytes,[string]$Cidr){
  $parts=$Cidr.Split('/')
  if($parts.Count -ne 2){throw "Invalid CIDR: $Cidr"}
  $net=$null
  if(-not [System.Net.IPAddress]::TryParse($parts[0],[ref]$net)){throw "Invalid CIDR address: $Cidr"}
  $prefix=[int]$parts[1]
  if($prefix -lt 0 -or $prefix -gt 32){throw "Invalid CIDR prefix: $Cidr"}
  $nb=$net.GetAddressBytes()
  for($i=0;$i -lt 4;$i++){
    $bits=[Math]::Max(0,[Math]::Min(8,$prefix-$i*8))
    if($bits -eq 0){break}
    $mask=[byte]((0xFF -shl (8-$bits)) -band 0xFF)
    if(($Bytes[$i] -band $mask) -ne ($nb[$i] -band $mask)){return $false}
  }
  return $true
}
$privateRanges=@('10.0.0.0/8','172.16.0.0/12','192.168.0.0/16','100.64.0.0/10')
$friendIsPrivate=$false
if($FriendAddress){
  $parsed=$null
  if(-not [System.Net.IPAddress]::TryParse($FriendAddress,[ref]$parsed)){throw "Invalid -FriendAddress: $FriendAddress"}
  $octets=$parsed.GetAddressBytes()
  if($octets.Length -ne 4){throw '-FriendAddress must be IPv4'}
  foreach($range in $privateRanges){ if(Test-CidrMatch $octets $range){$friendIsPrivate=$true;break} }
  if(-not $friendIsPrivate){
    if(-not $AllowPublicPeer){
      throw ("-FriendAddress $FriendAddress is not a private/VPN address (" + ($privateRanges -join ', ') + "). Refusing to open a firewall rule for a public peer without -AllowPublicPeer.")
    }
    Write-Warning "-FriendAddress $FriendAddress is public. The rule stays scoped to that single address, so only this VPN peer can reach SSH. Use a non-default -SshPort and key-only authentication."
  }
}

function Get-HostIPv4Addresses {
  # Get-NetIPAddress can be unavailable (NetTCPIP module missing); fall back to
  # ipconfig so the report is never empty on a connected machine.
  $addresses = @(Get-NetIPAddress -AddressFamily IPv4 -ErrorAction SilentlyContinue |
    Where-Object { $_.IPAddress -ne '127.0.0.1' -and $_.AddressState -eq 'Preferred' } |
    Select-Object -ExpandProperty IPAddress)
  if ($addresses.Count -eq 0) {
    $addresses = @(Get-NetIPAddress -AddressFamily IPv4 -ErrorAction SilentlyContinue |
      Where-Object { $_.IPAddress -ne '127.0.0.1' } |
      Select-Object -ExpandProperty IPAddress -Unique)
  }
  if ($addresses.Count -eq 0) {
    $lines = @(ipconfig 2>$null)
    foreach ($line in $lines) {
      $match = [regex]::Match($line, 'IPv4[^:]*:\s*([0-9]{1,3}(\.[0-9]{1,3}){3})')
      if ($match.Success -and $match.Groups[1].Value -ne '127.0.0.1') { $addresses += $match.Groups[1].Value }
    }
    $addresses = @($addresses | Select-Object -Unique)
  }
  return $addresses
}

Write-Host '[FRIEND] Host-side preparation. Nothing is changed without -Apply.'
Write-Host ''
Write-Host '1) Addresses this host offers to the VPN:'
$vpnAddresses = @(Get-HostIPv4Addresses)
if ($vpnAddresses.Count -eq 0) { Write-Warning 'No non-loopback IPv4 found; is the VPN client connected?' }
foreach ($address in $vpnAddresses) {
  $isPrivate = $false
  $bytes = ([System.Net.IPAddress]::Parse($address)).GetAddressBytes()
  foreach ($range in $privateRanges) { if (Test-CidrMatch $bytes $range) { $isPrivate = $true; break } }
  Write-Host ("   {0}  {1}" -f $address, $(if ($isPrivate) { 'private/VPN (usable)' } elseif ($AllowPublicPeer) { 'public VPN peer address (usable, firewall-scoped)' } else { 'PUBLIC - requires -AllowPublicPeer' }))
}

Write-Host ''
Write-Host '2) OpenSSH Server (the only inbound service the friend needs):'
$capability = $null
try { $capability = Get-WindowsCapability -Online -Name 'OpenSSH.Server*' -ErrorAction Stop | Select-Object -First 1 }
catch { Write-Warning 'Cannot query Windows capabilities without elevation; check manually.' }
if ($capability) { Write-Host ("   capability: {0} ({1})" -f $capability.Name, $capability.State) }
$sshd = Get-Service -Name sshd -ErrorAction SilentlyContinue
if ($sshd) { Write-Host ("   service sshd: {0} / start {1}" -f $sshd.Status, $sshd.StartType) }
else { Write-Host '   service sshd: not installed' }
if ($AllowPublicPeer -and $SshPort -eq 22) {
  Write-Warning 'Peer addresses are public: prefer a non-default -SshPort (for example 2222) and key-only authentication, so internet scanners cannot even reach sshd on 22.'
}

Write-Host ''
Write-Host '3) EveJS listeners must stay loopback-only (checked, never changed):'
$evejsPorts = @(26000, 26001, 26002, 26003, 443, 5222, 40110)
$exposed = @()
foreach ($port in $evejsPorts) {
  $listeners = @(Get-NetTCPConnection -State Listen -LocalPort $port -ErrorAction SilentlyContinue)
  foreach ($listener in $listeners) {
    $where = $listener.LocalAddress
    $loopback = $where -in @('127.0.0.1', '::1', '0.0.0.0', '::')
    $label = if ($where -in @('0.0.0.0', '::')) { 'WILDCARD - fix the compose binding' } elseif ($loopback) { 'loopback' } else { 'NON-LOOPBACK' }
    Write-Host ("   {0}:{1} {2}" -f $where, $port, $label)
    if ($label -ne 'loopback') { $exposed += $port }
  }
}
if ($exposed.Count -gt 0) {
  Write-Warning ('Ports not bound to loopback: ' + ($exposed -join ', ') + '. Do not forward them; fix the compose binding instead.')
} else {
  Write-Host '   OK: no EveJS port is reachable off-box.'
}

Write-Host ''
Write-Host '4) SSH access for the friend:'
if (-not $Apply) {
  Write-Host '   (dry run) would ensure:'
  Write-Host '     - OpenSSH Server capability installed, sshd Automatic + Running'
  Write-Host ("     - inbound firewall rule TCP {0} allowed only from {1}" -f $SshPort, $(if ($FriendAddress) { $FriendAddress } else { '<-FriendAddress>' }))
  Write-Host '     - the friend''s public key appended to the host user''s authorized_keys'
  Write-Host '   Re-run with -Apply -FriendAddress <friend vpn ip> to perform these steps.'
} else {
  if (-not $FriendAddress) { throw '-Apply requires -FriendAddress so the firewall rule is peer-scoped.' }
  if (-not $capability -or $capability.State -ne 'Installed') {
    Write-Host '   installing OpenSSH Server...'
    Add-WindowsCapability -Online -Name 'OpenSSH.Server~~~~0.0.1.0' | Out-Null
  }
  Set-Service -Name sshd -StartupType Automatic
  Start-Service -Name sshd
  $ruleName = "EveJS co-op SSH from friend ($FriendAddress)"
  $existing = @(Get-NetFirewallRule -DisplayName $ruleName -ErrorAction SilentlyContinue)
  if ($existing.Count -eq 0) {
    New-NetFirewallRule -DisplayName $ruleName -Direction Inbound -Action Allow -Protocol TCP `
      -LocalPort $SshPort -RemoteAddress $FriendAddress -Profile Any | Out-Null
    Write-Host ("   firewall rule created for {0}:{1}" -f $FriendAddress, $SshPort)
  } else {
    Write-Host '   firewall rule already exists'
  }
  if ($FriendPublicKeyFile) {
    if (-not (Test-Path -LiteralPath $FriendPublicKeyFile -PathType Leaf)) { throw "Missing friend public key: $FriendPublicKeyFile" }
    $key = (Get-Content -LiteralPath $FriendPublicKeyFile -Raw).Trim()
    if ($key -notmatch '^(ssh-ed25519|ssh-rsa|ecdsa-sha2-)') { throw 'That file does not look like an OpenSSH public key.' }
    $sshDir = Join-Path $env:USERPROFILE '.ssh'
    if (-not (Test-Path -LiteralPath $sshDir)) { New-Item -ItemType Directory -Path $sshDir | Out-Null }
    $authorized = Join-Path $sshDir 'authorized_keys'
    $current = if (Test-Path -LiteralPath $authorized) { Get-Content -LiteralPath $authorized } else { @() }
    if ($current -notcontains $key) { Add-Content -LiteralPath $authorized -Value $key }
    Write-Host '   friend public key authorized'
  } else {
    Write-Host '   no -FriendPublicKeyFile given; the friend cannot log in yet'
  }
}

Write-Host ''
Write-Host '5) What the friend runs on his PC (tunnel is one-way, loopback only):'
Write-Host '   .\scripts\Start-Friend-Tunnel.ps1 -Action Check -HostVpnIPv4 <this host vpn ip> -SshUser <host user>'
Write-Host '   .\scripts\Start-Friend-Tunnel.ps1 -Action Start -HostVpnIPv4 <this host vpn ip> -SshUser <host user> -IdentityFile <his key>'
Write-Host '   .\scripts\Start-Friend-Tunnel.ps1 -Action Verify      # in a second window'
Write-Host ''
Write-Host '6) Then start the world here:'
Write-Host '   .\scripts\Local-Two-Client-Test.ps1 -Action CoopStart -NpcSystemID 30000142'
Write-Host ''
Write-Warning 'No EveJS port is published and no public listener is created. Two different accounts are required. The friend must not run his own EveJS server while tunnelling.'
