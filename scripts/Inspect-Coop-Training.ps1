#Requires -Version 5.1
# READ-ONLY: inspect the running server's effective training flags.
# Never prints any unrelated environment variables or account information.
[CmdletBinding()]
param([string]$CodePath='C:\Games\EveCoop\upstream-evejs\Code')
$ErrorActionPreference='Stop'
Set-StrictMode -Version Latest
$compose=Join-Path $CodePath 'compose.yaml'
$overlay=Join-Path $CodePath 'compose.coop-probe.yaml'
if (!(Test-Path -LiteralPath $compose -PathType Leaf)) {throw 'Missing pinned EveJS compose.yaml'}
if (!(Test-Path -LiteralPath $overlay -PathType Leaf)) {
  Write-Output 'BLOCKED_COOP_OVERRIDE_MISSING: no LivingCoop overlay at this checkout'
  exit 2
}
$cid= @(& docker compose -f $compose -f $overlay ps -q server) |
  Where-Object { $_ -and $_.Trim() } | Select-Object -First 1
if ($LASTEXITCODE -ne 0 -or !$cid) {
  Write-Output 'BLOCKED_SERVER_NOT_RUNNING: cannot inspect native queue speed'
  exit 2
}
# Read the process container environment, report ONLY two allowlisted values.
$raw=@(& docker inspect --format '{{json .Config.Env}}' $cid)
if ($LASTEXITCODE -ne 0 -or !$raw) {throw 'Could not inspect running server container'}
$vars=@{}
foreach($line in @((($raw -join "`n") | ConvertFrom-Json))) {
  if ($line -match '^(EVEJS_SKILL_TRAINING_SPEED|EVEJS_OMEGA_LICENSE)=(.*)$') {
    $vars[$Matches[1]]=$Matches[2]
  }
}
$speed=$vars['EVEJS_SKILL_TRAINING_SPEED']
$omega=$vars['EVEJS_OMEGA_LICENSE']
if (!$speed) {
  Write-Output 'BLOCKED_TRAINING_CONFIG: effective server lacks EVEJS_SKILL_TRAINING_SPEED'
  exit 2
}
if ($speed -notmatch '^(6|12|24|48)$') {
  Write-Output "UNEXPECTED_TRAINING_SPEED: $speed (compare with server's native config)"
  exit 2
}
Write-Output "RUNNING_NATIVE_TRAINING_SPEED: ${speed}x"
Write-Output "RUNNING_GLOBAL_OMEGA_CONFIGURED: $($omega -eq 'true')"
Write-Output 'QUEUES_NOT_INSPECTED: this does not prove either client ETA or migrated SP'
Write-Output 'To compare rank IV->V durations: node scripts/coop-skill-pacing.cjs 48'
