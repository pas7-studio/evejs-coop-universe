#Requires -Version 5.1
# PF99: original registered live session, PF91/PF92 SQLite and source-pin WORK gates.
# Never installs original source, turns Personal Fleet on, or touches PLAY.
[CmdletBinding()]
param([string]$NativeCheckout='')
Set-StrictMode -Version Latest
$ErrorActionPreference='Stop'
$root=(Resolve-Path -LiteralPath $PSScriptRoot).Path
$node=(Get-Command node -ErrorAction Stop).Source
$python=(Get-Command python -ErrorAction Stop).Source
$tests=@(
 (Join-Path $root 'tests/pf99-authenticated-original-session.test.cjs'),
 (Join-Path $root 'tests/pf99-source-bound-pf91-pf92-sqlite.test.cjs')
)
$required=@(
 $tests[0],$tests[1],
 (Join-Path $root 'native/coopPersonalFleetOriginalSessionWitness.js'),
 (Join-Path $root 'native/coopPersonalFleetOriginalSessionBindings.js'),
 (Join-Path $root 'tests/test_pf99_archive_integrity.py'),
 (Join-Path $root 'SHA256SUMS.txt')
)
foreach ($file in $required) {
 if (-not (Test-Path -LiteralPath $file -PathType Leaf)) {
  throw 'PF99_NATIVE_SESSION_WITNESS_REQUIRED_SOURCE_MISSING'
 }
}
$previous=[Environment]::GetEnvironmentVariable('PF99_NATIVE_WORKTREE','Process')
try {
 if ($NativeCheckout) {
  $native=(Resolve-Path -LiteralPath $NativeCheckout -ErrorAction Stop).Path
  $env:PF99_NATIVE_WORKTREE=$native
 } else {
  [Environment]::SetEnvironmentVariable('PF99_NATIVE_WORKTREE',$null,'Process')
  Write-Warning 'PF99 ORIGINAL source pin check is skipped without -NativeCheckout.'
 }
 & $node --test --test-concurrency=1 @tests
 if ($LASTEXITCODE -ne 0) { throw 'PF99_SOURCE_BOUND_AUTHENTICATED_SESSION_TEST_FAILED' }
 & $python -m unittest discover -s (Join-Path $root 'tests') -p 'test_pf99_*.py' -v
 if ($LASTEXITCODE -ne 0) { throw 'PF99_NATIVE_SESSION_SOURCE_ARCHIVE_FAILED' }
} finally {
 [Environment]::SetEnvironmentVariable('PF99_NATIVE_WORKTREE',$previous,'Process')
}
Write-Host 'PF99 review only: no original fork installation or PLAY changes; feature OFF.'
