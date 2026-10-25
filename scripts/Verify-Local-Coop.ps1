#Requires -Version 5.1
[CmdletBinding()]
param(
  [string]$CodePath = 'C:\Games\EveCoop\upstream-evejs\Code',
  [string]$EvidenceRoot = '',
  [switch]$StartBackend,
  [switch]$IncludeUpstreamTests,
  [switch]$RequireLivingUniverse,
  [int]$HealthTimeoutSeconds = 360,
  [switch]$AllowUnpinnedUpstream
)
$ErrorActionPreference = 'Stop'
$projectRoot = Split-Path -Parent $PSScriptRoot
if (-not $EvidenceRoot) { $EvidenceRoot = Join-Path $projectRoot 'test-results' }
$runDir = Join-Path $EvidenceRoot ('verify-' + (Get-Date -Format 'yyyyMMdd-HHmmss-fff'))
New-Item -ItemType Directory -Force -Path $runDir | Out-Null
$results = New-Object System.Collections.ArrayList
$expectedRev = 'c3ea396b6761a0ed3e71ad5b8dd7507f9ae6d69f'

function Record([string]$Name, [string]$Status, [string]$Detail) {
  [void]$results.Add([ordered]@{ name = $Name; status = $Status; detail = $Detail })
  Write-Host "[$Status] $Name - $Detail"
}
function Resolve-Executable([string]$Name) {
  $cmd = Get-Command $Name -ErrorAction SilentlyContinue
  if (-not $cmd) { throw "$Name is missing from PATH" }
  return $cmd.Source
}
function Invoke-Recorded([string]$Name, [string]$Exe, [string[]]$Arguments, [string]$LogName, [switch]$RecordFailure) {
  $stdout = Join-Path $runDir $LogName
  $stderr = Join-Path $runDir ($LogName + '.stderr')
  try {
    & $Exe @Arguments 1> $stdout 2> $stderr
    $code = $LASTEXITCODE
    if ($code -eq 0) {
      if ($RecordFailure) { Record $Name 'PASS' "exit=0; log=$LogName" }
      return $true
    }
    if ($RecordFailure) { Record $Name 'FAIL' "exit=$code; log=$LogName" }
    return $false
  } catch {
    if ($RecordFailure) { Record $Name 'FAIL' "$($_.Exception.Message); log=$LogName" }
    return $false
  }
}
function Compose-Args {
  $result=@('--project-directory',$CodePath,'-f',(Join-Path $CodePath 'compose.yaml'))
  $overlay=Join-Path $CodePath 'compose.coop-probe.yaml'
  if (Test-Path -LiteralPath $overlay -PathType Leaf) {
    $result+=@('-f',$overlay)
  }
  return ,$result
}
function Save-Diagnostics {
  if (-not (Test-Path -LiteralPath (Join-Path $CodePath 'compose.yaml'))) { return }
  try {
    $composeArgs=Compose-Args
    & docker compose @composeArgs ps --all *> (Join-Path $runDir 'compose-ps.txt')
    & docker compose @composeArgs logs --no-color --tail 400 init market server *> (Join-Path $runDir 'compose.log')
  } catch {
    Record 'Docker diagnostics' 'WARNING' $_.Exception.Message
  }
}

try {
  if ($HealthTimeoutSeconds -lt 15 -or $HealthTimeoutSeconds -gt 900) { throw 'HealthTimeoutSeconds must be 15..900' }
  # Validate requested checkout before checking for Docker on CI negative runs.
  if (-not (Test-Path -LiteralPath (Join-Path $CodePath 'compose.yaml'))) { throw "Missing upstream compose.yaml at $CodePath" }
  if (-not (Test-Path -LiteralPath (Join-Path $CodePath 'server/src/services/chat/sessionRegistry.js'))) { throw 'Missing EveJS session registry' }
  $node = Resolve-Executable 'node'
  $docker = Resolve-Executable 'docker'
  $git = Resolve-Executable 'git'
  $powershell = (Get-Process -Id $PID).Path
  $nodeVersion = (& $node --version | Out-String).Trim()
  if ($nodeVersion -notmatch '^v([0-9]+)\.') { throw "Unexpected Node version $nodeVersion" }
  if ([int]$Matches[1] -lt 22) { throw "Node.js 22+ required; got $nodeVersion" }
  $os = (& $docker info --format '{{.OSType}}' 2>&1 | Out-String).Trim()
  if ($LASTEXITCODE -ne 0 -or $os -ne 'linux') { throw "Docker Linux containers required; got $os" }

  $upstreamRev = (& $git -C (Split-Path -Parent $CodePath) rev-parse HEAD 2>$null | Out-String).Trim()
  $projectRev = (& $git -C $projectRoot rev-parse HEAD 2>$null | Out-String).Trim()
  Set-Content -LiteralPath (Join-Path $runDir 'revisions.txt') -Value @("Project=$projectRev", "EveJS=$upstreamRev") -Encoding UTF8
  Record 'Prerequisites' 'PASS' "Node=$nodeVersion; Docker linux"
  if ($upstreamRev -ne $expectedRev) {
    if (-not $AllowUnpinnedUpstream) { throw "Upstream revision $upstreamRev does not match $expectedRev" }
    Record 'Upstream revision' 'WARNING' "Unpinned checkout $upstreamRev"
  } else { Record 'Upstream revision' 'PASS' $upstreamRev }

  $safe = Invoke-Recorded 'Compose safety' $powershell @('-NoProfile','-NonInteractive','-ExecutionPolicy','Bypass','-File',(Join-Path $PSScriptRoot 'Test-ComposeSafety.ps1'),'-CodePath',$CodePath) 'compose-safety.log' -RecordFailure
  $priorPinnedCodeEnv = $env:EVEJS_COOP_CODE_PATH
  $env:EVEJS_COOP_CODE_PATH = $CodePath
  $regressions = Invoke-Recorded 'Client-free regression tests' $node @('--test',(Join-Path $projectRoot 'tests/smoke-two-tcp.test.mjs'),(Join-Path $projectRoot 'tests/coop-scene-audit.test.mjs'),(Join-Path $projectRoot 'tests/coop-reconnect-guard.test.mjs'),(Join-Path $projectRoot 'tests/coop-lifecycle-audit.test.mjs'),(Join-Path $projectRoot 'tests/coop-encounter-director.test.mjs'),(Join-Path $projectRoot 'tests/coop-combat-probe.test.mjs'),(Join-Path $projectRoot 'tests/coop-virtual-world.test.mjs'),(Join-Path $projectRoot 'tests/coop-npc-materializer.test.mjs'),(Join-Path $projectRoot 'tests/coop-npc-topology.test.mjs'),(Join-Path $projectRoot 'tests/coop-npc-presentation.test.mjs'),(Join-Path $projectRoot 'tests/coop-identity-registry.test.mjs'),(Join-Path $projectRoot 'tests/coop-virtual-economy.test.mjs'),(Join-Path $projectRoot 'tests/coop-faction-director.test.mjs'),(Join-Path $projectRoot 'tests/coop-faction-patrol.test.mjs'),(Join-Path $projectRoot 'tests/coop-patrol-orders.test.mjs'),(Join-Path $projectRoot 'tests/coop-npc-life.test.mjs'),(Join-Path $projectRoot 'tests/coop-native-industry.test.mjs'),(Join-Path $projectRoot 'tests/coop-native-consequences.test.mjs'),(Join-Path $projectRoot 'tests/coop-living-session.test.mjs'),(Join-Path $projectRoot 'tests/coop-native-depot.test.mjs'),(Join-Path $projectRoot 'tests/coop-npc-tactics.test.mjs'),(Join-Path $projectRoot 'tests/coop-npc-memory.test.mjs'),(Join-Path $projectRoot 'tests/coop-npc-recognition.test.mjs'),(Join-Path $projectRoot 'tests/coop-native-activity.test.mjs'),(Join-Path $projectRoot 'tests/coop-world-report.test.mjs'),(Join-Path $projectRoot 'tests/coop-native-combat-evidence.test.mjs'),(Join-Path $projectRoot 'tests/coop-npc-weapon-evidence.test.mjs'),(Join-Path $projectRoot 'tests/coop-npc-hostility.test.mjs'),(Join-Path $projectRoot 'tests/coop-native-raid-eligibility.test.mjs'),(Join-Path $projectRoot 'tests/coop-native-raids-gameplay.test.mjs'),(Join-Path $projectRoot 'tests/coop-mining-startup-retry.test.mjs'),(Join-Path $projectRoot 'tests/coop-native-mining-readiness.test.mjs'),(Join-Path $projectRoot 'tests/coop-native-convoy-renewal.test.mjs'),(Join-Path $projectRoot 'tests/coop-native-convoy-evejs-contract.test.mjs'),(Join-Path $projectRoot 'tests/coop-mining-startup-world-report.test.mjs'),(Join-Path $projectRoot 'tests/coop-stock-fleet-combat.test.mjs'),(Join-Path $projectRoot 'tests/coop-native-loot-pickup.test.mjs'),(Join-Path $projectRoot 'tests/coop-native-loot-quarantine.test.mjs'),(Join-Path $projectRoot 'tests/coop-npc-role-priority.test.mjs'),(Join-Path $projectRoot 'tests/coop-npc-destruction-attacker.test.mjs'),(Join-Path $projectRoot 'tests/coop-headless-retry.test.mjs'),(Join-Path $projectRoot 'tests/coop-headless-scene-policy.test.mjs'),(Join-Path $projectRoot 'tests/coop-npc-gate-travel.test.mjs'),(Join-Path $projectRoot 'tests/coop-native-gate-transfer.test.mjs'),(Join-Path $projectRoot 'tests/coop-native-durable-restart.test.mjs'),(Join-Path $projectRoot 'tests/coop-native-durable-id-allocator.test.mjs'),(Join-Path $projectRoot 'tests/coop-native-npc-market.test.mjs'),(Join-Path $projectRoot 'tests/coop-fleet-warp-safety.test.mjs'),(Join-Path $projectRoot 'tests/coop-fleet-warp-arrival.test.mjs'),(Join-Path $projectRoot 'tests/coop-party-fleet-warp-report.test.mjs'),(Join-Path $projectRoot 'tests/coop-party-notices.test.mjs'),(Join-Path $projectRoot 'tests/coop-duo-live-gameplay.test.mjs'),(Join-Path $projectRoot 'tests/coop-duo-reconnect-presence.test.mjs'),(Join-Path $projectRoot 'tests/coop-fleet-p0-cooperative-actions.test.mjs'),(Join-Path $projectRoot 'tests/coop-native-fleet-trade-mission-contract.test.mjs'),(Join-Path $projectRoot 'tests/coop-fleet-dungeon-objective.test.mjs'),(Join-Path $projectRoot 'tests/coop-native-industry-progression.test.mjs'),(Join-Path $projectRoot 'tests/coop-wreck-client-refresh.test.mjs'),(Join-Path $projectRoot 'tests/coop-native-snapshot.test.mjs'),(Join-Path $projectRoot 'tests/coop-reliability-gates.test.mjs'),(Join-Path $projectRoot 'tests/coop-actionable-intel.test.mjs'),(Join-Path $projectRoot 'tests/coop-raid-beacon.test.mjs'),(Join-Path $projectRoot 'tests/coop-pve-chain.test.mjs'),(Join-Path $projectRoot 'tests/coop-player-combat-witness.test.mjs'),(Join-Path $projectRoot 'tests/coop-duo-contribution-report.test.mjs'),(Join-Path $projectRoot 'tests/coop-crossstream-wiring.test.mjs'),(Join-Path $projectRoot 'tests/coop-runtime-probe-ack.test.mjs')) 'backend-regressions.log' -RecordFailure
  $env:EVEJS_COOP_CODE_PATH = $priorPinnedCodeEnv
  $started = $true
  $overlayPath=Join-Path $CodePath 'compose.coop-probe.yaml'
  if ($RequireLivingUniverse -and -not (Test-Path -LiteralPath $overlayPath -PathType Leaf)) {
    Record 'Living Universe configuration' 'FAIL' "Missing $overlayPath. Run -Action CoopStart first."
    $started = $false
  }
  if ($StartBackend -and $safe -and $regressions -and $started) {
    $composeArgs=Compose-Args
    $started = Invoke-Recorded 'Docker Compose up' $docker (@('compose') + $composeArgs + @('up','--detach')) 'compose-up.log' -RecordFailure
  }
  if (-not $safe -or -not $regressions -or -not $started) {
    Record 'Backend health and transport' 'BLOCKED' 'Safety, regression, or startup gate failed'
  } else {
    $healthy = $false
    $deadline = (Get-Date).AddSeconds($HealthTimeoutSeconds)
    $attempt = 0
    do {
      $attempt++
      $healthy = Invoke-Recorded 'Backend health' $powershell @('-NoProfile','-NonInteractive','-ExecutionPolicy','Bypass','-File',(Join-Path $PSScriptRoot 'Check-Backend.ps1'),'-CodePath',$CodePath) "health-attempt-$attempt.log"
      if ($healthy) { break }
      if ((Get-Date).AddSeconds(10) -gt $deadline) { break }
      Start-Sleep -Seconds 10
    } while ((Get-Date) -lt $deadline)
    if ($healthy) {
      Record 'Backend health' 'PASS' "healthy after $attempt attempt(s)"
      if ($RequireLivingUniverse) {
        # Inspect the effective running server, not just a local overlay file.
        # This verifies active flags, NOT that in-game NPCs actually move.
        $check='test "$EVEJS_COOP_VIRTUAL_WORLD" = "1" && test "$EVEJS_COOP_NATIVE_MINING" = "1" && test "$EVEJS_COOP_NPC_RAIDS" = "1" && test "$EVEJS_COOP_LOCAL_INTEL" = "1"'
        $composeArgs=Compose-Args
        $null=Invoke-Recorded 'Living Universe runtime flags' $docker (@('compose') + $composeArgs + @('exec','-T','server','sh','-c',$check)) 'living-runtime-flags.log' -RecordFailure
      } else {
        Record 'Living Universe runtime flags' 'WARNING' 'Not requested; healthy base EveJS and TCP reconnect do not prove native NPC gameplay'
      }
      $null = Invoke-Recorded 'Real EveJS dual TCP sockets' $node @((Join-Path $PSScriptRoot 'smoke-two-tcp.mjs')) 'real-transport.log' -RecordFailure
    } else {
      Record 'Backend health' 'FAIL' "Timed out after $attempt attempts; see health-attempt-*.log"
      Record 'Real EveJS dual TCP sockets' 'BLOCKED' 'Backend not healthy'
    }
  }

  if ($IncludeUpstreamTests) {
    if (-not (Test-Path -LiteralPath (Join-Path $CodePath 'server/node_modules'))) {
      Record 'EveJS scene contracts' 'BLOCKED' 'Run npm ci in the EveJS Code/server folder'
    } else {
      # Each suite must have its own attested temporary gameStore.
      # Shared node --test execution can fail or touch protected live data.
      $testFiles = @(
        'upstream-session-registry.test.mjs',
        'upstream-two-observers.test.mjs',
        'upstream-two-observer-warp.test.mjs',
        'upstream-two-pilot-lifecycle.test.mjs',
        'upstream-two-pilot-movement-and-reconnect.test.mjs',
        'upstream-coop-scene-audit.test.mjs',
        'upstream-two-ship-projection.test.mjs',
        'upstream-ship-prime-recipients.test.mjs',
        'upstream-live-reconnect-contract.test.mjs',
        'upstream-logoff-persistence.test.mjs',
        'upstream-restore-space-contract.test.mjs'
      ) | ForEach-Object { Join-Path (Join-Path $projectRoot 'tests') $_ }
      $runner=Join-Path $PSScriptRoot 'Run-Isolated-Upstream-Tests.cjs'
      $null = Invoke-Recorded 'EveJS scene contracts (isolated)' $node (@($runner,'--code-path',$CodePath,'--') + $testFiles) 'upstream-contracts.log' -RecordFailure
    }
  }
} catch {
  Record 'Verification setup' 'FAIL' $_.Exception.Message
} finally {
  Save-Diagnostics
  $failureCount = @($results | Where-Object { $_.status -in @('FAIL','BLOCKED') }).Count
  $report = [ordered]@{
    createdAt = (Get-Date).ToString('o')
    scope = 'Client-free backend checks, optional isolated upstream contracts and optional Living Universe flags; not proof of actual game-client login or NPC gameplay'
    status = $(if ($failureCount -gt 0) { 'FAIL' } else { 'PASS' })
    evidenceDirectory = $runDir
    results = @($results.ToArray())
  }
  $report | ConvertTo-Json -Depth 8 | Set-Content -LiteralPath (Join-Path $runDir 'report.json') -Encoding UTF8
  Write-Host "Evidence: $runDir"
  Write-Host "Result: $($report.status); failed or blocked: $failureCount"
  if ($failureCount -gt 0) { exit 1 }
}
