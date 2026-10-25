# LW-04B source-only manufacturing admission gate.
# Must never mutate Docker, local active GameStore, Rust market or evejs-data.
[CmdletBinding()]
param([string]$ReportDir="")
$ErrorActionPreference="Stop"
$repo=(Resolve-Path (Join-Path $PSScriptRoot "..")).Path
if([string]::IsNullOrWhiteSpace($ReportDir)){
 $ReportDir=Join-Path ([System.IO.Path]::GetTempPath()) "evejs-lw04b-gates"
}
New-Item -ItemType Directory -Force -Path $ReportDir | Out-Null
$node=(Get-Command node -ErrorAction Stop).Source
$tests=@(
 "tests/coop-alife-native-manufacturing-runtime.test.mjs",
 "tests/coop-alife-native-act.test.mjs",
 "tests/coop-native-industry-overlay-graph.test.mjs",
 "tests/coop-npc-native-economy-director.test.mjs",
 "tests/coop-native-economy-overlay-resolution.test.mjs",
)
foreach($file in $tests){
 if(-not (Test-Path (Join-Path $repo $file))){throw "LW04B_TEST_MISSING:$file"}
}
$manifest=Get-Content -Raw (Join-Path $repo "tests/scenarios/lw04-native-manufacturing-e2e.json") | ConvertFrom-Json
if($manifest.schema -ne "evejs-coop/lw04-native-manufacturing-source-to-act/v1" -or
 $manifest.scenarios.Count -lt 12 -or
 @($manifest.scenarios | Where-Object {$_.status -ne "NOT_RUN"}).Count -ne 0){
 throw "LW04B_GAMEPLAY_NOT_RUN_GATE_MISSING"
}
$log=Join-Path $ReportDir "lw04b-source-tests.log"
Push-Location $repo
try{& $node --test @tests *> $log; $exitCode=$LASTEXITCODE}
finally{Pop-Location}
Get-Content $log | Select-Object -Last 65 | ForEach-Object {Write-Host $_}
if($exitCode -ne 0){throw "LW04B_SOURCE_GATE_FAILED:$log"}
Write-Host "LW04B SOURCE TESTS PASS. Real live factory, original SQLite, Rust, two clients are NOT_RUN."
