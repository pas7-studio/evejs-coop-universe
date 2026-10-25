# COOP-042 A-Life native economy unit+scenario preflight (no Docker actions).
# Usage: pwsh -File scripts/Run-Alife-Economy-Tests.ps1
[CmdletBinding()]
param(
  [string]$ReportDir = "",
  [switch]$IncludeExistingEconomyTests
)
$ErrorActionPreference = "Stop"
$root = (Resolve-Path (Join-Path $PSScriptRoot "..")).Path
if ([string]::IsNullOrWhiteSpace($ReportDir)) {
  $ReportDir = Join-Path ([System.IO.Path]::GetTempPath()) "evejs-alife-economy-gates"
}
New-Item -ItemType Directory -Force -Path $ReportDir | Out-Null
$manifestPath = Join-Path $root "tests/scenarios/alife-native-economy-e2e.json"
if (-not (Test-Path $manifestPath)) { throw "Missing 22-scenario ALIFE acceptance manifest" }
$manifest = Get-Content -Raw -Path $manifestPath | ConvertFrom-Json
if ($manifest.schema -ne "coop-alife-economy-acceptance/v1" -or $manifest.scenarios.Count -lt 20) {
  throw "Invalid ALIFE native economy test manifest"
}
$nonPending = @($manifest.scenarios | Where-Object { $_.status -ne "NOT_RUN" })
if ($nonPending.Count -gt 0) {
  throw "Do not mark local E2E scenarios PASS before actually running them"
}
$integrityManifest = Join-Path $root "tests/scenarios/coop-044-industry-replenishment-integrity.json"
if (-not (Test-Path $integrityManifest)) { throw "Missing native industry replenishment integrity scenarios" }
$integrity = Get-Content -Raw -Path $integrityManifest | ConvertFrom-Json
if ($integrity.schema -ne "coop-044-native-industry-replenishment-integrity/v1" -or $integrity.scenarios.Count -lt 10) {
  throw "Native industry integrity acceptance manifest invalid"
}
if (@($integrity.scenarios | Where-Object { $_.status -ne "NOT_RUN" }).Count -gt 0) {
  throw "Do not mark native industry acceptance scenarios PASS before real gameplay validation"
}
$files = @(
  "tests/coop-alife-native-economy.test.mjs",
  "tests/coop-alife-economy-sensor.test.mjs",
  "tests/coop-alife-economy-wiring.test.mjs",
  "tests/coop-npc-manufacturing.test.mjs",
  "tests/coop-npc-native-economy-director.test.mjs"
)
if ($IncludeExistingEconomyTests) {
  $files += @(
    "tests/coop-npc-native-bindings.test.mjs",
    "tests/coop-npc-economy-scheduler.test.mjs"
  )
}
foreach ($f in $files) {
  if (-not (Test-Path (Join-Path $root $f))) { throw "Missing required test: $f" }
}
$node = Get-Command node -ErrorAction Stop
$log = Join-Path $ReportDir "alife-economy-node-tests.txt"
Push-Location $root
try {
  & $node.Source --test @files *> $log
  $code = $LASTEXITCODE
} finally { Pop-Location }
Get-Content -Path $log | Select-Object -Last 40 | ForEach-Object { Write-Host $_ }
if ($code -ne 0) { throw "A-Life economy tests failed (exit $code): $log" }
Write-Host ("PASS: local unit and contract checks. E2E scenarios remaining NOT_RUN: " + ($manifest.scenarios.Count + $integrity.scenarios.Count))
Write-Host ("Evidence checklist: " + $manifestPath)
Write-Host ("Test report: " + $log)
Write-Host "No game server, market database, Docker volume, or evejs-data was modified."
