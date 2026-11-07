#Requires -Version 5.1
# PF91: local-only real per-character stock writer contract evidence.
# No source modifications, no CI, no Docker, no PLAY and no feature activation.
[CmdletBinding()]
param([string]$NativeCheckout = '')
$ErrorActionPreference = 'Stop'
$root = Split-Path -Parent $MyInvocation.MyCommand.Path
$repo = (Resolve-Path -LiteralPath (Join-Path $root '../..')).Path
$node = (Get-Command node -ErrorAction Stop).Source
$python = (Get-Command python -ErrorAction Stop).Source
$tests = @(
  (Join-Path $repo 'scripts/pf58/tests/pf87-atomic-handoff.test.cjs'),
  (Join-Path $repo 'scripts/pf58/tests/pf91-original-character-rows.test.cjs'),
  (Join-Path $root 'tests/pf91-original-character-owner-source.test.cjs')
)
foreach ($test in $tests) {
  if (-not (Test-Path -LiteralPath $test -PathType Leaf)) {
    throw 'PF91_REQUIRED_CHARACTER_RACE_TEST_MISSING'
  }
}
$priorNative = [Environment]::GetEnvironmentVariable('PF91_NATIVE_WORKTREE','Process')
try {
  if ($NativeCheckout) {
    $env:PF91_NATIVE_WORKTREE = (Resolve-Path -LiteralPath $NativeCheckout -ErrorAction Stop).Path
  } else {
    [Environment]::SetEnvironmentVariable('PF91_NATIVE_WORKTREE','', 'Process')
  }
  & $node --test --test-concurrency=1 @tests
  if ($LASTEXITCODE -ne 0) { throw 'PF91_ORIGINAL_CHARACTER_RACE_NODE_TEST_FAILED' }
  & $python -m unittest discover -s (Join-Path $repo 'scripts/pf58/tests') -p 'test_pf91_*.py' -v
  if ($LASTEXITCODE -ne 0) { throw 'PF91_ORIGINAL_CHARACTER_STATIC_GATE_FAILED' }
  & $python -m unittest discover -s (Join-Path $root 'tests') -p 'test_pf91_*.py' -v
  if ($LASTEXITCODE -ne 0) { throw 'PF91_ARCHIVE_INTEGRITY_FAILED' }
  if (-not $NativeCheckout) {
    Write-Warning 'PF91 original EveJS owner checkout was not supplied; four native source tests were skipped.'
  } else {
    Write-Warning 'PF91 tested ORIGINAL stock owner source, but native gameplay hooks are NOT INSTALLED.'
  }
} finally {
  [Environment]::SetEnvironmentVariable('PF91_NATIVE_WORKTREE',$priorNative,'Process')
}
Write-Host 'PF91 local candidate suite complete. Original WORK gameplay NOT RUN; Personal Fleet OFF.'
