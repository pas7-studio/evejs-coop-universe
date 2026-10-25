# Read-only ALIFE-09 full native mining -> station overlay gate.
[CmdletBinding()]
param([string]$UpstreamCodeRoot="",[string]$ReportDir="")
$ErrorActionPreference="Stop"
$repo=(Resolve-Path (Join-Path $PSScriptRoot "..")).Path
if([string]::IsNullOrWhiteSpace($ReportDir)){
 $ReportDir=Join-Path ([System.IO.Path]::GetTempPath()) "evejs-alife09-station-gate"
}
New-Item -ItemType Directory -Force -Path $ReportDir | Out-Null
$node=(Get-Command node -ErrorAction Stop).Source
$tests=@(
 "tests/coop-alife09-station-fleet-restart-compat.test.mjs",
 "tests/coop-native-mining-fleet-durable.test.mjs",
 "tests/coop-native-mining-fleet-durable-overlay.test.mjs",
 "tests/coop-native-station-arrival-patch.test.mjs",
 "tests/coop-native-station-arrival.test.mjs",
 "tests/coop-native-mining-atomic.test.mjs",
 "tests/coop-native-mining-atomic-overlay.test.mjs"
)
foreach($test in $tests){
 if(-not(Test-Path (Join-Path $repo $test))){throw "Missing ALIFE-09 required test file: $test"}
}
$manifest=Get-Content -Raw -Path (Join-Path $repo "tests/scenarios/native-mining-station-restart-alife09-e2e.json") | ConvertFrom-Json
if($manifest.schema -ne "evejs-coop/alife09-native-station-restart/v1" -or
   $manifest.scenarios.Count -ne 6 -or
   @($manifest.scenarios | Where-Object {$_.status -ne "NOT_RUN"}).Count -ne 0){
 throw "ALIFE09 physical E2E manifest must remain honestly NOT_RUN without actual evidence"
}
$log=Join-Path $ReportDir "alife09-native-node.log"
Push-Location $repo
try{& $node --test @tests *> $log; $code=$LASTEXITCODE}
finally{Pop-Location}
Get-Content -Path $log | Select-Object -Last 55 | ForEach-Object {Write-Host $_}
if($code -ne 0){throw "ALIFE09 isolated tests failed. See $log"}
if(-not [string]::IsNullOrWhiteSpace($UpstreamCodeRoot)){
 & $node (Join-Path $repo "scripts/verify-alife09-mining-overlay.cjs") $UpstreamCodeRoot
 if($LASTEXITCODE -ne 0){throw "ALIFE09 pinned original mining installer preflight FAILED"}
}else{
 Write-Warning "ALIFE09 pinned upstream full roundtrip NOT VERIFIED (provide -UpstreamCodeRoot)"
}
Write-Host "ALIFE09 isolated tests PASS; six physical two-client E2E scenarios NOT_RUN."
Write-Host "No Docker or protected evejs-data changes. New feature flags default OFF."
