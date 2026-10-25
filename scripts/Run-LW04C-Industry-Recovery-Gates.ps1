# LW-04C source-only crash recovery and ACT admission gate.
# Runs Node unit/regression tests. Never opens the original game database.
[CmdletBinding()]
param([string]$ReportDir="")
$ErrorActionPreference="Stop"
$repo=(Resolve-Path (Join-Path $PSScriptRoot "..")).Path
if([string]::IsNullOrWhiteSpace($ReportDir)){
 $ReportDir=Join-Path ([System.IO.Path]::GetTempPath()) "evejs-lw04c-recovery"
}
New-Item -ItemType Directory -Force -Path $ReportDir | Out-Null
$node=(Get-Command node -ErrorAction Stop).Source
$tests=@(
 "tests/coop-npc-industry-recovery-fence.test.mjs",
 "tests/coop-npc-live-factory-readiness.test.mjs",
 "tests/coop-alife-native-act.test.mjs",
 "tests/coop-alife-native-manufacturing-runtime.test.mjs",
 "tests/coop-native-industry-overlay-graph.test.mjs",
 "tests/coop-npc-native-economy-director.test.mjs"
)
foreach($file in $tests){
 if(-not (Test-Path (Join-Path $repo $file))){throw "LW04C_REQUIRED_TEST_MISSING:$file"}
}
$manifest=Get-Content -Raw (Join-Path $repo "tests/scenarios/lw04c-industry-recovery-e2e.json") | ConvertFrom-Json
if($manifest.schema -ne "evejs-coop/lw04c-native-industry-recovery-gates/v1" -or
 $manifest.scenarios.Count -lt 10 -or
 @($manifest.scenarios | Where-Object {$_.status -ne "NOT_RUN"}).Count -ne 0){
 throw "LW04C_NATIVE_GAMEPLAY_RELEASE_GATE_INVALID"
}
$log=Join-Path $ReportDir "lw04c-node-tests.log"
Push-Location $repo
try {& $node --test @tests *> $log; $exitCode=$LASTEXITCODE}
finally {Pop-Location}
Get-Content $log | Select-Object -Last 75 | ForEach-Object {Write-Host $_}
if($exitCode -ne 0){throw "LW04C_NODE_SOURCE_GATE_FAILED:$log"}
Write-Host "LW04C Node source tests PASS; original Rust, SQLite and 2-client gameplay remain NOT_RUN."
Write-Host "No mutations to Docker, protected evejs-data, real item/ISK balances."
