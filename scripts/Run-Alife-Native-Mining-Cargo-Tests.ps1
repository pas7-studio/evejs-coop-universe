# ALIFE-05 native ore cargo integrity. Read-only Node tests and optional source
# verification. Does NOT boot Docker or touch the preserved evejs-data volume.
[CmdletBinding()]
param(
 [string]$UpstreamCodeRoot="",
 [string]$ReportDir=""
)
$ErrorActionPreference="Stop"
$root=(Resolve-Path (Join-Path $PSScriptRoot "..")).Path
if([string]::IsNullOrWhiteSpace($ReportDir)){
 $ReportDir=Join-Path ([System.IO.Path]::GetTempPath()) "evejs-alife-native-mining-cargo"
}
New-Item -ItemType Directory -Force -Path $ReportDir | Out-Null
$manifestPath=Join-Path $root "tests/scenarios/native-mining-cargo-integrity-e2e.json"
if(-not (Test-Path $manifestPath)){throw "Missing native cargo acceptance manifest"}
$m=Get-Content -Raw -Path $manifestPath | ConvertFrom-Json
if($m.schema -ne "evejs-coop/native-mining-cargo-integrity-e2e/v1" -or
 $m.scenarios.Count -ne 8 -or
 @($m.scenarios | Where-Object {$_.status -ne "NOT_RUN"}).Count -gt 0){
 throw "Native storage fault tests and client acceptance cannot pass without live local evidence"
}
$tests=@(
 "tests/coop-native-mining-cargo-integrity.test.mjs",
 "tests/coop-native-mining-cargo-wiring.test.mjs",
 "tests/coop-mining-startup-retry.test.mjs",
 "tests/coop-native-mining-readiness.test.mjs",
 "tests/coop-native-haul-manifest.test.mjs",
 "tests/coop-native-haul-manifest-overlay.test.mjs"
)
foreach($item in $tests){
 if(-not (Test-Path (Join-Path $root $item))){throw "Missing native mining test: $item"}
}
$node=(Get-Command node -ErrorAction Stop).Source
$log=Join-Path $ReportDir "native-mining-cargo-tests.log"
Push-Location $root
try{ & $node --test @tests *> $log; $status=$LASTEXITCODE }
finally{ Pop-Location }
Get-Content -Path $log | Select-Object -Last 35 | ForEach-Object {Write-Host $_}
if($status -ne 0){throw "Native ore tests failed (exit $status): $log"}
if(-not [string]::IsNullOrWhiteSpace($UpstreamCodeRoot)){
 Push-Location $root
 try{
  & $node "scripts/verify-alife-mining-cargo-source.cjs" $UpstreamCodeRoot
  if($LASTEXITCODE -ne 0){throw "Pinned mining source differs; do not enable strict flag"}
 }finally{Pop-Location}
}else{Write-Host "PINNED SOURCE NOT CHECKED: pass -UpstreamCodeRoot to verify original upstream bytes."}
Write-Host "PASS: Node source tests. Eight physical local E2E scenarios remain NOT_RUN."
Write-Host "Default OFF: EVEJS_COOP_NATIVE_MINING_CARGO_INTEGRITY"
Write-Host "No live game, Docker or evejs-data modifications were made by this runner."
