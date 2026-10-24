#Requires -Version 5.1
[CmdletBinding()]
param([string]$CodePath='C:\Games\EveCoop\upstream-evejs\Code',[switch]$Remove,[switch]$EnableNativeNpcDemo,[int]$NpcCount=1,[int]$NpcSystemID=30000142,[switch]$EnablePersistentEncounters,[int]$EncounterCooldownMinutes=60,[int]$EncounterMaxSpawns=24,[switch]$EnableVirtualWorld,[int]$VirtualPopulation=16,[int]$VirtualTravelSeconds=120,[switch]$MaterializeVirtualNpcs,[int]$MaterializeLimit=2,[switch]$EnableVirtualEconomy,[switch]$EnableFactionPatrols,[switch]$CoopCombat,[switch]$LivingCoop,[string]$VirtualRouteSystems='30000142,30000144',[int]$CloneRecoveryMinutes=30)
$ErrorActionPreference='Stop'
if($LivingCoop -and ($EnableNativeNpcDemo -or $EnablePersistentEncounters -or $CoopCombat)){throw 'LivingCoop never creates arena waves. Choose one mode.'}
if($CloneRecoveryMinutes -lt 5 -or $CloneRecoveryMinutes -gt 10080){throw 'CloneRecoveryMinutes must be 5..10080'}
$routeParts=@($VirtualRouteSystems.Split(',') | ForEach-Object { $_.Trim() })
if($routeParts.Count -lt 2 -or @($routeParts | Where-Object { $_ -notmatch '^[0-9]{7,10} -or $MaterializeLimit -gt 10){throw 'MaterializeLimit must be 1..10'}
if($EnableFactionPatrols -and -not $EnableVirtualEconomy){throw 'EnableFactionPatrols requires EnableVirtualEconomy'}
if($EnableVirtualEconomy -and -not $EnableVirtualWorld){throw 'EnableVirtualEconomy requires EnableVirtualWorld'}
if($MaterializeVirtualNpcs -and -not $EnableVirtualWorld){throw 'MaterializeVirtualNpcs requires EnableVirtualWorld'}
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
  if($EnableNativeNpcDemo -or $EnablePersistentEncounters -or $CoopCombat) {
    $yaml += "      EVEJS_COOP_NATIVE_NPC_DEMO: '1'`n"
    $yaml += "      EVEJS_COOP_NATIVE_NPC_COUNT: '$NpcCount'`n"
    $yaml += "      EVEJS_COOP_NATIVE_NPC_SYSTEM_ID: '$NpcSystemID'`n"
  }
  if($CoopCombat -or $LivingCoop) {
    $yaml += "      EVEJS_COOP_REQUIRE_TWO_PILOTS: '1'`n"
    $yaml += "      EVEJS_COOP_PARTY_RANGE_METERS: '250000'`n"
  }
  if($EnablePersistentEncounters) {
    $yaml += "      EVEJS_COOP_PERSISTENT_ENCOUNTERS: '1'`n"
    $yaml += "      EVEJS_COOP_ENCOUNTER_STATE_FILE: '/var/lib/evejs/coop-encounters.json'`n"
    $yaml += "      EVEJS_COOP_ENCOUNTER_COOLDOWN_MS: '$($EncounterCooldownMinutes * 60000)'`n"
    $yaml += "      EVEJS_COOP_ENCOUNTER_MAX_SPAWNS: '$EncounterMaxSpawns'`n"
  }
  if($EnableVirtualWorld -or $LivingCoop) {
    $yaml += "      EVEJS_COOP_VIRTUAL_WORLD: '1'`n"
    $yaml += "      EVEJS_COOP_VIRTUAL_ROUTE: '$VirtualRouteSystems'`n"
    $yaml += "      EVEJS_COOP_LIFE_FILE: '/var/lib/evejs/coop-npc-life.json'`n"
    $yaml += "      EVEJS_COOP_CLONE_RECOVERY_MS: '$($CloneRecoveryMinutes * 60000)'`n"
    $yaml += "      EVEJS_COOP_VIRTUAL_POPULATION: '$VirtualPopulation'`n"
    $yaml += "      EVEJS_COOP_VIRTUAL_TRAVEL_MS: '$($VirtualTravelSeconds * 1000)'`n"
    $yaml += "      EVEJS_COOP_VIRTUAL_STATE_FILE: '/var/lib/evejs/coop-virtual-world.json'`n"
  }
  if($MaterializeVirtualNpcs -or $LivingCoop){
    $yaml += "      EVEJS_COOP_MATERIALIZE_NPCS: '1'`n"
    $yaml += "      EVEJS_COOP_MATERIALIZE_LIMIT: '$MaterializeLimit'`n"
  }
  if($EnableVirtualEconomy -or $LivingCoop){
    $yaml += "      EVEJS_COOP_VIRTUAL_ECONOMY: '1'`n"
    $yaml += "      EVEJS_COOP_ECONOMY_FILE: '/var/lib/evejs/coop-economy.json'`n"
  }
  if($LivingCoop){
    # Reuse stock EveJS miners, mining modules, real asteroid depletion,
    # actual native NPC cargo and the existing miner distress/response AI.
    $yaml += "      EVEJS_COOP_NATIVE_MINING: '1'`n"    $yaml += "      EVEJS_COOP_NATIVE_HAUL_CARGO: '1'`n"    $yaml += "      EVEJS_COOP_HAULER_HOLD_MS: '120000'`n"
    $yaml += "      EVEJS_COOP_NPC_RAIDS: '1'`n"    $yaml += "      EVEJS_COOP_PLAYER_CONSEQUENCES: '1'`n"
    $yaml += "      EVEJS_COOP_STANDINGS_FILE: '/var/lib/evejs/coop-player-consequences.json'`n"
    $yaml += "      EVEJS_MINING_NPC_STANDINGS_ENABLED: 'true'`n"
    $yaml += "      EVEJS_MINING_NPC_NEUTRAL_RESPONSE_COUNT: '2'`n"
    $yaml += "      EVEJS_MINING_NPC_HOSTILE_RESPONSE_COUNT: '4'`n"
    $yaml += "      EVEJS_MINING_NPC_FRIENDLY_RESPONSE_COUNT: '0'`n"
    $yaml += "      EVEJS_MINING_NPC_STARTUP_ENABLED: 'true'`n"
    $yaml += "      EVEJS_MINING_NPC_STARTUP_SYSTEM_IDS: '$VirtualRouteSystems'`n"
    $yaml += "      EVEJS_MINING_NPC_STARTUP_FLEET_COUNT: '1'`n"
    $yaml += "      EVEJS_MINING_NPC_STARTUP_FLEET_MINER_COUNT: '2'`n"
    $yaml += "      EVEJS_MINING_NPC_STARTUP_FLEET_HAULER_COUNT: '1'`n"
    $yaml += "      EVEJS_MINING_NPC_FLEET_AUTO_MINE_ENABLED: 'true'`n"    # Short game-night cadence; stock defaults are 90min first hauler
    # and 30min between trips, far beyond a casual two-player session.
    $yaml += "      EVEJS_MINING_NPC_HAULER_INITIAL_DELAY_MS: '180000'`n"
    $yaml += "      EVEJS_MINING_NPC_HAULER_REPEAT_DELAY_MS: '600000'`n"
    $yaml += "      EVEJS_MINING_NPC_HAUL_THRESHOLD_RATIO: '0.2'`n"
    $yaml += "      EVEJS_MINING_NPC_RESPONSE_DEFAULT_COUNT: '2'`n"
  }
  if($EnableFactionPatrols -or $LivingCoop){
    $yaml += "      EVEJS_COOP_FACTION_PATROLS: '1'`n"
  }
  [System.IO.File]::WriteAllText($override,$yaml,[System.Text.UTF8Encoding]::new($false))
}
Push-Location $CodePath
try {
  $configs=@('compose.yaml')
  if(-not $Remove){$configs+=('compose.coop-probe.yaml')}
  $configArgs=@()
  foreach($c in $configs){$configArgs+=@('-f',$c)}
  $resolved=@(& docker compose @configArgs config --format json)
  if($LASTEXITCODE -ne 0){throw 'Compose override validation failed'}
  $model=($resolved -join "`n") | ConvertFrom-Json
  foreach($service in $model.services.PSObject.Properties){
    foreach($port in @($service.Value.ports)){
      if($null -eq $port){continue}
      if(([string]$port.host_ip) -notin @('127.0.0.1','::1')){
        throw "Unsafe public Compose port on $($service.Name): $($port.published)"
      }
    }
  }
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
 }).Count -gt 0 -or @($routeParts | Select-Object -Unique).Count -lt 2){
  throw 'VirtualRouteSystems requires at least two distinct numeric solar system IDs'
}
if($MaterializeLimit -lt 1 -or $MaterializeLimit -gt 10){throw 'MaterializeLimit must be 1..10'}
if($EnableFactionPatrols -and -not $EnableVirtualEconomy){throw 'EnableFactionPatrols requires EnableVirtualEconomy'}
if($EnableVirtualEconomy -and -not $EnableVirtualWorld){throw 'EnableVirtualEconomy requires EnableVirtualWorld'}
if($MaterializeVirtualNpcs -and -not $EnableVirtualWorld){throw 'MaterializeVirtualNpcs requires EnableVirtualWorld'}
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
  if($EnableNativeNpcDemo -or $EnablePersistentEncounters -or $CoopCombat) {
    $yaml += "      EVEJS_COOP_NATIVE_NPC_DEMO: '1'`n"
    $yaml += "      EVEJS_COOP_NATIVE_NPC_COUNT: '$NpcCount'`n"
    $yaml += "      EVEJS_COOP_NATIVE_NPC_SYSTEM_ID: '$NpcSystemID'`n"
  }
  if($CoopCombat) {
    $yaml += "      EVEJS_COOP_REQUIRE_TWO_PILOTS: '1'`n"
    $yaml += "      EVEJS_COOP_PARTY_RANGE_METERS: '250000'`n"
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
  if($MaterializeVirtualNpcs){
    $yaml += "      EVEJS_COOP_MATERIALIZE_NPCS: '1'`n"
    $yaml += "      EVEJS_COOP_MATERIALIZE_LIMIT: '$MaterializeLimit'`n"
  }
  if($EnableVirtualEconomy){
    $yaml += "      EVEJS_COOP_VIRTUAL_ECONOMY: '1'`n"
    $yaml += "      EVEJS_COOP_ECONOMY_FILE: '/var/lib/evejs/coop-economy.json'`n"
  }
  if($EnableFactionPatrols){
    $yaml += "      EVEJS_COOP_FACTION_PATROLS: '1'`n"
  }
  [System.IO.File]::WriteAllText($override,$yaml,[System.Text.UTF8Encoding]::new($false))
}
Push-Location $CodePath
try {
  $configs=@('compose.yaml')
  if(-not $Remove){$configs+=('compose.coop-probe.yaml')}
  $configArgs=@()
  foreach($c in $configs){$configArgs+=@('-f',$c)}
  $resolved=@(& docker compose @configArgs config --format json)
  if($LASTEXITCODE -ne 0){throw 'Compose override validation failed'}
  $model=($resolved -join "`n") | ConvertFrom-Json
  foreach($service in $model.services.PSObject.Properties){
    foreach($port in @($service.Value.ports)){
      if($null -eq $port){continue}
      if(([string]$port.host_ip) -notin @('127.0.0.1','::1')){
        throw "Unsafe public Compose port on $($service.Name): $($port.published)"
      }
    }
  }
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
