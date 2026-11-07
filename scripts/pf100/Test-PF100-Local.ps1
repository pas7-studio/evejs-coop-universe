#Requires -Version 5.1
# PF100 REVIEW ONLY; no native installation, main/PLAY edits, Docker or server start.
[CmdletBinding()]
param([string]$NativeCheckout='')
Set-StrictMode -Version Latest
$ErrorActionPreference='Stop'
$root=(Resolve-Path -LiteralPath $PSScriptRoot).Path
$node=(Get-Command node -ErrorAction Stop).Source
$major=[int](& $node -p "process.versions.node.split('.')[0]")
if ($LASTEXITCODE -ne 0 -or $major -lt 22) { throw 'PF100_NODE_22_REQUIRED' }
$files=@(
 'native/coopPersonalFleetOriginalPostCommitProof.js',
 'tests/pf100-original-postcommit-proof.test.cjs',
 'tests/pf100-original-source-pins.test.cjs'
)
$manifest=Join-Path $root 'SHA256SUMS.txt'
if (-not (Test-Path -LiteralPath $manifest -PathType Leaf)) { throw 'PF100_MANIFEST_MISSING' }
$actualLines=@()
foreach($name in $files){
 $absolute=Join-Path $root $name
 if (-not (Test-Path -LiteralPath $absolute -PathType Leaf)) { throw ('PF100_MISSING_FILE: '+$name) }
 $digest=(Get-FileHash -LiteralPath $absolute -Algorithm SHA256).Hash.ToLowerInvariant()
 $actualLines+=($digest+'  '+$name)
}
$expectedLines=@(Get-Content -LiteralPath $manifest | Where-Object { $_.Trim() -ne '' })
if (($actualLines -join "`n") -cne ($expectedLines -join "`n")) { throw 'PF100_MANIFEST_DRIFT' }
$before=[Environment]::GetEnvironmentVariable('PF100_NATIVE_WORKTREE','Process')
try {
 if($NativeCheckout){
  $env:PF100_NATIVE_WORKTREE=(Resolve-Path -LiteralPath $NativeCheckout -ErrorAction Stop).Path
 }else{
  [Environment]::SetEnvironmentVariable('PF100_NATIVE_WORKTREE',$null,'Process')
  Write-Warning 'PF100 source-pinned native tests will SKIP without -NativeCheckout.'
 }
 & $node --test --test-concurrency=1 (Join-Path $root $files[1]) (Join-Path $root $files[2])
 if($LASTEXITCODE -ne 0){throw 'PF100_NATIVE_POSTCOMMIT_TEST_FAILED'}
}finally{
 [Environment]::SetEnvironmentVariable('PF100_NATIVE_WORKTREE',$before,'Process')
}
Write-Host 'PF100 review checks complete. Original EveJS unchanged; Personal Fleet OFF.'
