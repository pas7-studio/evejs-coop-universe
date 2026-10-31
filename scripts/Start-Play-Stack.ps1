#Requires -Version 5.1
<#
.SYNOPSIS
  Start/stop the OWNER's play stack (compose project `evejs`) and keep the
  ProtonVPN -> SSH relay that the owner's friend uses.

.DESCRIPTION
  The friend does not connect to the game port directly. He opens ONE SSH
  connection to the host on the ProtonVPN-forwarded port:

      ssh -N -T -p 64410 evefriend@156.146.50.8 `
        -L 443:127.0.0.1:443 -L 5222:127.0.0.1:5222 `
        -L 26000:127.0.0.1:26000 -L 26001:127.0.0.1:26001 `
        -L 26002:127.0.0.1:26002

  Proton forwards one port at a time (currently 64410 on 156.146.50.8; it changes on every VPN
  reconnect), and that port must carry SSH.
  `evejs-ssh-relay` (alpine/socat, restart unless-stopped) bridges
  0.0.0.0:<PublicPort> to the host's hardened sshd on 127.0.0.1:55346
  (ProgramData/ssh/sshd_config.d/coop-friend.conf).

  This script:
    * brings the play stack up with its own compose files,
    * ensures the relay container is running,
    * verifies the relay really answers with an SSH banner.

  It never addresses the agent work stack (`evejs-agents`) and never removes
  volumes.

.EXAMPLE
  .\Start-Play-Stack.ps1 -Action Status
.EXAMPLE
  .\Start-Play-Stack.ps1 -Action Up
#>
[CmdletBinding()]
param(
  [ValidateSet('Status', 'Up', 'Stop')]
  [string]$Action = 'Status',
  [string]$CodePath = 'C:\Games\EveCoop\upstream-evejs\Code',
  [string]$Project = 'evejs',
  [int]$PublicPort = 64410,
  [int]$SshPort = 55346,
  [string]$RelayName = 'evejs-ssh-relay'
)

$ErrorActionPreference = 'Stop'

if ($Project -eq 'evejs-agents') {
  throw 'This script only manages the owner play stack. Use Start-Agents-Stack.ps1 for evejs-agents.'
}

$composeFiles = @(
  (Join-Path $CodePath 'compose.yaml'),
  (Join-Path $CodePath 'compose.coop-probe.yaml')
)
foreach ($file in $composeFiles) {
  if (-not (Test-Path -LiteralPath $file)) { throw "compose file missing: $file" }
}

function Get-ComposeArgs {
  $args = @('compose', '-p', $Project)
  foreach ($file in $composeFiles) { $args += @('-f', $file) }
  return $args
}

function Test-SshBanner {
  param([string]$HostName, [int]$Port)
  $client = [Net.Sockets.TcpClient]::new()
  try {
    $iar = $client.BeginConnect($HostName, $Port, $null, $null)
    if (-not $iar.AsyncWaitHandle.WaitOne(3000, $false)) { return 'TIMEOUT' }
    $client.EndConnect($iar)
    $stream = $client.GetStream()
    $stream.ReadTimeout = 3000
    $buffer = New-Object byte[] 64
    $read = $stream.Read($buffer, 0, 64)
    return [Text.Encoding]::ASCII.GetString($buffer, 0, $read).Trim()
  } catch {
    return 'ERROR: ' + $_.Exception.Message
  } finally { $client.Close() }
}

function Get-RelayState {
  $running = docker ps --filter "name=^/$RelayName$" --format '{{.Status}}' 2>$null
  $banner = Test-SshBanner -HostName '127.0.0.1' -Port $PublicPort
  [pscustomobject]@{
    Container = if ($running) { $running } else { 'MISSING' }
    SshBanner = if ($banner -like 'SSH-2.0*') { 'OK (' + $banner + ')' } else { $banner }
  }
}

function Get-RelayPort {
  # Published host port of the existing relay container, or $null when it cannot be read.
  $published = docker port $RelayName 2>$null | Select-Object -First 1
  if (-not $published) { return $null }
  return [int](($published -split ':')[-1])
}

function Start-Relay {
  $exists = docker ps -a --filter "name=^/$RelayName$" --format '{{.Names}}' 2>$null
  if ($exists) {
    # ProtonVPN hands out a different forwarded port after every reconnect; a relay
    # still bound to the old port means the friend reaches nothing. Recreate it.
    $current = Get-RelayPort
    if ($current -ne $PublicPort) {
      docker rm -f $RelayName | Out-Null
      $exists = $null
    } else {
      docker start $RelayName | Out-Null
    }
  }
  if (-not $exists) {
    # Two separate argv entries: socat rejects a single space-joined address pair.
    docker run -d --name $RelayName --restart unless-stopped `
      -p "0.0.0.0:${PublicPort}:${PublicPort}" alpine/socat `
      "tcp-listen:${PublicPort},fork,reuseaddr" `
      "tcp-connect:host.docker.internal:${SshPort}" | Out-Null
  }
}

switch ($Action) {
  'Status' {
    $composeArgs = Get-ComposeArgs
    & docker @composeArgs ps 2>$null
    $relay = Get-RelayState
    "ssh relay container : $($relay.Container)"
    "ssh banner on $PublicPort : $($relay.SshBanner)"
    if ($relay.Container -like 'MISSING*' -or $relay.SshBanner -notlike 'OK*') {
      'WARNING: the friend cannot open his tunnel until the relay is running (-Action Up).'
      exit 2
    }
  }
  'Up' {
    $composeArgs = Get-ComposeArgs
    & docker @composeArgs up -d
    if ($LASTEXITCODE -ne 0) { throw "compose up failed with exit code $LASTEXITCODE" }
    Start-Relay
    Start-Sleep -Seconds 8
    $relay = Get-RelayState
    "ssh relay container : $($relay.Container)"
    "ssh banner on $PublicPort : $($relay.SshBanner)"
    if ($relay.SshBanner -notlike 'OK*') { throw 'the ssh relay does not answer with an SSH banner.' }
  }
  'Stop' {
    $composeArgs = Get-ComposeArgs
    & docker @composeArgs stop
    docker stop $RelayName 2>$null | Out-Null
  }
}
