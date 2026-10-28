#Requires -Version 7.0
<#
.SYNOPSIS
  Manual, local EX-03 native NPC probe source gate.

.DESCRIPTION
  This is the local equivalent of the EX-03 workflow that this repository used to
  run on GitHub. The owner prohibited remote CI automation on 2026-10-24, so the
  procedure lives here instead: it fetches the exact pinned upstream source, runs
  every probe/expedition fixture against it with all native feature flags OFF, and
  then runs the four SQLite SIGKILL/restart verifiers.

  Nothing dispatches this automatically. Run it yourself before enabling a probe
  feature; a green unit suite alone is not evidence that native SQLite custody
  survives a kill window.

  All native feature flags stay OFF in this gate, so it is safe on a plain
  developer machine with a disposable data directory.

.PARAMETER PinnedSha
  The upstream commit every probe fixture is measured against. Must stay equal to
  patches/upstream/MANIFEST.json's pin.

.PARAMETER WorkDir
  Scratch directory for the pinned checkout. Defaults to a fresh temp folder; the
  script refuses to reuse a checkout whose HEAD is a different commit.

.EXAMPLE
  pwsh -File scripts/Run-NpcProbe-PinnedChecks.ps1
#>
param(
  [string]$PinnedSha = 'c3ea396b6761a0ed3e71ad5b8dd7507f9ae6d69f',
  [string]$WorkDir = ''
)

$ErrorActionPreference = 'Stop'
$project = Split-Path -Parent $PSScriptRoot
Push-Location $project
try {
  if (-not (Get-Command node -ErrorAction SilentlyContinue)) {
    throw 'NODE_REQUIRED: install Node 22 before running the EX-03 gate'
  }
  if (-not $WorkDir) {
    $WorkDir = Join-Path ([System.IO.Path]::GetTempPath()) ("ex03-pinned-" + [guid]::NewGuid().ToString('N').Substring(0, 8))
  }
  New-Item -ItemType Directory -Force -Path $WorkDir | Out-Null
  $pinnedRoot = Join-Path $WorkDir 'evejs-native-pinned'
  $sourceDir = Join-Path $WorkDir 'pinned-source'
  New-Item -ItemType Directory -Force -Path $sourceDir | Out-Null

  Write-Host "[ex03] pinned upstream $PinnedSha"
  if (-not (Test-Path (Join-Path $pinnedRoot '.git'))) {
    git -C $pinnedRoot init -q
  }
  git -C $pinnedRoot remote remove origin 2>$null
  git -C $pinnedRoot remote add origin https://github.com/gameboys84/EveJS.git
  git -C $pinnedRoot -c protocol.version=2 fetch -q --depth=1 --filter=blob:none origin $PinnedSha
  git -C $pinnedRoot sparse-checkout init --cone
  git -C $pinnedRoot sparse-checkout set Code/server
  git -C $pinnedRoot checkout -q --detach FETCH_HEAD
  $head = (git -C $pinnedRoot rev-parse HEAD).Trim()
  if ($head -ne $PinnedSha) { throw "PINNED_SHA_MISMATCH: fetched $head, expected $PinnedSha" }

  $serverRoot = Join-Path $pinnedRoot 'Code/server'
  Push-Location $serverRoot
  try {
    npm ci --no-audit --no-fund
    if ($LASTEXITCODE -ne 0) { throw 'PINNED_NPM_CI_FAILED' }
  } finally {
    Pop-Location
  }

  # The probe fixtures read these exact files from the pin rather than from the
  # working tree, so a local edit can never make a fixture pass.
  $pinnedFiles = [ordered]@{
    EVEJS_PINNED_NPC_SERVICE_SOURCE     = 'Code/server/src/space/npc/nativeNpcService.js'
    EVEJS_PINNED_PROBE_SCAN_SOURCE      = 'Code/server/src/services/exploration/probes/probeScanRuntime.js'
    EVEJS_PINNED_PROBE_SCENE_SOURCE     = 'Code/server/src/services/exploration/probes/probeSceneRuntime.js'
    EVEJS_PINNED_HACKING_SOURCE         = 'Code/server/src/services/exploration/hackingMgrService.js'
    EVEJS_PINNED_NPC_WRECK_SOURCE       = 'Code/server/src/space/npc/nativeNpcWreckService.js'
    EVEJS_PINNED_NPC_STORE_SOURCE       = 'Code/server/src/space/npc/nativeNpcStore.js'
  }
  foreach ($name in $pinnedFiles.Keys) {
    $target = Join-Path $sourceDir (Split-Path -Leaf $pinnedFiles[$name])
    Copy-Item -Force (Join-Path $pinnedRoot $pinnedFiles[$name]) $target
    if (-not (Test-Path $target) -or (Get-Item $target).Length -eq 0) {
      throw "PINNED_SOURCE_EMPTY: $name"
    }
    Set-Item -Path ("env:" + $name) -Value $target
  }

  # Every native feature stays off: this gate proves source and custody, not
  # gameplay. Turning one on here would make the verifiers lie about scope.
  $env:EVEJS_COOP_NPC_EXPEDITION_WRECK='0'
  $env:EVEJS_COOP_NPC_EXPEDITION_HACK='0'
  $env:EVEJS_COOP_NPC_EXPEDITION_LOOT='0'
  $env:EVEJS_COOP_NPC_EXPEDITION_WORMHOLES='0'
  $env:EVEJS_COOP_NPC_PROBE_SCAN='0'
  $env:EVEJS_COOP_NPC_PROBE_LAUNCH='0'
  $env:EVEJS_COOP_NPC_PROBE_LOADOUT_SPLIT='0'
  $env:EVEJS_COOP_NATIVE_HACKING_ADMISSION='0'

  $parseTargets = @(
    'integration/coopNpcExpeditionCompetition.cjs'
    'integration/coopNpcExpeditionDirector.cjs'
    'scripts/coop-npc-expedition-hacking-patch.cjs'
    'scripts/verify-npc-expedition-loot-sqlite-crash.mjs'
    'integration/coopNpcWormholeTransit.cjs'
    'integration/coopNpcExpeditionOperations.cjs'
    'integration/coopNpcExpeditionLoot.cjs'
    'integration/coopNpcExpeditionWreckCustody.cjs'
    'scripts/coop-npc-expedition-wreck-patch.cjs'
    'integration/coopNpcProbeHardware.cjs'
    'integration/coopNpcProbeScanEvidence.cjs'
    'integration/coopNativeNpcProbeFlight.cjs'
    'integration/coopNativeNpcProbeSweep.cjs'
    'integration/coopNativeNpcProbeLifecycle.cjs'
    'integration/coopNativeNpcProbeSceneTransition.cjs'
    'integration/coopNpcScoutLoadout.cjs'
    'scripts/coop-npc-scout-loadout-patch.cjs'
    'integration/coopNativeHackingAdmission.cjs'
    'scripts/coop-npc-probe-loadout-split-patch.cjs'
    'scripts/coop-native-hacking-admission-patch.cjs'
    'scripts/patch-evejs-coop.cjs'
  )
  foreach ($file in $parseTargets) {
    node --check $file
    if ($LASTEXITCODE -ne 0) { throw "PARSE_FAILED: $file" }
  }

  # The whole probe/expedition surface, in one process, so a fixture cannot pass
  # only because another file already warmed a cache.
  $fixtures = @(
    'tests/coop-npc-expedition-competition.test.mjs'
    'tests/coop-npc-expedition-director.test.mjs'
    'tests/coop-npc-wormhole-transit.test.mjs'
    'tests/coop-npc-expedition-operations.test.mjs'
    'tests/coop-npc-expedition-loot.test.mjs'
    'tests/coop-npc-expedition-wreck-custody.test.mjs'
    'tests/coop-npc-expedition-wreck-native-source.test.mjs'
    'tests/coop-npc-expedition-hacking.test.mjs'
    'tests/coop-npc-expedition-native-bridge.test.mjs'
    'tests/coop-npc-probe-evidence.test.mjs'
    'tests/coop-npc-probe-wiring.test.mjs'
    'tests/coop-npc-probe-loadout-source.test.mjs'
    'tests/coop-npc-probe-pinned-native-source.test.mjs'
    'tests/coop-native-npc-probe-flight.test.mjs'
    'tests/coop-native-npc-probe-sweep.test.mjs'
    'tests/coop-native-npc-probe-lifecycle.test.mjs'
    'tests/coop-native-npc-probe-full-cycle.test.mjs'
    'tests/coop-native-npc-probe-scene-transition.test.mjs'
    'tests/coop-npc-scout-loadout.test.mjs'
    'tests/coop-native-hacking-admission.test.mjs'
  )
  node --test --test-concurrency=1 @fixtures
  if ($LASTEXITCODE -ne 0) { throw 'EX03_PINNED_FIXTURES_FAILED' }

  # Real native npcCargo SQLite crash/restart: each verifier SIGKILLs itself
  # between stages and proves the durable row set from a fresh process.
  $env:EVEJS_PINNED_SERVER = $serverRoot
  $verifiers = @(
    'scripts/verify-npc-probe-sqlite-crash.mjs'
    'scripts/verify-npc-probe-feature-sqlite-crash.mjs'
    'scripts/verify-npc-expedition-loot-sqlite-crash.mjs'
    'scripts/verify-npc-expedition-wreck-sqlite-crash.mjs'
  )
  foreach ($verifier in $verifiers) {
    node --check $verifier
    if ($LASTEXITCODE -ne 0) { throw "PARSE_FAILED: $verifier" }
    node $verifier
    if ($LASTEXITCODE -ne 0) { throw "EX03_VERIFIER_FAILED: $verifier" }
  }

  Write-Host '[ex03] EX03_PINNED_SOURCE_GATE_PASS'
  Write-Host '[ex03] Two-client bubble movement and expedition fitting remain a separate required gate.'
} finally {
  Pop-Location
}
