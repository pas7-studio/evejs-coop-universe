# ALIFE-03 read-only native warehouse/manifest and delivery handoff test gate.
# This script never starts Docker or changes any game volume.
[CmdletBinding()]
param([string]$ReportDir="")
$ErrorActionPreference="Stop"
$root=(Resolve-Path (Join-Path $PSScriptRoot "..")).Path
if ([string]::IsNullOrWhiteSpace($ReportDir)) {
 $ReportDir=Join-Path ([System.IO.Path]::GetTempPath()) "evejs-alife-delivery-gates"
}
New-Item -ItemType Directory -Force -Path $ReportDir | Out-Null
$manifestPath=Join-Path $root "tests/scenarios/alife-native-delivery-e2e.json"
if (-not (Test-Path $manifestPath)) { throw "Missing ALIFE native delivery E2E manifest" }
$manifest=Get-Content -Raw -Path $manifestPath | ConvertFrom-Json
if ($manifest.schema -ne "evejs-coop/alife-native-delivery-e2e/v1" -or
    $manifest.scenarios.Count -ne 8 -or
    @($manifest.scenarios | Where-Object { $_.status -ne "NOT_RUN" }).Count -gt 0) {
 throw "Never accept native delivery E2E without executing the 8 manual scenarios"
}
$files=@(
 "tests/coop-alife-native-delivery-proof.test.mjs",
 "tests/coop-alife-native-delivery-wiring.test.mjs",
 "tests/coop-alife-news.test.mjs",
 "tests/coop-native-haul-manifest-station.test.mjs",
 "tests/coop-native-haul-manifest.test.mjs",
 "tests/coop-native-haul-manifest-overlay.test.mjs",
 "tests/coop-native-warehouse.test.mjs",
 "tests/coop-native-warehouse-patch.test.mjs",
 "tests/coop-native-hauler-persistence.test.mjs",
 "tests/coop-native-station-ore-settlement.test.mjs"
)
foreach($file in $files){
 if (-not (Test-Path (Join-Path $root $file))) { throw "Missing native safety test: $file" }
}
$node=(Get-Command node -ErrorAction Stop).Source
$log=Join-Path $ReportDir "native-delivery-tests.log"
Push-Location $root
try {
 & $node --test @files *> $log
 $code=$LASTEXITCODE
}finally{Pop-Location}
Get-Content $log | Select-Object -Last 40 | ForEach-Object { Write-Host $_ }
if($code -ne 0){throw "Native delivery test suite failed (exit $code): $log"}
Write-Host "PASS: source-level native warehouse tests; physical E2E NOT_RUN: $($manifest.scenarios.Count)"
Write-Host "Audit telemetry ONLY: node scripts/audit-alife-native-deliveries.cjs <copied-coop-events.jsonl>"
Write-Host "No Docker container, data volume, wallet or inventory was changed by this script."
