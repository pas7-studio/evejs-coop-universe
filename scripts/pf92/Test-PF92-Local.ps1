#Requires -Version 5.1
# PF92: read-only original source checks + candidate Node/SQLite fixture tests.
# No GitHub Actions, no PLAY, no original engine edits, feature stays OFF.
[CmdletBinding()]
param([string]$NativeCheckout = '')
$ErrorActionPreference = 'Stop'
$root = Split-Path -Parent $MyInvocation.MyCommand.Path
$repo = (Resolve-Path -LiteralPath (Join-Path $root '../..')).Path
$node = (Get-Command node -ErrorAction Stop).Source
$python = (Get-Command python -ErrorAction Stop).Source
$tests = @(
  (Join-Path $repo 'scripts/pf58/tests/pf92-character-record-barrier.test.cjs'),
  (Join-Path $repo 'scripts/pf58/tests/pf88-sourcebound-gating.test.cjs'),
  (Join-Path $root 'tests/pf92-original-stock-character-routes.test.cjs')
)
foreach ($test in $tests) {
  if (-not (Test-Path -LiteralPath $test -PathType Leaf)) {
    throw 'PF92_ORIGINAL_CHARACTER_OWNER_TEST_MISSING'
  }
}
$old = [Environment]::GetEnvironmentVariable('PF92_NATIVE_WORKTREE','Process')
try {
  if ($NativeCheckout) {
    $env:PF92_NATIVE_WORKTREE = (Resolve-Path -LiteralPath $NativeCheckout -ErrorAction Stop).Path
  } else {
    [Environment]::SetEnvironmentVariable('PF92_NATIVE_WORKTREE','','Process')
  }
  & $node --test --test-concurrency=1 @tests
  if ($LASTEXITCODE -ne 0) { throw 'PF92_ORIGINAL_CHARACTER_OWNER_NODE_GATE_FAILED' }
  & $python -m unittest discover -s (Join-Path $repo 'scripts/pf58/tests') -p 'test_pf92_*.py' -v
  if ($LASTEXITCODE -ne 0) { throw 'PF92_CHARACTER_OWNER_SOURCE_CONTRACT_FAILED' }
  & $python -m unittest discover -s (Join-Path $root 'tests') -p 'test_pf92_*.py' -v
  if ($LASTEXITCODE -ne 0) { throw 'PF92_ARCHIVE_INTEGRITY_FAILED' }
  if ($NativeCheckout) {
    Write-Warning 'PF92 original owner source proved by pins; original stock hooks still NOT INSTALLED.'
  } else {
    Write-Warning 'PF92 original owner source tests SKIPPED because no NativeCheckout supplied.'
  }
} finally {
  [Environment]::SetEnvironmentVariable('PF92_NATIVE_WORKTREE',$old,'Process')
}
Write-Host 'PF92 local candidate checks complete. Original WORK E2E NOT RUN, Personal Fleet OFF.'
