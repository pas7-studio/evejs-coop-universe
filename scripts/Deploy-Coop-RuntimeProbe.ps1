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
  [switch]$EnableNativeCoopContracts,
  [switch]$EnableNativeLpStandings,
  [switch]$EnableNativeExploration,
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
# Jita (30000142) has ZERO official SDE asteroid belts. Retain it as
# an actual trade/patrol system, but do not spawn a stock mining fleet
# that immediately goes "depleted" there. All other selected systems
# remain subject to the upstream authoritative scene + SDE checks.
$nativeMiningRoute = @($route | Where-Object { $_ -ne '30000142' })
$nativeMiningRouteString = $nativeMiningRoute -join ','
$useDemo = $EnableNativeNpcDemo -or $EnablePersistentEncounters -or $CoopCombat
$useWorld = $EnableVirtualWorld -or $LivingCoop
$useMaterialization = $MaterializeVirtualNpcs -or $LivingCoop
$useEconomy = $EnableVirtualEconomy -or $LivingCoop
$usePatrols = $EnableFactionPatrols -or $LivingCoop
# Existing manual materialization limits still win. The LivingCoop default
# admits a real pirate/patrol mixture without manufacturing any new ships.
if ($LivingCoop -and -not $PSBoundParameters.ContainsKey('MaterializeLimit')) {
  $MaterializeLimit = 3
}
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
if ($CoopCombat -or $LivingCoop) {
  $yamlLines += "      EVEJS_COOP_REQUIRE_TWO_PILOTS: '1'"
  $yamlLines += "      EVEJS_COOP_PARTY_RANGE_METERS: '250000'"
}
if ($LivingCoop) {
  # Enable actual two-player presence and opt-in on-grid notice without
  # scripted NPC encounters (LivingCoop still uses autonomous native NPCs).
  $yamlLines += "      EVEJS_COOP_PARTY_NOTICES: '1'"
  $yamlLines += "      EVEJS_COOP_FLEET_WARP_ARRIVAL: '1'"
}
# ContractMgr is a stub in pinned EveJS; this opt-in routes it to the real
# contractProxy with courier acceptor authorization. Keep OFF by default
# until two-client escrow and crash-replay settlement validation.
if ($EnableNativeCoopContracts) {
  $yamlLines += "      EVEJS_COOP_NATIVE_CONTRACTS: '1'"
}
# Static LP Store standing prerequisites: read native effective standing before debit.
# Opt in only after confirming offers/standing data on the two real characters.
if ($EnableNativeLpStandings) {
  $yamlLines += "      EVEJS_COOP_LP_STANDING_REQUIREMENTS: '1'"
}
# Expeditions use authentic completed native scans and permissioned shared bookmarks.
# Explicit opt-in until two-client scanner/warp RPCs are validated.
if ($EnableNativeExploration) {
  $yamlLines += "      EVEJS_COOP_EXPEDITION_SCAN_PROOF: '1'"
  $yamlLines += "      EVEJS_COOP_EXPEDITION_FLEET_BOOKMARKS: '1'"
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
  # A failed first native mining spawn must be retryable; never duplicate an already seeded fleet.
  $yamlLines += "      EVEJS_COOP_MINING_STARTUP_RETRY: '1'"
  # Destroyed complete native convoys may reappear only after 30min, max 4 attempts/day.
  # Ordinary NPC combat still uses physical EveJS hulls and real mining startup.
  $yamlLines += "      EVEJS_COOP_CONVOY_RENEWAL: '1'"
  $yamlLines += "      EVEJS_COOP_NATIVE_HAUL_CARGO: '1'"
  $yamlLines += "      EVEJS_COOP_DEPOT_FILE: '/var/lib/evejs/coop-native-depot.json'"
  $yamlLines += "      EVEJS_COOP_HAULER_HOLD_MS: '120000'"
  $yamlLines += "      EVEJS_COOP_NPC_RAIDS: '1'"
  $yamlLines += "      EVEJS_COOP_NATIVE_TACTICS: '1'"
  $yamlLines += "      EVEJS_COOP_RIVAL_NPC_COMBAT: '1'"
  $yamlLines += "      EVEJS_COOP_FLEET_WARP_SAFETY: '1'"
  # Native fleet-only item/inactive-hull gifts and verified two-person agent turn-ins.
  $yamlLines += "      EVEJS_COOP_FLEET_TRADE_SAFETY: '1'"
  # Objective sharing is safe; automatic second reward is not yet crash-atomic.
  # Keep native player-by-player turn-ins until durable multi-recipient settlement.
  $yamlLines += "      EVEJS_COOP_FLEET_MISSION_TURNIN: '0'"
  # Closed-server progression uses the original EveJS account/skill authority.
  # This affects the actual skill queue and client estimates, not fake SP grants.
  $yamlLines += "      EVEJS_SKILL_TRAINING_SPEED: '6'"
  # Faster T1 blueprint job time; actual minerals, ISK, taxes and skill gates unchanged.
  $yamlLines += "      EVEJS_COOP_MANUFACTURING_TIME_MULTIPLIER: '0.35'"
  # Native EveJS Omega license (both friends get identical free closed-server access).
  # The stock client, skill queue and Alpha/Omega restrictions derive it from storeState.
  $yamlLines += "      EVEJS_OMEGA_LICENSE: 'true'"
  # Share only verified combat dungeon objectives witnessed by both real fleet ships.
  $yamlLines += "      EVEJS_COOP_FLEET_MISSION_SHARE: '1'"
  $yamlLines += "      EVEJS_COOP_NATIVE_WEAPON_EVIDENCE: '1'"
  # Passive native player-on-NPC applied-damage evidence; no damage/loot mutation.
  $yamlLines += "      EVEJS_COOP_PLAYER_DAMAGE_EVIDENCE: '1'"
  $yamlLines += "      EVEJS_COOP_NATIVE_LOOT_EVIDENCE: '1'"
  $yamlLines += "      EVEJS_COOP_NATIVE_LOOT_QUARANTINE: '1'"
  $yamlLines += "      EVEJS_COOP_NATIVE_LOOT_QUARANTINE_FILE: '/var/lib/evejs/coop-native-loot-quarantine.json'"
  $yamlLines += "      EVEJS_COOP_HEADLESS_WORLD_BOOT: '1'"
  # Enable durable named hulls only as part of an explicitly approved LivingCoop deployment.
  $yamlLines += "      EVEJS_COOP_DURABLE_NPC_SHIPS: '1'"
  $yamlLines += "      EVEJS_COOP_FACTION_LAYOUT_V2: '1'"
  $yamlLines += "      EVEJS_COOP_LOCAL_INTEL: '1'"
  $yamlLines += "      EVEJS_COOP_PLAYER_CONSEQUENCES: '1'"
  $yamlLines += "      EVEJS_COOP_NPC_MEMORY: '1'"
  $yamlLines += "      EVEJS_COOP_NPC_MEMORY_FILE: '/var/lib/evejs/coop-npc-memory.json'"
  $yamlLines += "      EVEJS_COOP_STANDINGS_FILE: '/var/lib/evejs/coop-player-consequences.json'"
  $yamlLines += "      EVEJS_MINING_NPC_STANDINGS_ENABLED: 'true'"
  $yamlLines += "      EVEJS_MINING_NPC_NEUTRAL_RESPONSE_COUNT: '2'"
  $yamlLines += "      EVEJS_MINING_NPC_HOSTILE_RESPONSE_COUNT: '4'"
  $yamlLines += "      EVEJS_MINING_NPC_FRIENDLY_RESPONSE_COUNT: '0'"
  # The co-op default route Jita <-> Perimeter mines only in Perimeter.
  # If no eligible route system remains, don't allow blank IDs, because
  # upstream interprets blank as *all* scenes (including beltless Jita).
  $miningStartupEnabled = if ($nativeMiningRoute.Count -gt 0) { 'true' } else { 'false' }
  $yamlLines += "      EVEJS_MINING_NPC_STARTUP_ENABLED: '$miningStartupEnabled'"
  if ($nativeMiningRoute.Count -gt 0) {
    $yamlLines += "      EVEJS_MINING_NPC_STARTUP_SYSTEM_IDS: '$nativeMiningRouteString'"
  }
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
