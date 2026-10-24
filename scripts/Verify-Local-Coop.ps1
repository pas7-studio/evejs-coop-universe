#Requires -Version 5.1
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
function Save-Diagnostics {
  if (-not (Test-Path -LiteralPath (Join-Path $CodePath 'compose.yaml'))) { return }
  try {
    & docker compose --project-directory $CodePath -f (Join-Path $CodePath 'compose.yaml') ps --all *> (Join-Path $runDir 'compose-ps.txt')
    & docker compose --project-directory $CodePath -f (Join-Path $CodePath 'compose.yaml') logs --no-color --tail 400 init market server *> (Join-Path $runDir 'compose.log')
  } catch {
    Record 'Docker diagnostics' 'WARNING' $_.Exception.Message
  }
}

try {
  if ($HealthTimeoutSeconds -lt 15 -or $HealthTimeoutSeconds -gt 900) { throw 'HealthTimeoutSeconds must be 15..900' }
  $node = Resolve-Executable 'node'
  $docker = Resolve-Executable 'docker'
  $git = Resolve-Executable 'git'
  $powershell = (Get-Process -Id $PID).Path
  $nodeVersion = (& $node --version | Out-String).Trim()
  if ($nodeVersion -notmatch '^v([0-9]+)\.') { throw "Unexpected Node version $nodeVersion" }
  if ([int]$Matches[1] -lt 22) { throw "Node.js 22+ required; got $nodeVersion" }
  if (-not (Test-Path -LiteralPath (Join-Path $CodePath 'compose.yaml'))) { throw "Missing upstream compose.yaml at $CodePath" }
  if (-not (Test-Path -LiteralPath (Join-Path $CodePath 'server/src/services/chat/sessionRegistry.js'))) { throw 'Missing EveJS session registry' }
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
  $regressions = Invoke-Recorded 'Client-free regression tests' $node @('--test',(Join-Path $projectRoot 'tests/smoke-two-tcp.test.mjs'),(Join-Path $projectRoot 'tests/coop-scene-audit.test.mjs')) 'backend-regressions.log' -RecordFailure
  $started = $true
  if ($StartBackend -and $safe -and $regressions) {
    $started = Invoke-Recorded 'Docker Compose up' $docker @('compose','--project-directory',$CodePath,'-f',(Join-Path $CodePath 'compose.yaml'),'up','--detach') 'compose-up.log' -RecordFailure
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
      $env:EVEJS_CODE_PATH = $CodePath
      $env:EVEJS_SKIP_NPC_STARTUP = '1'
      $env:EVEJS_DISABLE_NPC_ANCHOR_RELEVANCE = '1'
      $testFiles = @(
        'upstream-session-registry.test.mjs',
        'upstream-two-observers.test.mjs',
        'upstream-two-observer-warp.test.mjs',
        'upstream-two-pilot-lifecycle.test.mjs',
        'upstream-two-pilot-movement-and-reconnect.test.mjs',
        'upstream-coop-scene-audit.test.mjs',
        'upstream-two-ship-projection.test.mjs',
        'upstream-ship-prime-recipients.test.mjs'
      ) | ForEach-Object { Join-Path (Join-Path $projectRoot 'tests') $_ }
      $null = Invoke-Recorded 'EveJS scene contracts' $node (@('--test') + $testFiles) 'upstream-contracts.log' -RecordFailure
    }
  }
} catch {
  Record 'Verification setup' 'FAIL' $_.Exception.Message
} finally {
  Save-Diagnostics
  $failureCount = @($results | Where-Object { $_.status -in @('FAIL','BLOCKED') }).Count
  $report = [ordered]@{
    createdAt = (Get-Date).ToString('o')
    scope = 'Client-free backend checks; not proof of real player login or NPC gameplay'
    status = $(if ($failureCount -gt 0) { 'FAIL' } else { 'PASS' })
    evidenceDirectory = $runDir
    results = @($results.ToArray())
  }
  $report | ConvertTo-Json -Depth 8 | Set-Content -LiteralPath (Join-Path $runDir 'report.json') -Encoding UTF8
  Write-Host "Evidence: $runDir"
  Write-Host "Result: $($report.status); failed or blocked: $failureCount"
  if ($failureCount -gt 0) { exit 1 }
}
