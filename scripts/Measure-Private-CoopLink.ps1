#Requires -Version 5.1
[CmdletBinding()]
param(
  [ValidateSet('Tunnel','SshPeer')][string]$Mode = 'Tunnel',
  [string]$VpnPeerIPv4 = '',
  [int]$SshPort = 22,
  [ValidateRange(2,30)][int]$Samples = 5,
  [ValidateRange(100,10000)][int]$TimeoutMs = 1500
)
# Read-only TCP latency. No SSH keys, passwords, client or Docker access.
$ErrorActionPreference = 'Stop'
if ($SshPort -lt 1 -or $SshPort -gt 65535) { throw 'Invalid SSH port.' }
$ports = if ($Mode -eq 'Tunnel') { @(443, 5222, 26000, 26001, 26002) } else { @($SshPort) }
$address = if ($Mode -eq 'Tunnel') { '127.0.0.1' } else { $VpnPeerIPv4 }
if ($Mode -eq 'SshPeer') {
  $ip = $null
  if (-not [System.Net.IPAddress]::TryParse($VpnPeerIPv4, [ref]$ip) -or $ip.AddressFamily -ne [System.Net.Sockets.AddressFamily]::InterNetwork) {
    throw 'An actual private IPv4 is required.'
  }
  $o = $ip.GetAddressBytes()
  $allowed = ($o[0] -eq 10) -or ($o[0] -eq 172 -and $o[1] -ge 16 -and $o[1] -le 31) -or `
    ($o[0] -eq 192 -and $o[1] -eq 168) -or ($o[0] -eq 100 -and $o[1] -ge 64 -and $o[1] -le 127)
  if (-not $allowed) { throw 'Public SSH IP refused. Use a real private mesh/VPN address; no public port forwarding.' }
}
$failed = $false
foreach ($port in $ports) {
  $durations = New-Object System.Collections.Generic.List[double]
  $timeouts = 0
  for ($i = 0; $i -lt $Samples; $i++) {
    $tcp = New-Object System.Net.Sockets.TcpClient
    $timer = [System.Diagnostics.Stopwatch]::StartNew()
    try {
      $pending = $tcp.BeginConnect($address, $port, $null, $null)
      if (-not $pending.AsyncWaitHandle.WaitOne($TimeoutMs, $false)) { throw 'TCP_TIMEOUT' }
      $tcp.EndConnect($pending)
      $timer.Stop()
      $durations.Add($timer.Elapsed.TotalMilliseconds)
    } catch {
      $timeouts++
    } finally { $tcp.Close() }
  }
  $success = $durations.Count
  if ($success -eq 0) { Write-Host ("[FAIL] {0}:{1} / {2}/{3} TCP attempts failed" -f $address,$port,$timeouts,$Samples); $failed = $true; continue }
  $ordered = @($durations | Sort-Object)
  $p50 = $ordered[[int][Math]::Floor(($success-1) / 2)]
  $p95 = $ordered[[int][Math]::Ceiling(0.95 * ($success-1))]
  $min = $ordered[0]
  $max = $ordered[$success-1]
  Write-Host ("[{0}] {1}:{2} TCP p50={3:N1}ms p95={4:N1}ms range={5:N1}-{6:N1}ms loss={7}/{8}" -f $(if($timeouts){'WARN'}else{'PASS'}),$address,$port,$p50,$p95,$min,$max,$timeouts,$Samples)
  if ($timeouts) { $failed = $true }
}
Write-Host 'TCP connect time is NOT game RTT, authenticated login or scene synchronization; measure client ping/reconnect separately.'
if ($failed) { throw 'One or more private transport probes failed.' }
