# LW-04C2 source-only original production stage gate.
# No running EveJS/Docker/production database access.
[CmdletBinding()]
param([string]$ReportDir="")
$ErrorActionPreference="Stop"
$repo=(Resolve-Path (Join-Path $PSScriptRoot "..")).Path
if([string]::IsNullOrWhiteSpace($ReportDir)){
 $ReportDir=Join-Path ([System.IO.Path]::GetTempPath()) "evejs-lw04c2-source"
}
New-Item -ItemType Directory -Force -Path $ReportDir | Out-Null
$node=(Get-Command node -ErrorAction Stop).Source
$tests=@(
 "tests/coop-npc-industry-original-stage-executor.test.mjs",
 "tests/coop-npc-industry-original-game-store-kernel.test.mjs",
 "tests/coop-npc-industry-recovery-fence.test.mjs",
 "tests/coop-npc-live-factory-readiness.test.mjs",
 "tests/coop-native-industry-overlay-graph.test.mjs"
)
$manifest=Get-Content -Raw (Join-Path $repo "tests/scenarios/lw04c2-original-manufacturing-stage-e2e.json") | ConvertFrom-Json
if($manifest.schema -ne "evejs-coop/lw04c2-original-manufacturing-stage/v1" -or
   $manifest.scenarios.Count -lt 10 -or
   @($manifest.scenarios|Where-Object{$_.status -ne "NOT_RUN"}).Count -ne 0){
 throw "LW04C2_REAL_GAMEPLAY_NOT_RUN_GATE_INVALID"
}
foreach($file in $tests){if(-not (Test-Path (Join-Path $repo $file))){throw "LW04C2_TEST_MISSING:$file"}}
$log=Join-Path $ReportDir "lw04c2-original-stage-source-tests.log"
Push-Location $repo
try{& $node --test @tests *> $log;$code=$LASTEXITCODE}
finally{Pop-Location}
Get-Content $log | Select-Object -Last 70 | ForEach-Object{Write-Host $_}
if($code -ne 0){throw "LW04C2_NODE_SOURCE_GATE_FAILED:$log"}
Write-Host "LW04C2 SOURCE TESTS PASS. Live SQLite, Rust and two-client original gameplay: NOT_RUN."
