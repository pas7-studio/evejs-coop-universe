#Requires -Version 5.1
# PF93 manual source-pinned native SQLite witness isolation tests.
# Read-only original EveJS checkout; never runs/patches/restarts PLAY.
[CmdletBinding()]
param([string]$NativeCheckout = '')
$ErrorActionPreference = 'Stop'
$root = Split-Path -Parent $MyInvocation.MyCommand.Path
$repo = (Resolve-Path -LiteralPath (Join-Path $root '../..')).Path
$node = (Get-Command node -ErrorAction Stop).Source
$python = (Get-Command python -ErrorAction Stop).Source
$tests = @(
 (Join-Path $repo 'scripts/pf58/tests/pf93-native-session-tx-isolation.test.cjs'),
 (Join-Path $repo 'scripts/pf58/tests/pf92-character-record-barrier.test.cjs'),
 (Join-Path $repo 'scripts/pf58/tests/pf91-original-character-rows.test.cjs'),
 (Join-Path $root 'tests/pf93-original-sqlite-writer-source.test.cjs')
)
foreach ($test in $tests) {
 if (-not (Test-Path -LiteralPath $test -PathType Leaf)) {
  throw 'PF93_SESSION_WITNESS_TEST_SOURCE_MISSING'
 }
}
$previousRoot = [Environment]::GetEnvironmentVariable('PF93_NATIVE_WORKTREE','Process')
try {
 if ($NativeCheckout) {
  $env:PF93_NATIVE_WORKTREE = (Resolve-Path -LiteralPath $NativeCheckout -ErrorAction Stop).Path
 } else {
  [Environment]::SetEnvironmentVariable('PF93_NATIVE_WORKTREE','','Process')
 }
 & $node --test --test-concurrency=1 @tests
 if ($LASTEXITCODE -ne 0) { throw 'PF93_SESSION_WITNESS_NODE_GATE_FAILED' }
 & $python -m unittest discover -s (Join-Path $repo 'scripts/pf58/tests') -p 'test_pf93_*.py' -v
 if ($LASTEXITCODE -ne 0) { throw 'PF93_SESSION_WITNESS_STATIC_GATE_FAILED' }
 & $python -m unittest discover -s (Join-Path $root 'tests') -p 'test_pf93_*.py' -v
 if ($LASTEXITCODE -ne 0) { throw 'PF93_SOURCE_ARCHIVE_INTEGRITY_FAILED' }
 if (-not $NativeCheckout) {
  Write-Warning 'PF93 original native GameStore source test skipped (no NativeCheckout).'
 }
} finally {
 [Environment]::SetEnvironmentVariable('PF93_NATIVE_WORKTREE',$previousRoot,'Process')
}
Write-Host 'PF93 candidate local checks complete. Personal Fleet OFF; no original WORK E2E.'
