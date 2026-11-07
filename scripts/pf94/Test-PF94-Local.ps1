#Requires -Version 5.1
# PF94: original single-writer SQLite epoch *candidate* and source audit.
# Runs isolated tests; never patches, starts or restarts original EveJS/PLAY.
[CmdletBinding()]
param([string]$NativeCheckout = '')
$ErrorActionPreference = 'Stop'
$root = Split-Path -Parent $MyInvocation.MyCommand.Path
$repo = (Resolve-Path -LiteralPath (Join-Path $root '../..')).Path
$node = (Get-Command node -ErrorAction Stop).Source
$python = (Get-Command python -ErrorAction Stop).Source
$tests = @(
  (Join-Path $root 'tests/pf94-owner-epoch-sqlite.test.cjs'),
  (Join-Path $root 'tests/pf94-original-owner-source.test.cjs')
)
foreach ($test in $tests) {
  if (-not (Test-Path -LiteralPath $test -PathType Leaf)) {
    throw 'PF94_NATIVE_OWNER_TEST_SOURCE_MISSING'
  }
}
$old = [Environment]::GetEnvironmentVariable('PF94_NATIVE_WORKTREE', 'Process')
try {
  if ($NativeCheckout) {
    $env:PF94_NATIVE_WORKTREE = (Resolve-Path -LiteralPath $NativeCheckout -ErrorAction Stop).Path
  } else {
    [Environment]::SetEnvironmentVariable('PF94_NATIVE_WORKTREE', '', 'Process')
  }
  & $node --test --test-concurrency=1 @tests
  if ($LASTEXITCODE -ne 0) { throw 'PF94_NATIVE_SQLITE_OWNER_EPOCH_TEST_FAILED' }
  & $python -m unittest discover -s (Join-Path $root 'tests') -p 'test_pf94_*.py' -v
  if ($LASTEXITCODE -ne 0) { throw 'PF94_ARCHIVE_INTEGRITY_FAILED' }
  if (-not $NativeCheckout) {
    Write-Warning 'Original GameStore source-pin tests skipped without NativeCheckout.'
  } else {
    Write-Warning 'Original GameStore source is pinned but still lacks installed PF94 epoch hook.'
  }
} finally {
  [Environment]::SetEnvironmentVariable('PF94_NATIVE_WORKTREE', $old, 'Process')
}
Write-Host 'PF94 SQLite candidate PASS only; original WORK gameplay NOT RUN; feature OFF.'
