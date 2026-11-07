#Requires -Version 5.1
# PF97 original CharacterState + ItemStore source-pinned native WORK tests.
# Read-only original fork, temp-only diff applications. PLAY untouched.
[CmdletBinding()]
param([Parameter(Mandatory = $true)][string]$NativeCheckout)
Set-StrictMode -Version Latest
$ErrorActionPreference='Stop'
$root = (Resolve-Path -LiteralPath $PSScriptRoot).Path
$native = (Resolve-Path -LiteralPath $NativeCheckout -ErrorAction Stop).Path
$node = (Get-Command node -ErrorAction Stop).Source
$python = (Get-Command python -ErrorAction Stop).Source
$tests=@(
 (Join-Path $root 'tests/pf97-character-writer-source.test.cjs'),
 (Join-Path $root 'tests/pf97-itemstore-source.test.cjs')
)
$needed=@(
 @($tests),
 (Join-Path $root 'review/characterState.pf97.review-only.patch'),
 (Join-Path $root 'review/itemStore.pf97.review-only.patch'),
 (Join-Path $root 'SHA256SUMS.txt'),
 (Join-Path $root 'tests/test_pf97_archive_integrity.py')
)
foreach ($file in $needed) {
 if (-not (Test-Path -LiteralPath $file -PathType Leaf)) {
  throw 'PF97_SOURCE_PINNED_REVIEW_TEST_FILE_MISSING'
 }
}
$prior = [Environment]::GetEnvironmentVariable('PF97_NATIVE_WORKTREE','Process')
try {
 $env:PF97_NATIVE_WORKTREE=$native
 & $node --test --test-concurrency=1 @tests
 if ($LASTEXITCODE -ne 0) { throw 'PF97_ORIGINAL_CHARACTER_ITEMSTORE_SOURCE_TEST_FAILED' }
 & $python -m unittest discover -s (Join-Path $root 'tests') -p 'test_pf97_*.py' -v
 if ($LASTEXITCODE -ne 0) { throw 'PF97_SOURCE_ARCHIVE_INTEGRITY_FAILED' }
} finally {
 [Environment]::SetEnvironmentVariable('PF97_NATIVE_WORKTREE',$prior,'Process')
}
Write-Host 'PF97 original source review tests complete; no native installation; Personal Fleet OFF.'
