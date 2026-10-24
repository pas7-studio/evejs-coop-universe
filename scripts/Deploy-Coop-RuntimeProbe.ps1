#Requires -Version 5.1
[CmdletBinding()]
param([string]$CodePath='C:\Games\EveCoop\upstream-evejs\Code',[switch]$Remove,[switch]$EnableNativeNpcDemo,[int]$NpcCount=1,[int]$NpcSystemID=30000142,[switch]$EnablePersistentEncounters,[int]$EncounterCooldownMinutes=60,[int]$EncounterMaxSpawns=24,[switch]$EnableVirtualWorld,[int]$VirtualPopulation=16,[int]$VirtualTravelSeconds=120)
$ErrorActionPreference='Stop'
if($VirtualPopulation -lt 1 -or $VirtualPopulation -gt 100){throw 'VirtualPopulation must be 1..100'}
if($VirtualTravelSeconds -lt 10){throw 'VirtualTravelSeconds must be >= 10'}
if($EncounterCooldownMinutes -lt 1 -or $EncounterCooldownMinutes -gt 10080){throw 'EncounterCooldownMinutes must be 1..10080'}
if($EncounterMaxSpawns -lt 1 -or $EncounterMaxSpawns -gt 1000){throw 'EncounterMaxSpawns must be 1..1000'}
if($NpcCount -lt 1 -or $NpcCount -gt 3){throw 'NpcCount must be 1..3'}
if(($EnableNativeNpcDemo -or $EnablePersistentEncounters) -and $NpcSystemID -le 0){throw 'Valid NpcSystemID required'}
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
  $yaml += "`n"
  if($EnableNativeNpcDemo -or $EnablePersistentEncounters) {
    $yaml += "      EVEJS_COOP_NATIVE_NPC_DEMO: '1'`n"
    $yaml += "      EVEJS_COOP_NATIVE_NPC_COUNT: '$NpcCount'`n"
    $yaml += "      EVEJS_COOP_NATIVE_NPC_SYSTEM_ID: '$NpcSystemID'`n"
  }
  if($EnablePersistentEncounters) {
    $yaml += "      EVEJS_COOP_PERSISTENT_ENCOUNTERS: '1'`n"
    $yaml += "      EVEJS_COOP_ENCOUNTER_STATE_FILE: '/var/lib/evejs/coop-encounters.json'`n"
    $yaml += "      EVEJS_COOP_ENCOUNTER_COOLDOWN_MS: '$($EncounterCooldownMinutes * 60000)'`n"
    $yaml += "      EVEJS_COOP_ENCOUNTER_MAX_SPAWNS: '$EncounterMaxSpawns'`n"
  }
  if($EnableVirtualWorld) {
    $yaml += "      EVEJS_COOP_VIRTUAL_WORLD: '1'`n"
    $yaml += "      EVEJS_COOP_VIRTUAL_POPULATION: '$VirtualPopulation'`n"
    $yaml += "      EVEJS_COOP_VIRTUAL_TRAVEL_MS: '$($VirtualTravelSeconds * 1000)'`n"
    $yaml += "      EVEJS_COOP_VIRTUAL_STATE_FILE: '/var/lib/evejs/coop-virtual-world.json'`n"
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
