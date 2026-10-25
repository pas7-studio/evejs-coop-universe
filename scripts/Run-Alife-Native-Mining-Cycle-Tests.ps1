# ALIFE-06 source/cargo conservation checks. Does not start game or Docker.
[CmdletBinding()]
param([string]$UpstreamCodeRoot="",[string]$ReportDir="")
$ErrorActionPreference="Stop"
$root=(Resolve-Path (Join-Path $PSScriptRoot "..")).Path
if([string]::IsNullOrWhiteSpace($ReportDir)){
 $ReportDir=Join-Path ([System.IO.Path]::GetTempPath()) "evejs-alife06-conservation"
}
New-Item -ItemType Directory -Force -Path $ReportDir | Out-Null
$node=(Get-Command node -ErrorAction Stop).Source
$manifest=Join-Path $root "tests/scenarios/native-mining-cycle-conservation-e2e.json"
$m=Get-Content -Raw $manifest | ConvertFrom-Json
if($m.schema -ne "evejs-coop/native-mining-cycle-conservation-e2e/v1" -or
 $m.scenarios.Count -ne 8 -or
 @($m.scenarios | Where-Object {$_.status -ne "NOT_RUN"}).Count -gt 0){
 throw "Eight physical E2E checks must remain NOT_RUN until tested in disposable EveJS"
}
$tests=@("tests/coop-native-mining-cycle-conservation.test.mjs",
         "tests/coop-native-mining-cargo-integrity.test.mjs",
         "tests/coop-native-mining-cargo-wiring.test.mjs")
foreach($test in $tests) {
 if(-not (Test-Path (Join-Path $root $test))){throw "Missing test $test"}
}
$log=Join-Path $ReportDir "alife06-isolated-tests.log"
Push-Location $root
try {
 & $node --test @tests *> $log
 $status=$LASTEXITCODE
} finally {Pop-Location}
Get-Content -Path $log | Select-Object -Last 35 | ForEach-Object {Write-Host $_}
if($status -ne 0){throw "ALIFE06 isolated tests failed: $log"}
if(-not [string]::IsNullOrWhiteSpace($UpstreamCodeRoot)) {
 Push-Location $root
 try {
  & $node "scripts/verify-alife-mining-cargo-source.cjs" $UpstreamCodeRoot
  if($LASTEXITCODE -ne 0){throw "ALIFE05 original source mismatch"}
  & $node "scripts/verify-alife-native-mining-cycle-source.cjs" $UpstreamCodeRoot
  if($LASTEXITCODE -ne 0){throw "ALIFE06 original source mismatch"}
 } finally {Pop-Location}
} else {
 Write-Host "Original pinned EveJS sources NOT CHECKED: supply -UpstreamCodeRoot"
}
Write-Host "PASS: isolated Node checks only; 8 physical scenarios remain NOT_RUN."
Write-Host "OFF by default. Does not modify Docker, original Code or evejs-data."
