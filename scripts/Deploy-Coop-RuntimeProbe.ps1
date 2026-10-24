#Requires -Version 5.1
[CmdletBinding()]
param([string]$CodePath='C:\Games\EveCoop\upstream-evejs\Code',[switch]$Remove,[switch]$EnableNativeNpcDemo,[int]$NpcCount=1,[int]$NpcSystemID=30000142)
$ErrorActionPreference='Stop'
if($NpcCount -lt 1 -or $NpcCount -gt 3){throw 'NpcCount must be 1..3'}
if($EnableNativeNpcDemo -and $NpcSystemID -le 0){throw 'Valid NpcSystemID required'}
$projectRoot=Split-Path -Parent $PSScriptRoot
$installer=Join-Path $PSScriptRoot 'Install-Coop-RuntimeProbe.ps1'
$override=Join-Path $CodePath 'compose.coop-probe.yaml'
& $installer -CodePath $CodePath -Remove:$Remove
if($Remove) {
  if(Test-Path -LiteralPath $override){Remove-Item -LiteralPath $override -Force}
} else {
  $yaml=@'
services:
  server:
    environment:
      EVEJS_COOP_EVENTS_FILE: /var/lib/evejs/coop-events.jsonl
'@
  if($EnableNativeNpcDemo) {
    $yaml += "      EVEJS_COOP_NATIVE_NPC_DEMO: '1'`n"
    $yaml += "      EVEJS_COOP_NATIVE_NPC_COUNT: '$NpcCount'`n"
    $yaml += "      EVEJS_COOP_NATIVE_NPC_SYSTEM_ID: '$NpcSystemID'`n"
  }
  [System.IO.File]::WriteAllText($override,$yaml,[System.Text.UTF8Encoding]::new($false))
}
Push-Location $CodePath
try {
  & docker compose -f compose.yaml build
  if($LASTEXITCODE -ne 0){throw 'Docker build failed'}
  if($Remove) {
    & docker compose -f compose.yaml up -d
  } else {
    & docker compose -f compose.yaml -f compose.coop-probe.yaml up -d
  }
  if($LASTEXITCODE -ne 0){throw 'Docker startup failed'}
  Write-Host ('[DONE] Co-op probe ' + $(if($Remove){'removed'}else{'installed and started'}))
} finally {Pop-Location}
