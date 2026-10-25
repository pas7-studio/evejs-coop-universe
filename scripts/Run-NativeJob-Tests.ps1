#Requires -Version 5.1
[CmdletBinding()]
param(
  [switch]$CheckPinned,
  [string]$CodePath = 'C:\Games\EveCoop\upstream-evejs\Code'
)
$ErrorActionPreference = 'Stop'
$root = Split-Path -Parent $PSScriptRoot
Push-Location $root
try {
  if (-not (Get-Command node -ErrorAction SilentlyContinue)) {
    throw 'Node.js 22+ is required for local job tests'
  }
  $files = @(
    'tests/coop-npc-job-board.test.mjs',
    'tests/coop-native-job-agent.test.mjs',
    'tests/coop-native-job-agent-interest-replay.test.mjs',
    'tests/coop-native-job-agent-selection.test.mjs',
    'tests/coop-native-job-notifications.test.mjs',
    'tests/coop-escort-priced-mail-replay.test.mjs',
    'tests/coop-escort-restart-duo-authority.test.mjs',
    'tests/coop-escort-native-binding.test.mjs',
    'tests/coop-escort-durable-flight-recovery.test.mjs',
    'tests/coop-escort-durable-warp-fence.test.mjs',
    'tests/coop-escort-station-predeparture-gate.test.mjs',
    'tests/coop-escort-peaceful-settlement.test.mjs',
    'tests/coop-escort-refund-manifest.test.mjs'
  )
  foreach ($file in $files) {
    if (-not (Test-Path -LiteralPath $file -PathType Leaf)) {
      throw "Missing committed Node test: $file"
    }
  }
  Write-Host '[COOP-049] Running actual local Node test suite (no Docker, no wallet writes).'
  & node --test @files
  if ($LASTEXITCODE -ne 0) { throw "Node tests failed (exit $LASTEXITCODE)" }
  if ($CheckPinned) {
    if (-not (Test-Path -LiteralPath $CodePath -PathType Container)) {
      throw "Pinned EveJS Code checkout not found: $CodePath"
    }
    Write-Host '[COOP-049] Checking reversible pinned source overlay (read-only --dry-run).'
    & node 'scripts/patch-evejs-coop.cjs' --code-path $CodePath --dry-run
    if ($LASTEXITCODE -ne 0) { throw "Pinned overlay dry run failed (exit $LASTEXITCODE)" }
  }
  foreach ($scenario in @(
    'tests/scenarios/coop-048-native-paid-jobs.json',
    'tests/scenarios/coop-049-native-agent-opportunities.json'
  )) {
    $manifest = Get-Content -LiteralPath $scenario -Raw | ConvertFrom-Json
    if ($manifest.status -ne 'NOT_RUN') {
      throw "Scenario manifest has unexpected status (must be NOT_RUN until real client evidence): $scenario"
    }
    Write-Host ("[COOP-049] PENDING real client QA: {0} ({1} scenarios)" -f $scenario, @($manifest.scenarios).Count)
  }
  Write-Host '[COOP-049] Local source tests passed. REAL EVE CLIENT/SQLite/WALLET VALIDATION STILL PENDING.'
} finally {
  Pop-Location
}
