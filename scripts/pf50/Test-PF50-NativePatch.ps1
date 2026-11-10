#Requires -Version 5.1
# PF-50 read-only preflight. Never applies, builds or deploys native sources.
[CmdletBinding()]
param([string]$ForkRoot = 'C:\Games\EveCoop\upstream-evejs')
$ErrorActionPreference='Stop'
$root=(Resolve-Path -LiteralPath $ForkRoot).Path
$patch=Join-Path $PSScriptRoot 'patches\PF50-native-haul-writer.patch'
if(-not (Test-Path -LiteralPath $patch -PathType Leaf)){ throw 'PF50_PATCH_MISSING' }
$branch=(& git -C $root branch --show-current | Out-String).Trim()
if($LASTEXITCODE -ne 0 -or ($branch -ne 'coop/pas7std' -and $branch -notmatch '^work/personal-fleet-[a-z0-9-]+$')){
 throw "PF50_UNEXPECTED_NATIVE_BRANCH: $branch"
}
$haul='Code/server/src/space/coopNativeHaulTransferAtomic.js'
$isol='Code/server/src/space/coopNativeCargoTransientIsolation.js'
$mining='Code/server/src/space/coopPersonalFleetMiningTxnGuard.js'
$guard='Code/server/src/space/coopPersonalFleetHaulTxnGuard.js'
if(-not (Test-Path -LiteralPath (Join-Path $root $mining) -PathType Leaf)){
 throw 'PF50_REQUIRES_PF49_NATIVE_PATCH_FIRST'
}
if(Test-Path -LiteralPath (Join-Path $root $guard)){throw 'PF50_HAUL_GUARD_ALREADY_PRESENT'}
$actual=(& git -C $root hash-object $haul | Out-String).Trim()
if($LASTEXITCODE -ne 0 -or $actual -ne 'da3f31e6b87663483b324fc0676c913ac9815f88'){
 throw "PF50_HAUL_SOURCE_DRIFT: $actual"
}
$isoSource=[System.IO.File]::ReadAllText((Join-Path $root $isol))
if(-not $isoSource.Contains('const MINING_CYCLE_PF=Object.freeze({') -or
   -not $isoSource.Contains('const CONTRACTS=Object.freeze([HAUL_TRANSFER,MINING_CYCLE,MINING_CYCLE_PF,AMMO_BANK]);') -or
   -not $isoSource.Contains('error("PF49_OWNERSHIP_ROWS_READ_ONLY");')){
 throw 'PF50_PF49_ISOLATION_CONTRACT_MISSING_OR_DRIFTED'
}
& git -C $root apply --check --unidiff-zero $patch
if($LASTEXITCODE -ne 0){throw 'PF50_GIT_APPLY_CHECK_FAILED'}
Write-Host 'PF50_PATCH_PREFLIGHT_PASS — native files NOT modified'
Write-Host 'Apply ONLY to disposable WORK checkout after source review:'
Write-Host "git -C `"$root`" apply --unidiff-zero `"$patch`""
Write-Host 'PF44/PF46 callbacks are NOT wired; keep all new flags OFF.'