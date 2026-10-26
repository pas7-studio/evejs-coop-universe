# ALIFE-12 original native mining → station restart regression gate.
# Never starts Docker, creates live NPCs or modifies protected evejs-data.
[CmdletBinding()]
param([string]$UpstreamCodeRoot="",[string]$ReportDir="")
$ErrorActionPreference="Stop"
$repo=(Resolve-Path (Join-Path $PSScriptRoot "..")).Path
if([string]::IsNullOrWhiteSpace($ReportDir)){
 $ReportDir=Join-Path ([System.IO.Path]::GetTempPath()) "evejs-alife12-station-restart"
}
New-Item -ItemType Directory -Force -Path $ReportDir | Out-Null
$node=(Get-Command node -ErrorAction Stop).Source
$files=@(
 "tests/coop-alife12-station-trip-journal.test.mjs",
 "tests/coop-alife12-station-trip-recovery.test.mjs",
 "tests/coop-alife13-startup-cargo-audit.test.mjs",
 "tests/coop-native-mining-fleet-durable.test.mjs",
 "tests/coop-native-haul-transfer-atomic.test.mjs",
 "tests/coop-native-haul-transfer-sqlite.test.mjs",
 "tests/coop-native-haul-atomic-routing.test.mjs",
 "tests/coop-native-station-arrival.test.mjs",
 "tests/coop-native-haul-manifest.test.mjs",
 "tests/coop-native-haul-manifest-station.test.mjs",
 "tests/coop-native-warehouse.test.mjs",
 "tests/coop-gamestore-atomic.test.mjs"
)
if(Test-Path (Join-Path $repo "tests/coop-native-cargo-transient-isolation.test.mjs")){
 $files+=("tests/coop-native-cargo-transient-isolation.test.mjs")
}
foreach($file in $files){
 if(-not (Test-Path (Join-Path $repo $file))){throw "ALIFE12_REQUIRED_TEST_MISSING: $file"}
}
$manifest=Get-Content -Raw -Path (Join-Path $repo "tests/scenarios/alife12-original-station-route-restart-e2e.json") | ConvertFrom-Json
if($manifest.schema -ne "evejs-coop/alife12-original-physical-route-restart/v1" -or
   $manifest.scenarios.Count -ne 12 -or
   @($manifest.scenarios | Where-Object {$_.status -ne "NOT_RUN"}).Count -ne 0){
 throw "ALIFE12_REAL_GAMEPLAY_NOT_RUN_GATE_REQUIRED"
}
$log=Join-Path $ReportDir "alife12-native-restart-node.log"
Push-Location $repo
try { & $node --test @files *> $log; $code=$LASTEXITCODE }
finally { Pop-Location }
Get-Content $log | Select-Object -Last 55 | ForEach-Object {Write-Host $_}
if($code -ne 0){throw "ALIFE12_NODE_TEST_FAILED: $log"}
if(-not [string]::IsNullOrWhiteSpace($UpstreamCodeRoot)){
 & $node (Join-Path $repo "scripts/verify-alife09-mining-overlay.cjs") $UpstreamCodeRoot
 if($LASTEXITCODE -ne 0){throw "ALIFE12_PINNED_NATIVE_UPSTREAM_CHANGED"}
}else{Write-Warning "Original pristine pinned source not inspected; supply -UpstreamCodeRoot"}
Write-Host "ALIFE-12 isolated Node/SQLite regression suite PASS; 12 physical/two-client E2E NOT_RUN."
Write-Host "Docker/containers and protected evejs-data were not touched."
