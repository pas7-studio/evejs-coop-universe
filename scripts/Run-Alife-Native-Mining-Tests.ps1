# ALIFE-04 native stock mining proof, source-only gate. Does NOT boot Docker,
# run clients, change persistent volumes or alter native ore/items/ISK.
[CmdletBinding()]
param([string]$ReportDir="")
$ErrorActionPreference="Stop"
$root=(Resolve-Path (Join-Path $PSScriptRoot "..")).Path
if([string]::IsNullOrWhiteSpace($ReportDir)){
 $ReportDir=Join-Path ([System.IO.Path]::GetTempPath()) "evejs-alife-mining-gates"
}
New-Item -ItemType Directory -Force -Path $ReportDir | Out-Null
$manifestPath=Join-Path $root "tests/scenarios/alife-native-mining-physical-e2e.json"
if(-not (Test-Path $manifestPath)){throw "Missing native mining acceptance manifest"}
$manifest=Get-Content -Raw -Path $manifestPath | ConvertFrom-Json
if($manifest.schema -ne "evejs-coop/alife-native-mining-physical-proof/v1" -or
 $manifest.scenarios.Count -ne 6 -or
 @($manifest.scenarios | Where-Object { $_.status -ne "NOT_RUN" }).Count -gt 0){
 throw "Never count physical two-client mining E2E as PASS without execution"
}
$files=@(
 "tests/coop-alife-native-mining-witness.test.mjs",
 "tests/coop-alife-native-mining-gate.test.mjs",
 "tests/coop-alife-native-mining-wiring.test.mjs",
 "tests/coop-native-mining-readiness.test.mjs",
 "tests/coop-mining-startup-world-report.test.mjs",
 "tests/coop-native-hauler-persistence.test.mjs",
 "tests/coop-native-haul-manifest.test.mjs"
)
foreach($file in $files){
 if(-not (Test-Path (Join-Path $root $file))){throw "Missing required test $file"}
}
$node=(Get-Command node -ErrorAction Stop).Source
$log=Join-Path $ReportDir "alife-native-mining-node-tests.log"
Push-Location $root
try { & $node --test @files *> $log; $exitCode=$LASTEXITCODE }
finally { Pop-Location }
Get-Content -Path $log | Select-Object -Last 40 | ForEach-Object { Write-Host $_ }
if($exitCode -ne 0){throw "Native mining tests failed (exit $exitCode): $log"}
Write-Host "PASS: native mining code tests; six real physical E2E scenarios remain NOT_RUN"
Write-Host "Copied log: node scripts/coop-world-report.cjs --system-id 30000144 --require-mining-yield < coop-events.jsonl"
Write-Host "No Docker, game volume, ammo, ores, wallet or native movement changed."
