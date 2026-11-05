#Requires -Version 5.1
# PF-49 READ-ONLY preflight. Does not call git apply without --check.
[CmdletBinding()]
param([string]$ForkRoot = 'C:\Games\EveCoop\upstream-evejs')
$ErrorActionPreference='Stop'
$root=(Resolve-Path -LiteralPath $ForkRoot).Path
$patch=Join-Path $PSScriptRoot 'patches\PF49-native-mining-writer-transaction.patch'
if(-not (Test-Path -LiteralPath $patch -PathType Leaf)){throw 'PF49_PATCH_NOT_FOUND'}
$branch=(& git -C $root branch --show-current)
if($LASTEXITCODE -ne 0 -or ($branch | Out-String).Trim() -ne 'coop/pas7std') {
 throw "PF49_WRONG_NATIVE_BRANCH: $branch"
}
$paths=@(
 'Code/server/src/space/coopNativeMiningAtomic.js',
 'Code/server/src/space/coopNativeCargoTransientIsolation.js'
)
$sha=@(
 'c2b962d1e546c5ec8de8e9db1167a391d5344721',
 '5118edd6d3e4e6f549e98e0eee9144140b04c4fb'
)
$dirty=& git -C $root status --porcelain -- @paths
if($LASTEXITCODE -ne 0 -or $dirty){throw 'PF49_NATIVE_PREIMAGE_DIRTY'}
for($i=0;$i -lt $paths.Count;$i++){
 $actual=(& git -C $root hash-object $paths[$i] | Out-String).Trim()
 if($LASTEXITCODE -ne 0 -or $actual -ne $sha[$i]){
  throw "PF49_NATIVE_SOURCE_DRIFT: $($paths[$i]) expected=$($sha[$i]) actual=$actual"
 }
}
$addition='Code/server/src/space/coopPersonalFleetMiningTxnGuard.js'
if(Test-Path -LiteralPath (Join-Path $root $addition)){throw 'PF49_GUARD_ALREADY_EXISTS'}
& git -C $root apply --check --unidiff-zero $patch
if($LASTEXITCODE -ne 0){throw 'PF49_GIT_APPLY_CHECK_FAILED'}
Write-Host 'PF49_NATIVE_PATCH_PREFLIGHT_PASS (read-only; no source changed)'
Write-Host 'Manual, ONLY on disposable WORK checkout after review:'
Write-Host "  git -C `"$root`" apply --unidiff-zero `"$patch`""
Write-Host 'No native authority callbacks are wired; do not turn the feature flag ON.'