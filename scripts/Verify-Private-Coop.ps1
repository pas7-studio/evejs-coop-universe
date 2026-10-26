#Requires -Version 5.1
[CmdletBinding()]
param(
  [string]$CodePath = 'C:\Games\EveCoop\upstream-evejs\Code',
  [string]$HostVpnIPv4 = '',
  [int]$SshPort = 22,
  [switch]$RequireSsh
)
# Strictly read-only. This never starts a container, edits a firewall, or changes volumes.
$ErrorActionPreference = 'Stop'
$scriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$nodeCheck = Join-Path $scriptDir 'coop-private-audit.cjs'
$code = (Resolve-Path -LiteralPath $CodePath -ErrorAction Stop).Path
$nativeConfig = Join-Path $code 'evejs.config.local.json'
if (-not (Test-Path -LiteralPath $nativeConfig -PathType Leaf)) { throw 'Native auth config is missing. No network deployment approval.' }
if (-not (Get-Command docker -ErrorAction SilentlyContinue)) { throw 'Docker CLI unavailable.' }
if (-not (Get-Command node -ErrorAction SilentlyContinue)) { throw 'Node.js 22+ required for private config validation.' }
if (-not (Test-Path -LiteralPath $nodeCheck -PathType Leaf)) { throw 'Private host validator missing.' }
if ($HostVpnIPv4 -and ($SshPort -lt 1 -or $SshPort -gt 65535)) { throw 'Invalid SSH port.' }

$composeArgs = @('-f', 'compose.yaml')
$coopOverlay = Join-Path $code 'compose.coop-probe.yaml'
if (Test-Path -LiteralPath $coopOverlay -PathType Leaf) { $composeArgs += @('-f', 'compose.coop-probe.yaml') }
Push-Location $code
try {
  $text = @(& docker compose @composeArgs config --format json)
  if ($LASTEXITCODE -ne 0 -or $text.Count -eq 0) { throw 'Effective Compose config is unavailable; refusing approval.' }
  $argsList = @($nodeCheck, '--native-config', $nativeConfig)
  if ($HostVpnIPv4) { $argsList += @('--peer', $HostVpnIPv4) }
  $composeJson = $text -join "`n"
  $composeJson | & node @argsList
  if ($LASTEXITCODE -ne 0) { throw 'Private backend configuration gate FAILED. Do not expose the SSH tunnel or start game night.' }

  # Docker Desktop can publish on the host differently than the source YAML.
  # Check observed Windows listeners too; absence is not a successful game login.
  $violations = @()
  foreach ($port in @(443, 5222, 26000, 26001, 26002, 40110)) {
    $listeners = @(Get-NetTCPConnection -State Listen -LocalPort $port -ErrorAction SilentlyContinue)
    foreach ($listener in $listeners) {
      $bind = [string]$listener.LocalAddress
      if ($bind -notin @('127.0.0.1', '::1')) {
        $violations += ('{0}:{1}' -f $bind, $port)
      }
    }
  }
  if ($violations.Count -gt 0) {
    throw ('Actual non-loopback EveJS listeners detected: ' + ($violations -join ', ') + '. Stop and inspect; no automatic firewall change.')
  }
  Write-Host '[PASS] Observed game and market host listeners are loopback-only (or absent).'
  if ($RequireSsh) {
    if (-not $HostVpnIPv4) { throw '-RequireSsh requires the host VPN IPv4.' }
    $sshListeners = @(Get-NetTCPConnection -State Listen -LocalPort $SshPort -ErrorAction SilentlyContinue)
    if ($sshListeners.Count -eq 0) { throw "SSH is not listening on $SshPort." }
    Write-Warning 'A listening SSH port is not proof of key-only authentication or peer-scoped firewall. Verify sshd -T and all effective inbound Allow rules before granting a friend access.'
    Write-Host ('[INFO] SSH listener(s): {0}' -f (($sshListeners | Select-Object -ExpandProperty LocalAddress -Unique) -join ', '))
  }
  Write-Host '[PASS] Static private-host gate. Live authentication, TLS, tunnel latency and two-client gameplay still need separate acceptance.'
} finally {
  Pop-Location
}
