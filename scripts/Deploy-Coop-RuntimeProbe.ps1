#Requires -Version 5.1
[CmdletBinding()]
param(
  [string]$CodePath = 'C:\Games\EveCoop\upstream-evejs\Code',
  [switch]$Remove,
  [switch]$EnableNativeNpcDemo,
  [int]$NpcCount = 1,
  [int]$NpcSystemID = 30000142,
  [switch]$EnablePersistentEncounters,
  [int]$EncounterCooldownMinutes = 60,
  [int]$EncounterMaxSpawns = 24,
  [switch]$EnableVirtualWorld,
  [int]$VirtualPopulation = 16,
  [int]$VirtualTravelSeconds = 120,
  [switch]$MaterializeVirtualNpcs,
  [int]$MaterializeLimit = 2,
  [switch]$EnableVirtualEconomy,
  [switch]$EnableFactionPatrols,
  [switch]$CoopCombat,
  [switch]$LivingCoop,
  [string]$VirtualRouteSystems = '30000142,30000144',
  [int]$CloneRecoveryMinutes = 30
)
$ErrorActionPreference = 'Stop'
Set-StrictMode -Version Latest

function Assert-Range([string]$Name,[int]$Value,[int]$Min,[int]$Max) {
  if ($Value -lt $Min -or $Value -gt $Max) {
    throw "$Name must be between $Min and $Max"
  }
}
Assert-Range 'NpcCount' $NpcCount 1 3
Assert-Range 'EncounterCooldownMinutes' $EncounterCooldownMinutes 1 10080
Assert-Range 'EncounterMaxSpawns' $EncounterMaxSpawns 1 1000
Assert-Range 'VirtualPopulation' $VirtualPopulation 1 100
Assert-Range 'VirtualTravelSeconds' $VirtualTravelSeconds 10 3600
Assert-Range 'MaterializeLimit' $MaterializeLimit 1 10
Assert-Range 'CloneRecoveryMinutes' $CloneRecoveryMinutes 5 10080
if ($NpcSystemID -le 0) { throw 'NpcSystemID must be positive' }

$route = @($VirtualRouteSystems.Split(',') | ForEach-Object { $_.Trim() })
$invalidRoute = @($route | Where-Object { $_ -notmatch '^[0-9]{7,10}$' })
if ($route.Count -lt 2 -or $invalidRoute.Count -gt 0 -or
    @($route | Select-Object -Unique).Count -ne $route.Count) {
  throw 'VirtualRouteSystems must contain at least two distinct numeric EVE solar-system IDs'
}
$routeString = $route -join ','
$useDemo = $EnableNativeNpcDemo -or $EnablePersistentEncounters -or $CoopCombat
$useWorld = $EnableVirtualWorld -or $LivingCoop
$useMaterialization = $MaterializeVirtualNpcs -or $LivingCoop
$useEconomy = $EnableVirtualEconomy -or $LivingCoop
$usePatrols = $EnableFactionPatrols -or $LivingCoop
if ($LivingCoop -and $useDemo) {
  throw 'LivingCoop runs autonomous NPCs; scripted PvE encounters cannot be combined with it'
}
if ($useMaterialization -and -not $useWorld) {
  throw 'MaterializeVirtualNpcs requires EnableVirtualWorld'
}
if ($useEconomy -and -not $useWorld) {
  throw 'EnableVirtualEconomy requires EnableVirtualWorld'
}
if ($usePatrols -and -not $useEconomy) {
  throw 'EnableFactionPatrols requires EnableVirtualEconomy'
}

$code = (Resolve-Path -LiteralPath $CodePath -ErrorAction Stop).Path
$installer = Join-Path $PSScriptRoot 'Install-Coop-RuntimeProbe.ps1'
$override = Join-Path $code 'compose.coop-probe.yaml'
if (-not (Test-Path -LiteralPath (Join-Path $code 'compose.yaml') -PathType Leaf)) {
  throw "Missing pinned EveJS compose.yaml at $code"
}
if (-not (Get-Command docker -ErrorAction SilentlyContinue)) { throw 'Docker CLI not found' }

$yamlLines = @(
  'services:'
  '  server:'
  '    environment:'
  '      EVEJS_COOP_EVENTS_FILE: /var/lib/evejs/coop-events.jsonl'
)
if ($useDemo) {
  $yamlLines += "      EVEJS_COOP_NATIVE_NPC_DEMO: '1'"
  $yamlLines += "      EVEJS_COOP_NATIVE_NPC_COUNT: '$NpcCount'"
  $yamlLines += "      EVEJS_COOP_NATIVE_NPC_SYSTEM_ID: '$NpcSystemID'"
}
if ($CoopCombat) {
  $yamlLines += "      EVEJS_COOP_REQUIRE_TWO_PILOTS: '1'"
  $yamlLines += "      EVEJS_COOP_PARTY_RANGE_METERS: '250000'"
}
if ($EnablePersistentEncounters) {
  $yamlLines += "      EVEJS_COOP_PERSISTENT_ENCOUNTERS: '1'"
  $yamlLines += "      EVEJS_COOP_ENCOUNTER_STATE_FILE: '/var/lib/evejs/coop-encounters.json'"
  $yamlLines += "      EVEJS_COOP_ENCOUNTER_COOLDOWN_MS: '$($EncounterCooldownMinutes * 60000)'"
  $yamlLines += "      EVEJS_COOP_ENCOUNTER_MAX_SPAWNS: '$EncounterMaxSpawns'"
}
if ($useWorld) {
  $yamlLines += "      EVEJS_COOP_VIRTUAL_WORLD: '1'"
  $yamlLines += "      EVEJS_COOP_VIRTUAL_ROUTE: '$routeString'"
  $yamlLines += "      EVEJS_COOP_VIRTUAL_POPULATION: '$VirtualPopulation'"
  $yamlLines += "      EVEJS_COOP_VIRTUAL_TRAVEL_MS: '$($VirtualTravelSeconds * 1000)'"
  $yamlLines += "      EVEJS_COOP_VIRTUAL_STATE_FILE: '/var/lib/evejs/coop-virtual-world.json'"
  $yamlLines += "      EVEJS_COOP_LIFE_FILE: '/var/lib/evejs/coop-npc-life.json'"
  $yamlLines += "      EVEJS_COOP_CLONE_RECOVERY_MS: '$($CloneRecoveryMinutes * 60000)'"
}
if ($useMaterialization) {
  $yamlLines += "      EVEJS_COOP_MATERIALIZE_NPCS: '1'"
  $yamlLines += "      EVEJS_COOP_MATERIALIZE_LIMIT: '$MaterializeLimit'"
}
if ($useEconomy) {
  $yamlLines += "      EVEJS_COOP_VIRTUAL_ECONOMY: '1'"
  $yamlLines += "      EVEJS_COOP_ECONOMY_FILE: '/var/lib/evejs/coop-economy.json'"
}
if ($usePatrols) {
  $yamlLines += "      EVEJS_COOP_FACTION_PATROLS: '1'"
}
if ($LivingCoop) {
  # Use existing, real EveJS mining, cargo, defenders and standing policy.
  $yamlLines += "      EVEJS_COOP_NATIVE_MINING: '1'"
  $yamlLines += "      EVEJS_COOP_NATIVE_HAUL_CARGO: '1'"
  $yamlLines += "      EVEJS_COOP_DEPOT_FILE: '/var/lib/evejs/coop-native-depot.json'"
  $yamlLines += "      EVEJS_COOP_HAULER_HOLD_MS: '120000'"
  $yamlLines += "      EVEJS_COOP_NPC_RAIDS: '1'"
  $yamlLines += "      EVEJS_COOP_LOCAL_INTEL: '1'"
  $yamlLines += "      EVEJS_COOP_PLAYER_CONSEQUENCES: '1'"
  $yamlLines += "      EVEJS_COOP_STANDINGS_FILE: '/var/lib/evejs/coop-player-consequences.json'"
  $yamlLines += "      EVEJS_MINING_NPC_STANDINGS_ENABLED: 'true'"
  $yamlLines += "      EVEJS_MINING_NPC_NEUTRAL_RESPONSE_COUNT: '2'"
  $yamlLines += "      EVEJS_MINING_NPC_HOSTILE_RESPONSE_COUNT: '4'"
  $yamlLines += "      EVEJS_MINING_NPC_FRIENDLY_RESPONSE_COUNT: '0'"
  $yamlLines += "      EVEJS_MINING_NPC_STARTUP_ENABLED: 'true'"
  $yamlLines += "      EVEJS_MINING_NPC_STARTUP_SYSTEM_IDS: '$routeString'"
  $yamlLines += "      EVEJS_MINING_NPC_STARTUP_FLEET_COUNT: '1'"
  $yamlLines += "      EVEJS_MINING_NPC_STARTUP_FLEET_MINER_COUNT: '2'"
  $yamlLines += "      EVEJS_MINING_NPC_STARTUP_FLEET_HAULER_COUNT: '1'"
  $yamlLines += "      EVEJS_MINING_NPC_FLEET_AUTO_MINE_ENABLED: 'true'"
  $yamlLines += "      EVEJS_MINING_NPC_HAULER_INITIAL_DELAY_MS: '180000'"
  $yamlLines += "      EVEJS_MINING_NPC_HAULER_REPEAT_DELAY_MS: '600000'"
  $yamlLines += "      EVEJS_MINING_NPC_HAUL_THRESHOLD_RATIO: '0.2'"
  $yamlLines += "      EVEJS_MINING_NPC_RESPONSE_DEFAULT_COUNT: '2'"
}

$utf8 = [System.Text.UTF8Encoding]::new($false)
Push-Location $code
try {
  if (-not $Remove) {
    # Validate the pinned patch before mutating source files or Docker state.
    & $installer -CodePath $code -DryRun
    if ($LASTEXITCODE -ne 0) { throw 'Pinned EveJS source preflight failed' }
    [System.IO.File]::WriteAllText($override,
      (($yamlLines -join [Environment]::NewLine) + [Environment]::NewLine), $utf8)
    $composeArgs = @('-f','compose.yaml','-f','compose.coop-probe.yaml')
  } else {
    $composeArgs = @('-f','compose.yaml')
  }
  $effective = @(& docker compose @composeArgs config --format json)
  if ($LASTEXITCODE -ne 0) { throw 'Effective Docker Compose configuration is invalid' }
  $config = ($effective -join [Environment]::NewLine) | ConvertFrom-Json
  foreach ($service in $config.services.PSObject.Properties) {
    $portsField = $service.Value.PSObject.Properties['ports']
    if ($null -eq $portsField) { continue }
    foreach ($port in @($portsField.Value)) {
      if ($null -eq $port) { continue }
      $bindField = $port.PSObject.Properties['host_ip']
      $bindAddress = if ($null -ne $bindField) { [string]$bindField.Value } else { '' }
      if ($bindAddress -notin @('127.0.0.1','::1')) {
        throw "Refusing publicly bound game service port on $($service.Name)"
      }
    }
  }
  & $installer -CodePath $code -Remove:$Remove
  if ($LASTEXITCODE -ne 0) { throw 'Co-op overlay installation failed' }
  if ($Remove -and (Test-Path -LiteralPath $override)) {
    Remove-Item -LiteralPath $override -Force
  }
  # Build against the actual source overlay, never wipe named data volumes.
  & docker compose @composeArgs build
  if ($LASTEXITCODE -ne 0) { throw 'Docker image build failed' }
  & docker compose @composeArgs up -d
  if ($LASTEXITCODE -ne 0) { throw 'Docker Compose startup failed' }
  Write-Host ('[COOP] ' + $(if ($Remove) { 'overlay removed' } elseif ($LivingCoop) {
    'persistent Living Universe started'
  } else { 'optional co-op runtime started' }))
  Write-Host '[COOP] EveJS data volumes were preserved. Game clients still require live validation.'
}
finally {
  Pop-Location
}
