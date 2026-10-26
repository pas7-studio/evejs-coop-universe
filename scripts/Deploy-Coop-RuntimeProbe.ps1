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
  [ValidateSet(6,12,24,48,100)][int]$CoopSkillTrainingSpeed = 100,
  [switch]$ConfirmActiveTrainingRebased,
  [switch]$EnableNativeCoopContracts,
  [switch]$EnableNativeLpStandings,
  [switch]$EnableMarketCatalog,
  [switch]$EnableMissionJoin,
  [switch]$EnableNativeExploration,
  [switch]$EnableNpcExpeditions,
  [switch]$EnableNpcProbeScan,
  [switch]$EnableNpcProbeLaunch,
  [switch]$EnableNpcProbeLoadoutSplit,
  [switch]$EnableNativeHackingAdmission,
  [switch]$EnableAtomicCoopTrade,
  [switch]$EnableDuoMissionSettlement,
  [switch]$EnableNpcStationDelivery,
  [switch]$EnableConvoyOperations,
  [switch]$EnableNativeJobAgents,
  [switch]$EnableFullHaulManifest,
[switch]$Alife,
[switch]$AlifeTrace,
  [string]$VirtualRouteSystems = '30000142,30000144',
  [int]$CloneRecoveryMinutes = 30
)
$ErrorActionPreference = 'Stop'
if ($EnableMarketCatalog -and -not $LivingCoop) { throw 'Market catalog requires -LivingCoop' }
Set-StrictMode -Version Latest

function Assert-Range([string]$Name,[int]$Value,[int]$Min,[int]$Max) {
  if ($Value -lt $Min -or $Value -gt $Max) {
    throw "$Name must be between $Min and $Max"
  }
}
if ($EnableMissionJoin -and -not $LivingCoop) { throw 'Native mission join requires -LivingCoop' }
if ($EnableDuoMissionSettlement -and -not $LivingCoop) { throw 'Duo settlement requires -LivingCoop' }
if ($EnableAtomicCoopTrade -and -not $LivingCoop) { throw 'Atomic co-op trade requires -LivingCoop' }
if ($EnableNpcStationDelivery -and -not $LivingCoop) { throw 'NPC native station delivery requires -LivingCoop' }
if ($EnableConvoyOperations -and -not $LivingCoop) { throw 'Native convoy operations require -LivingCoop' }
if ($EnableNativeJobAgents -and -not $LivingCoop) { throw 'Native NPC job agents require -LivingCoop' }
if ($EnableFullHaulManifest -and (-not $LivingCoop -or -not $EnableNpcStationDelivery)) { throw 'Full native cargo manifest requires LivingCoop and station delivery' }
if (($Alife -or $AlifeTrace) -and -not $LivingCoop) { throw 'ALIFE mode requires -LivingCoop' }
if ($AlifeTrace -and -not $Alife) { throw '-AlifeTrace requires -Alife' }
if ($EnableNpcExpeditions -and (-not $Alife -or -not $LivingCoop)) {
  throw 'Native NPC expeditions require -LivingCoop -Alife'
}
if ($EnableNativeHackingAdmission -and -not $EnableNativeExploration) {
  throw 'Native hacking admission requires -EnableNativeExploration'
}
if ($EnableNpcProbeScan -and (-not $EnableNpcExpeditions -or -not $EnableNativeExploration)) {
  throw 'NPC physical probe scan requires -EnableNpcExpeditions -EnableNativeExploration'
}
if ($EnableNpcProbeLaunch -and -not $EnableNpcProbeScan) {
  throw 'NPC native probe launch requires -EnableNpcProbeScan'
}
if ($EnableNpcProbeLoadoutSplit -and -not $EnableNpcProbeLaunch) {
  throw 'NPC scanner charge unitization requires -EnableNpcProbeLaunch'
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
# Native active queues derive SP from persisted activeStartTime and CURRENT speed.
# A faster rate on an old timestamp can retroactively credit unearned SP.
# Never change an existing world silently; require an operator-verified rebase.
if ($LivingCoop -and -not $Remove -and (Test-Path -LiteralPath $override -PathType Leaf)) {
  $previous = [System.IO.File]::ReadAllText($override)
  $priorMatch = [regex]::Match($previous, '(?m)^\s*EVEJS_SKILL_TRAINING_SPEED:\s*[\x27\x22]?(\d+)')
  if ($priorMatch.Success) {
    $priorSpeed = [int]$priorMatch.Groups[1].Value
    if ($priorSpeed -ne $CoopSkillTrainingSpeed -and -not $ConfirmActiveTrainingRebased) {
      throw "Training rate ${priorSpeed}x -> $($CoopSkillTrainingSpeed)x BLOCKED: native active queues need old-rate SP settlement and a timestamp rebase. Read docs/COOP_LOCAL_PROGRESSION_V2.md. Only after verifying the rebase may you specify -ConfirmActiveTrainingRebased. Or retain the old rate with -CoopSkillTrainingSpeed $priorSpeed."
    }
  }
}
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
$yamlLines += "      EVEJS_COOP_AGENT_DIALOGUE: '1'"
$yamlLines += "      EVEJS_COOP_NPC_CHATTER: '1'"
  if ($EnableConvoyOperations) {
    $yamlLines += "      EVEJS_COOP_CONVOY_OPERATIONS: '1'"
  }
  $yamlLines += "      EVEJS_COOP_FLEET_WARP_ARRIVAL: '1'"
}
# Discovery/agent dialogue only: no escort escrow or payouts enabled here.
# No chat commands required for the player-facing native Agent + EVEmail flow.
if ($EnableNativeJobAgents) {
  $yamlLines += "      EVEJS_COOP_OPPORTUNITY_BOARD: '1'"
  $yamlLines += "      EVEJS_COOP_OPPORTUNITY_MAIL: '1'"
  $yamlLines += "      EVEJS_COOP_NATIVE_JOB_AGENT: '1'"
  $yamlLines += "      EVEJS_COOP_NPC_JOBS: '1'"
}
if ($EnableMissionJoin) { $yamlLines += "      EVEJS_COOP_MISSION_JOIN: '1'" }
if ($EnableDuoMissionSettlement) {
  $yamlLines += "      EVEJS_COOP_FLEET_MISSION_TURNIN: '1'"
  $yamlLines += "      EVEJS_COOP_FLEET_LEADER_FENCE: '1'"
}
# Co-op atomic trade remains OFF unless explicitly requested on an approved LivingCoop deploy.
if ($EnableAtomicCoopTrade) {
  $yamlLines += "      EVEJS_COOP_ATOMIC_TRADE: '1'"
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
if ($EnableMarketCatalog) {
  $yamlLines += "      EVEJS_COOP_MARKET_CATALOG: '1'"
}
# Explicit opt-in only after native two-client exploration validation.
if ($EnableNativeExploration) {
  $yamlLines += "      EVEJS_COOP_EXPEDITION_SCAN_PROOF: '1'"
  $yamlLines += "      EVEJS_COOP_EXPEDITION_FLEET_BOOKMARKS: '1'"
}
# EX-02 / EX-04A: independent explicit opt-ins, not implicitly enabled
# by the generic exploration or LivingCoop switches.
if ($EnableNpcExpeditions) {
  $yamlLines += "      EVEJS_COOP_NPC_EXPEDITIONS: '1'"
}
# EX-03B read-only probe-evidence admission only. This does NOT deploy
# a native launcher/charge writer; it denies scans until genuine original
# flight receipts and materialized physical probes can be verified.
if ($EnableNpcProbeScan) {
  $yamlLines += "      EVEJS_COOP_NPC_PROBE_SCAN: '1'"
}
# EX-03B2: original cargo debit is an EXTRA opt-in beyond read-only scans.
# Disable until SQLite fault-injection + physical two-client scene checks pass.
if ($EnableNpcProbeLaunch) {
  $yamlLines += "      EVEJS_COOP_NPC_PROBE_LAUNCH: '1'"
}
if ($EnableNpcProbeLoadoutSplit) {
  $yamlLines += "      EVEJS_COOP_NPC_PROBE_LOADOUT_SPLIT: '1'"
}
if ($EnableNativeHackingAdmission) {
  $yamlLines += "      EVEJS_COOP_NATIVE_HACKING_ADMISSION: '1'"
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
  if ($EnableNpcStationDelivery) {
    $yamlLines += "      EVEJS_COOP_NPC_STATION_DELIVERY: '1'"
    if ($EnableFullHaulManifest) { $yamlLines += "      EVEJS_COOP_NATIVE_HAUL_MANIFEST: '1'" }
    $yamlLines += "      EVEJS_COOP_NPC_WAREHOUSE_DIR: '/var/lib/evejs/coop-native-warehouse'"
  }
  if ($Alife) {
    # ALIFE-1: one master switch implies native order arbitration.
    $yamlLines += "      EVEJS_COOP_ALIFE: '1'"
    # Short in-client digest of already-observed native events (throttled).
    $yamlLines += "      EVEJS_COOP_ALIFE_NEWS: '1'"
  }
  if ($AlifeTrace) {
    # Blockers are data: name the reason instead of a silent skip.
    $yamlLines += "      EVEJS_COOP_ALIFE_TRACE: '1'"
  }
  $yamlLines += "      EVEJS_COOP_DEPOT_FILE: '/var/lib/evejs/coop-native-depot.json'"
  $yamlLines += "      EVEJS_COOP_HAULER_HOLD_MS: '45000'"
  $yamlLines += "      EVEJS_COOP_NPC_RAIDS: '1'"
  $yamlLines += "      EVEJS_COOP_NATIVE_TACTICS: '1'"
  $yamlLines += "      EVEJS_COOP_RIVAL_NPC_COMBAT: '1'"
  $yamlLines += "      EVEJS_COOP_FLEET_WARP_SAFETY: '1'"
  # Native fleet-only item/inactive-hull gifts and verified two-person agent turn-ins.
  $yamlLines += "      EVEJS_COOP_FLEET_TRADE_SAFETY: '1'"
  # Objective sharing is safe; automatic second reward is not yet crash-atomic.
  # Keep native player-by-player turn-ins until durable multi-recipient settlement.
  if (-not $EnableDuoMissionSettlement) { $yamlLines += "      EVEJS_COOP_FLEET_MISSION_TURNIN: '0'" }
  # Closed-server progression uses the original EveJS account/skill authority.
  # This affects the actual skill queue and client estimates, not fake SP grants.
  $yamlLines += "      EVEJS_SKILL_TRAINING_SPEED: '$CoopSkillTrainingSpeed'"
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
  if (-not $Remove) {
    # A stale or partially deployed module must never reach a Docker image.
    & $installer -CodePath $code -Check
    if ($LASTEXITCODE -ne 0) { throw 'Deployed overlay does not match this repository (run with -Check for details); refusing to build.' }
  }
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
  # Publish a redacted snapshot so cloud sessions can see what was deployed.
  $publisher = Join-Path $PSScriptRoot 'Publish-SessionState.ps1'
  if ((Test-Path -LiteralPath $publisher -PathType Leaf) -and (Get-Command node -ErrorAction SilentlyContinue)) {
    $mode = if ($Remove) { 'remove' } elseif ($LivingCoop) { 'LivingCoop' } else { 'optional runtime' }
    try {
      & $publisher -CodePath $code -Note "deploy $mode" -Next 'run -Action World -WorldSystemID 30000144' -SkipTests -SkipClient
    } catch {
      Write-Warning "[STATE] Session state publish failed: $($_.Exception.Message)"
    }
  }
}
finally {
  Pop-Location
}
