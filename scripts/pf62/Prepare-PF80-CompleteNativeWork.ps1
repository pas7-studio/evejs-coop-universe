#Requires -Version 5.1
<# PF80: one entrypoint for BOTH PF62 and PF55 exact native source patches.
   Explicit WORK-only opt-in; never writes to original EveJS tracked sources,
   never starts a server, turns flags on, merges, pushes or deploys to PLAY.
#>
[CmdletBinding()]
param(
  [Parameter(Mandatory = $true)][string]$NativeCheckout,
  [Parameter(Mandatory = $true)][string]$ReviewOutput,
  [Parameter(Mandatory = $true)][string]$WorktreeOutput,
  [string]$WorkBranch = 'work/pf-native-review',
  [switch]$ApplyToWork,
  [string]$ConfirmWorkOnly = ''
)
Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'
$repo = (Resolve-Path (Join-Path $PSScriptRoot '..\..')).Path
$python = (Get-Command python -ErrorAction Stop).Source
$script = Join-Path $PSScriptRoot 'prepare_complete_native_work.py'
if (-not (Test-Path -LiteralPath $script -PathType Leaf)) {
  throw 'PF80_COMPLETE_WORK_ASSEMBLER_NOT_FOUND'
}
$argsForPython = @('--engine', $NativeCheckout, '--repo', $repo,
  '--review', $ReviewOutput, '--worktree', $WorktreeOutput,
  '--branch', $WorkBranch)
if ($ApplyToWork.IsPresent) {
  if ($ConfirmWorkOnly -cne 'WORK-NOT-PLAY') {
    throw 'PF80_EXPLICIT_WORK_ONLY_CONFIRMATION_REQUIRED'
  }
  $argsForPython += @('--apply', '--confirm-work-only', 'WORK-NOT-PLAY')
} elseif ($ConfirmWorkOnly -ne '') {
  throw 'PF80_CONFIRMATION_WITHOUT_APPLY_FORBIDDEN'
}
# PF85 is a fail-closed check against the unchanged ORIGINAL npcRuntime.js.
# Run it BEFORE PF80 writes any review artifacts or creates a WORK worktree.
# It executes stock source with hermetic contract dependencies; no real
# engine process, client, network, Docker, player session or wallet is started.
if ($ApplyToWork.IsPresent) {
  $node = (Get-Command node -ErrorAction Stop).Source
  $pf85Test = Join-Path $repo 'scripts\pf55\integration\pf85-original-npc-runtime.test.cjs'
  if (-not (Test-Path -LiteralPath $pf85Test -PathType Leaf)) {
    throw 'PF85_ORIGINAL_RUNTIME_TEST_MISSING'
  }
  $previousPf85Root = [Environment]::GetEnvironmentVariable('PF85_NATIVE_WORKTREE', 'Process')
  try {
    $env:PF85_NATIVE_WORKTREE = (Resolve-Path -LiteralPath $NativeCheckout -ErrorAction Stop).Path
    & $node --test --test-concurrency=1 $pf85Test
    if ($LASTEXITCODE -ne 0) { throw 'PF85_ORIGINAL_RUNTIME_SOURCE_GATE_FAILED' }
    $pf86Test = Join-Path $repo 'scripts\pf58\tests\pf86-presence-and-prewrite.test.cjs'
    if (-not (Test-Path -LiteralPath $pf86Test -PathType Leaf)) { throw 'PF86_PRESENCE_TEST_MISSING' }
    & $node --test --test-concurrency=1 $pf86Test
    if ($LASTEXITCODE -ne 0) { throw 'PF86_ORIGINAL_PRESENCE_GATE_FAILED' }
    $pf87Test = Join-Path $repo 'scripts/pf58/tests/pf87-atomic-handoff.test.cjs'
    if (-not (Test-Path -LiteralPath $pf87Test -PathType Leaf)) { throw 'PF87_ATOMIC_HANDOFF_TEST_MISSING' }
    & $node --test --test-concurrency=1 $pf87Test
    if ($LASTEXITCODE -ne 0) { throw 'PF87_ATOMIC_HANDOFF_GATE_FAILED' }
    $pf88Tests = @('pf88-reciprocal-writers.test.cjs', 'pf88-sourcebound-gating.test.cjs') | ForEach-Object {
      $path = Join-Path $repo ('scripts/pf58/tests/' + $_)
      if (-not (Test-Path -LiteralPath $path -PathType Leaf)) { throw 'PF88_RECIPROCAL_WRITER_TEST_MISSING' }
      $path
    }
    & $node --test --test-concurrency=1 @pf88Tests
    if ($LASTEXITCODE -ne 0) { throw 'PF88_RECIPROCAL_WRITER_GATE_FAILED' }
    $pf89Test = Join-Path $repo 'scripts/pf58/tests/pf89-actual-item-delta.test.cjs'
    if (-not (Test-Path -LiteralPath $pf89Test -PathType Leaf)) { throw 'PF89_ORIGINAL_ITEMS_DELTA_TEST_MISSING' }
    & $node --test --test-concurrency=1 $pf89Test
    if ($LASTEXITCODE -ne 0) { throw 'PF89_ACTUAL_ITEMS_DELTA_GATE_FAILED' }
    $pf90Owner = Join-Path $repo 'scripts/pf58/tests/pf90-owner-snapshot.test.cjs'
    $pf90Sources = Join-Path $repo 'scripts/pf90/tests/pf90-original-owners.test.cjs'
    $pf90Audit = Join-Path $repo 'scripts/pf90/inspect-original-owner-writes.cjs'
    foreach ($required in @($pf90Owner, $pf90Sources, $pf90Audit)) {
      if (-not (Test-Path -LiteralPath $required -PathType Leaf)) {
        throw 'PF90_ORIGINAL_OWNER_SOURCE_GATE_MISSING'
      }
    }
    $oldPf90NativeRoot = [Environment]::GetEnvironmentVariable('PF90_NATIVE_WORKTREE', 'Process')
    try {
      $env:PF90_NATIVE_WORKTREE = (Resolve-Path -LiteralPath $NativeCheckout -ErrorAction Stop).Path
      & $node --test --test-concurrency=1 $pf90Owner $pf90Sources
      if ($LASTEXITCODE -ne 0) { throw 'PF90_ORIGINAL_OWNER_SOURCE_REGRESSION_FAILED' }
      $ownerReportText = & $node $pf90Audit --fork-root $env:PF90_NATIVE_WORKTREE
      $ownerAuditExit = $LASTEXITCODE
      if ($ownerAuditExit -ne 2) { throw 'PF90_OWNER_AUDIT_EXIT_CONTRACT_FAILED' }
      try { $ownerReport = ($ownerReportText | Out-String | ConvertFrom-Json) }
      catch { throw 'PF90_ORIGINAL_OWNER_AUDIT_UNPARSABLE' }
      if ($ownerReport.status -cne 'BLOCKED_FOR_ACTIVATION' -or
          $ownerReport.releaseAuthority -ne $false -or
          @($ownerReport.ownerPaths).Count -ne 5 -or
          @($ownerReport.ownerPaths | Where-Object { $_.status -cne 'OWNER_HOOK_ABSENT' }).Count -ne 0 -or
          $ownerReport.originalRisks.inventoryReadsSharedCache -ne $true -or
          $ownerReport.originalRisks.characterShipTitleOutsidePFAtomic -ne $true) {
        throw 'PF90_ORIGINAL_OWNER_INTEGRATION_REVIEW_REQUIRED'
      }
      Write-Warning 'PF90: unchanged original ItemStore/characterState owners still lack reciprocal atomic hooks. WORK staging is review-only, feature OFF.'
    } finally {
      [Environment]::SetEnvironmentVariable('PF90_NATIVE_WORKTREE', $oldPf90NativeRoot, 'Process')
    }
    $pf86Source = Join-Path $repo 'scripts/pf58/tests/pf86-original-source-pins.test.cjs'
    if (-not (Test-Path -LiteralPath $pf86Source -PathType Leaf)) { throw 'PF86_ORIGINAL_SOURCE_PINS_MISSING' }
    $oldPf86SourceRoot = [Environment]::GetEnvironmentVariable('PF86_NATIVE_WORKTREE', 'Process')
    try {
      $env:PF86_NATIVE_WORKTREE = (Resolve-Path -LiteralPath $NativeCheckout -ErrorAction Stop).Path
      & $node --test --test-concurrency=1 $pf86Source
      if ($LASTEXITCODE -ne 0) { throw 'PF86_ORIGINAL_PROVIDER_SOURCE_DRIFT' }
    } finally {
      [Environment]::SetEnvironmentVariable('PF86_NATIVE_WORKTREE', $oldPf86SourceRoot, 'Process')
    }
  } finally {
    [Environment]::SetEnvironmentVariable('PF85_NATIVE_WORKTREE', $previousPf85Root, 'Process')
  }
}
& $python $script @argsForPython
if ($LASTEXITCODE -ne 0) { throw 'PF80_COMPLETE_WORK_REVIEW_FAILED' }
Write-Host 'PF80 complete native source review finished. NOT DEPLOYED. Personal Fleet OFF.'
