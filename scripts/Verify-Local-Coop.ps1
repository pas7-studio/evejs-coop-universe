#Requires -Version 5.1
<#
.SYNOPSIS
One-command, client-free EveJS verification: environment, static safety, Docker
health, real TCP concurrency, upstream contract tests and evidence bundle.
Run from any directory: powershell -ExecutionPolicy Bypass -File scripts/Verify-Local-Coop.ps1
Use -StartBackend to start Compose. Use -IncludeUpstreamTests to run contract tests.
No client binaries, account credentials, global CA trust or public listeners touched.
#>
[CmdletBinding()]
param(
  [string]$CodePath = 'C:\Games\EveCoop\upstream-evejs\Code',
  [string]$EvidenceRoot = '',
  [switch]$StartBackend,
  [switch]$IncludeUpstreamTests,
  [int]$HealthTimeoutSeconds = 360,
  [switch]$AllowUnpinnedUpstream
)
$ErrorActionPreference = 'Stop'
if ($HealthTimeoutSeconds -lt 15 -or $HealthTimeoutSeconds -gt 900) { throw 'HealthTimeoutSeconds must be 15..900' }
$projectRoot = Split-Path -Parent $PSScriptRoot
if (-not $EvidenceRoot) { $EvidenceRoot = Join-Path $projectRoot 'test-results' }
$runDir = Join-Path $EvidenceRoot ('verify-' + (Get-Date -Format 'yyyyMMdd-HHmmss'))
New-Item -ItemType Directory -Force -Path $runDir | Out-Null
$results = New-Object System.Collections.ArrayList
function Record([string]$Name,[string]$Status,[string]$Detail) {
  [void]$results.Add([ordered]@{ name=$Name; status=$Status; detail=$Detail })
  Write-Host "[$Status] $Name - $Detail"
}
function RunExternal([string]$Name,[string]$Exe,[string[]]$Args,[string]$LogName) {
  $log = Join-Path $runDir $LogName
  $errLog = Join-Path $runDir ($LogName + '.stderr')
  try {
    # Invoke executables with an argument ARRAY. Start-Process flattens its
    # ArgumentList into a single string and breaks paths containing spaces.
    # Check-Backend.ps1 is run through the PowerShell executable, not dot-sourced,
    # so a child exit cannot terminate this orchestrator.
    & $Exe @Args 1> $log 2> $errLog
    $exitCode = $LASTEXITCODE
    if ($exitCode -eq 0) { Record $Name 'PASS' "exit=0; log=$LogName"; return $true }
    Record $Name 'FAIL' "exit=$exitCode; log=$LogName"; return $false
  } catch {
    Record $Name 'FAIL' "$($_.Exception.Message); log=$LogName"
    return $false
  }
}
function ResolveExecutable([string]$Name) {
  $cmd=Get-Command $Name -ErrorAction SilentlyContinue
  if (-not $cmd) { throw "$Name is missing from PATH" }
  return $cmd.Source
}
function Snapshot {
  try {
    & docker compose --project-directory $CodePath -f (Join-Path $CodePath 'compose.yaml') ps --all *> (Join-Path $runDir 'compose-ps.txt')
    & docker compose --project-directory $CodePath -f (Join-Path $CodePath 'compose.yaml') logs --no-color --tail 400 init market server *> (Join-Path $runDir 'compose.log')
  } catch { Record 'Docker diagnostic capture' 'FAIL' $_.Exception.Message }
}
try {
  $node=ResolveExecutable 'node'
  $nodeVersion = (& $node --version | Out-String).Trim()
  $nodeMajor = [int]($nodeVersion -replace '^v([0-9]+).*
  $docker=ResolveExecutable 'docker'
  $ps=(Get-Process -Id $PID).Path
  if (-not (Test-Path (Join-Path $CodePath 'compose.yaml'))) { throw "Missing EveJS Code/compose.yaml: $CodePath" }
  if (-not (Test-Path (Join-Path $CodePath 'server/src/services/chat/sessionRegistry.js'))) { throw 'Missing EveJS server source' }
  $os = (& docker info --format '{{.OSType}}' 2>&1 | Out-String).Trim()
  if ($LASTEXITCODE -ne 0 -or $os -ne 'linux') { throw 'Docker Desktop Linux containers are required' }
  Record 'Prerequisites' 'PASS' "Node=$nodeVersion; Docker linux; EveJS present"
  $rev = (& git -C (Split-Path -Parent $CodePath) rev-parse HEAD 2>$null | Out-String).Trim()
  $expectedRev = 'c3ea396b6761a0ed3e71ad5b8dd7507f9ae6d69f'
  if ($rev -ne $expectedRev) {
    if (-not $AllowUnpinnedUpstream) { throw "EveJS checkout $rev differs from tested pin $expectedRev. Supply -AllowUnpinnedUpstream ONLY for explicit exploratory testing." }
    Record 'Upstream revision' 'WARNING' "Unpinned EveJS revision: $rev"
  } else { Record 'Upstream revision' 'PASS' $rev }
  $projectRev = (& git -C $projectRoot rev-parse HEAD 2>$null | Out-String).Trim()
  Set-Content -LiteralPath (Join-Path $runDir 'revisions.txt') -Value @("Project=$projectRev","EveJS=$rev") -Encoding UTF8
  $safe = RunExternal 'Loopback Compose safety' $ps @('-NoProfile','-NonInteractive','-ExecutionPolicy','Bypass','-File',(Join-Path $PSScriptRoot 'Test-ComposeSafety.ps1'),'-CodePath',$CodePath) 'compose-safety.log'
  $selftest = RunExternal 'Client-free TCP and scene diagnostics suite' $node @('--test',(Join-Path $projectRoot 'tests/smoke-two-tcp.test.mjs'),(Join-Path $projectRoot 'tests/coop-scene-audit.test.mjs')) 'backend-regressions.log'
  if ($StartBackend -and $safe) {
    $started = RunExternal 'Docker Compose up' $docker @('compose','--project-directory',$CodePath,'-f',(Join-Path $CodePath 'compose.yaml'),'up','--detach') 'compose-up.log'
  } else { $started = $true }
  if (-not $safe -or -not $selftest -or -not $started) {
    Record 'Backend gate' 'BLOCKED' 'Safety, regression tests, or startup failed'
  } else {
    $deadline=(Get-Date).AddSeconds($HealthTimeoutSeconds)
    $healthy=$false
    do {
      $healthy=RunExternal 'Backend health attempt' $ps @('-NoProfile','-NonInteractive','-ExecutionPolicy','Bypass','-File',(Join-Path $PSScriptRoot 'Check-Backend.ps1'),'-CodePath',$CodePath) 'backend-health.log'
      if ($healthy) {
        # Transient health failures during startup are expected, not final failures.
        for ($i=$results.Count-1; $i -ge 0; $i--) {
          if ($results[$i].name -eq 'Backend health attempt' -and $results[$i].status -eq 'FAIL') { $results.RemoveAt($i) }
        }
        break
      }
      if ((Get-Date).AddSeconds(10) -gt $deadline) { break }
      Start-Sleep -Seconds 10
    } while ((Get-Date) -lt $deadline)
    if ($healthy) {
      $null=RunExternal 'Real EveJS dual-socket transport' $node @((Join-Path $PSScriptRoot 'smoke-two-tcp.mjs')) 'real-transport.log'
    } else {
      Record 'Real EveJS dual-socket transport' 'BLOCKED' 'Backend not healthy'
    }
  }
  if ($IncludeUpstreamTests) {
    $env:EVEJS_CODE_PATH = $CodePath
    $env:EVEJS_SKIP_NPC_STARTUP='1'
    $env:EVEJS_DISABLE_NPC_ANCHOR_RELEVANCE='1'
    $testFiles=@(
      'tests/upstream-session-registry.test.mjs',
      'tests/upstream-two-observers.test.mjs',
      'tests/upstream-two-observer-warp.test.mjs',
      'tests/upstream-two-pilot-lifecycle.test.mjs',
      'tests/upstream-two-pilot-movement-and-reconnect.test.mjs',
      'tests/upstream-coop-scene-audit.test.mjs',
      'tests/upstream-two-ship-projection.test.mjs',
      'tests/upstream-ship-prime-recipients.test.mjs'
    ) | ForEach-Object { Join-Path $projectRoot $_ }
    if (-not (Test-Path (Join-Path $CodePath 'server/node_modules'))) {
      Record 'EveJS scene/session contract tests' 'BLOCKED' 'Upstream dependencies absent: run npm ci in EveJS/Code/server'
    } else {
      $null=RunExternal 'EveJS scene/session contract tests' $node (@('--test')+$testFiles) 'upstream-contracts.log'
    }
  }
} catch {
  Record 'Verification setup' 'FAIL' $_.Exception.Message
} finally {
  if (Test-Path (Join-Path $CodePath 'compose.yaml')) { Snapshot }
  $report=[ordered]@{
    createdAt=(Get-Date).ToString('o')
    scope='Client-free backend verification only; not game login or multiplayer acceptance'
    evidenceDirectory=$runDir
    results=@($results.ToArray())
  }
  $report | ConvertTo-Json -Depth 8 | Set-Content -LiteralPath (Join-Path $runDir 'report.json') -Encoding UTF8
  $failures=@($results | Where-Object { $_.status -eq 'FAIL' -or $_.status -eq 'BLOCKED' })
  Write-Host "Evidence: $runDir"
  Write-Host ('Checks: {0}; failures/blocked: {1}' -f $results.Count,$failures.Count)
  if ($failures.Count -gt 0) { exit 1 }
}
, '$1')
  if ($nodeMajor -lt 22) { throw "Node.js 22+ required; got $nodeVersion" }
  $docker=ResolveExecutable 'docker'
  $ps=(Get-Process -Id $PID).Path
  if (-not (Test-Path (Join-Path $CodePath 'compose.yaml'))) { throw "Missing EveJS Code/compose.yaml: $CodePath" }
  if (-not (Test-Path (Join-Path $CodePath 'server/src/services/chat/sessionRegistry.js'))) { throw 'Missing EveJS server source' }
  $os = (& docker info --format '{{.OSType}}' 2>&1 | Out-String).Trim()
  if ($LASTEXITCODE -ne 0 -or $os -ne 'linux') { throw 'Docker Desktop Linux containers are required' }
  Record 'Prerequisites' 'PASS' "Node=$(& node --version); Docker linux; EveJS present"
  $rev = (& git -C (Split-Path -Parent $CodePath) rev-parse HEAD 2>$null | Out-String).Trim()
  $expectedRev = 'c3ea396b6761a0ed3e71ad5b8dd7507f9ae6d69f'
  if ($rev -ne $expectedRev) {
    if (-not $AllowUnpinnedUpstream) { throw "EveJS checkout $rev differs from tested pin $expectedRev. Supply -AllowUnpinnedUpstream ONLY for explicit exploratory testing." }
    Record 'Upstream revision' 'WARNING' "Unpinned EveJS revision: $rev"
  } else { Record 'Upstream revision' 'PASS' $rev }
  $projectRev = (& git -C $projectRoot rev-parse HEAD 2>$null | Out-String).Trim()
  Set-Content -LiteralPath (Join-Path $runDir 'revisions.txt') -Value @("Project=$projectRev","EveJS=$rev") -Encoding UTF8
  $safe = RunExternal 'Loopback Compose safety' $ps @('-NoProfile','-NonInteractive','-ExecutionPolicy','Bypass','-File',(Join-Path $PSScriptRoot 'Test-ComposeSafety.ps1'),'-CodePath',$CodePath) 'compose-safety.log'
  $selftest = RunExternal 'Client-free TCP and scene diagnostics suite' $node @('--test',(Join-Path $projectRoot 'tests/smoke-two-tcp.test.mjs'),(Join-Path $projectRoot 'tests/coop-scene-audit.test.mjs')) 'backend-regressions.log'
  if ($StartBackend -and $safe) {
    $started = RunExternal 'Docker Compose up' $docker @('compose','--project-directory',$CodePath,'-f',(Join-Path $CodePath 'compose.yaml'),'up','--detach') 'compose-up.log'
  } else { $started = $true }
  if (-not $safe -or -not $selftest -or -not $started) {
    Record 'Backend gate' 'BLOCKED' 'Safety, regression tests, or startup failed'
  } else {
    $deadline=(Get-Date).AddSeconds($HealthTimeoutSeconds)
    $healthy=$false
    do {
      $healthy=RunExternal 'Backend health attempt' $ps @('-NoProfile','-NonInteractive','-ExecutionPolicy','Bypass','-File',(Join-Path $PSScriptRoot 'Check-Backend.ps1'),'-CodePath',$CodePath) 'backend-health.log'
      if ($healthy) {
        # Transient health failures during startup are expected, not final failures.
        for ($i=$results.Count-1; $i -ge 0; $i--) {
          if ($results[$i].name -eq 'Backend health attempt' -and $results[$i].status -eq 'FAIL') { $results.RemoveAt($i) }
        }
        break
      }
      if ((Get-Date).AddSeconds(10) -gt $deadline) { break }
      Start-Sleep -Seconds 10
    } while ((Get-Date) -lt $deadline)
    if ($healthy) {
      $null=RunExternal 'Real EveJS dual-socket transport' $node @((Join-Path $PSScriptRoot 'smoke-two-tcp.mjs')) 'real-transport.log'
    } else {
      Record 'Real EveJS dual-socket transport' 'BLOCKED' 'Backend not healthy'
    }
  }
  if ($IncludeUpstreamTests) {
    $env:EVEJS_CODE_PATH = $CodePath
    $env:EVEJS_SKIP_NPC_STARTUP='1'
    $env:EVEJS_DISABLE_NPC_ANCHOR_RELEVANCE='1'
    $testFiles=@(
      'tests/upstream-session-registry.test.mjs',
      'tests/upstream-two-observers.test.mjs',
      'tests/upstream-two-observer-warp.test.mjs',
      'tests/upstream-two-pilot-lifecycle.test.mjs',
      'tests/upstream-two-pilot-movement-and-reconnect.test.mjs',
      'tests/upstream-coop-scene-audit.test.mjs',
      'tests/upstream-two-ship-projection.test.mjs',
      'tests/upstream-ship-prime-recipients.test.mjs'
    ) | ForEach-Object { Join-Path $projectRoot $_ }
    if (-not (Test-Path (Join-Path $CodePath 'server/node_modules'))) {
      Record 'EveJS scene/session contract tests' 'BLOCKED' 'Upstream dependencies absent: run npm ci in EveJS/Code/server'
    } else {
      $null=RunExternal 'EveJS scene/session contract tests' $node (@('--test')+$testFiles) 'upstream-contracts.log'
    }
  }
} catch {
  Record 'Verification setup' 'FAIL' $_.Exception.Message
} finally {
  if (Test-Path (Join-Path $CodePath 'compose.yaml')) { Snapshot }
  $report=[ordered]@{
    createdAt=(Get-Date).ToString('o')
    scope='Client-free backend verification only; not game login or multiplayer acceptance'
    evidenceDirectory=$runDir
    results=@($results.ToArray())
  }
  $report | ConvertTo-Json -Depth 8 | Set-Content -LiteralPath (Join-Path $runDir 'report.json') -Encoding UTF8
  $failures=@($results | Where-Object { $_.status -eq 'FAIL' -or $_.status -eq 'BLOCKED' })
  Write-Host "Evidence: $runDir"
  Write-Host ('Checks: {0}; failures/blocked: {1}' -f $results.Count,$failures.Count)
  if ($failures.Count -gt 0) { exit 1 }
}
