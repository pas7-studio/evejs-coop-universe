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
  } finally {
    [Environment]::SetEnvironmentVariable('PF85_NATIVE_WORKTREE', $previousPf85Root, 'Process')
  }
}
& $python $script @argsForPython
if ($LASTEXITCODE -ne 0) { throw 'PF80_COMPLETE_WORK_REVIEW_FAILED' }
Write-Host 'PF80 complete native source review finished. NOT DEPLOYED. Personal Fleet OFF.'
