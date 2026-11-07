#Requires -Version 5.1
# PF68: explicit LOCAL WORK Git worktree only. No CI, no push, no Docker,
# no main/PLAY changes and no Personal Fleet activation.
[CmdletBinding()]
param(
  [Parameter(Mandatory = $true)][string]$NativeCheckout,
  [Parameter(Mandatory = $true)][string]$ReviewOutput,
  [Parameter(Mandatory = $true)][string]$WorktreeOutput,
  [string]$WorkBranch = 'work/pf-native-review',
  [switch]$ApplyToWork,
  [string]$ConfirmWorkOnly = ''
)
$ErrorActionPreference = 'Stop'
$python = (Get-Command python -ErrorAction Stop).Source
$repo = (Resolve-Path (Join-Path $PSScriptRoot '..\..')).Path
$argsList = @((Join-Path $PSScriptRoot 'prepare_native_worktree.py'),
  '--engine', $NativeCheckout,
  '--repo', $repo,
  '--review', $ReviewOutput,
  '--worktree', $WorktreeOutput,
  '--branch', $WorkBranch)
if ($ApplyToWork) {
  if ($ConfirmWorkOnly -cne 'WORK-NOT-PLAY') {
    throw 'PF68_EXPLICIT_WORK_ONLY_CONFIRMATION_REQUIRED'
  }
  $argsList += @('--apply', '--confirm-work-only', 'WORK-NOT-PLAY')
}
& $python @argsList
if ($LASTEXITCODE -ne 0) { throw 'PF68_LOCAL_WORK_PREFLIGHT_OR_INSTALL_BLOCKED' }
Write-Host 'REVIEW-ONLY: native WORK needs real authorities and two-client E2E; Personal Fleet remains OFF.'
