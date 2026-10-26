# LW-03 unified Living World 30s phase source gate (no live EveJS writes).
# This does NOT deploy, launch Docker, enable financial flags, or mark gameplay PASS.
[CmdletBinding()]
param([string]$ReportDir="")
$ErrorActionPreference="Stop"
$repo=(Resolve-Path (Join-Path $PSScriptRoot "..")).Path
if([string]::IsNullOrWhiteSpace($ReportDir)){
 $ReportDir=Join-Path ([System.IO.Path]::GetTempPath()) "evejs-lw03-phase-gate"
}
New-Item -ItemType Directory -Force -Path $ReportDir | Out-Null
$node=(Get-Command node -ErrorAction Stop).Source
$tests=@(
 "tests/coop-living-world-phase-coordinator.test.mjs",
 "tests/coop-alife-economy-wiring.test.mjs",
 "tests/coop-alife-native-buyer-wiring.test.mjs",
 "tests/coop-alife-native-resupply-wiring.test.mjs",
 "tests/coop-installer-module-coverage.test.mjs"
)
foreach($file in $tests){
 if(-not (Test-Path (Join-Path $repo $file))){throw "LW03_REQUIRED_TEST_MISSING:$file"}
}
$scenarioPath=Join-Path $repo "tests/scenarios/lw03-single-world-phase-e2e.json"
$manifest=Get-Content -Raw -Path $scenarioPath | ConvertFrom-Json
if($manifest.schema -ne "evejs-coop/lw03-unified-phase-gameplay/v1" -or
   $manifest.scenarios.Count -lt 8 -or
   @($manifest.scenarios | Where-Object {$_.status -ne "NOT_RUN"}).Count -ne 0){
 throw "LW03_NATIVE_GAMEPLAY_NOT_RUN_MANIFEST_REQUIRED"
}
$log=Join-Path $ReportDir "lw03-node-source-gates.log"
Push-Location $repo
try {& $node --test @tests *> $log; $exitCode=$LASTEXITCODE}
finally {Pop-Location}
Get-Content -Path $log | Select-Object -Last 60 | ForEach-Object {Write-Host $_}
if($exitCode -ne 0){throw "LW03_SOURCE_TEST_FAILURE:$log"}
Write-Host "LW-03 Node source gates PASS. Original SQLite/Rust/two-client gameplay remain NOT_RUN."
Write-Host "Protected evejs-data, Docker, native wallets and cargo were not touched."
