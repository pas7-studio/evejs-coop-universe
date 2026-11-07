#Requires -Version 5.1
[CmdletBinding()]
param([string]$NativeWorktree = '')
$ErrorActionPreference = 'Stop'
$root = Split-Path -Parent $MyInvocation.MyCommand.Path
$node = Get-Command node -ErrorAction Stop
Push-Location $root
try {
  & $node.Source --test 'tests/pf57-lifecycle.test.cjs' 'tests/pf57-sqlite-sigkill.test.cjs'
  if ($LASTEXITCODE -ne 0) { throw 'PF57_NODE_TESTS_FAILED' }
  if ($NativeWorktree) {
    if (-not (Test-Path -LiteralPath $NativeWorktree -PathType Container)) { throw 'PF57_NATIVE_WORKTREE_NOT_FOUND' }
    $pins = @{
      'Code/server/src/space/coopGameStoreAtomic.js'='2b28b48145f3fbc989ce7346384487ee75e52280'
      'Code/server/src/services/inventory/itemStore.js'='e992d56ee9cff1911d54247bf46d44d01e5d8060'
      'Code/server/src/services/account/walletState.js'='ef4799d896ce8dbb854e75b810057b1208932e13'
      'Code/server/src/space/npc/nativeNpcWreckService.js'='600568093f1e356e2b032395fda4e5d9bb7a0a36'
      'Code/server/src/space/npc/nativeNpcStore.js'='95724ab4537683e7ee933bc3149d0a891082ce7e'
      'Code/server/src/space/coopPilotPayroll.js'='2b7d335779bec961db4d48dfd73a3f534472e98a'
      'Code/server/src/space/coopWarLossReconcile.js'='75b865f2dea39e460c4b3a24b1a069328e264588'
    }
    foreach ($entry in $pins.GetEnumerator()) {
      $file = Join-Path $NativeWorktree $entry.Key
      if (-not (Test-Path -LiteralPath $file -PathType Leaf)) { throw "PF57_MISSING_NATIVE_SOURCE: $($entry.Key)" }
      $actual = (& git -C $NativeWorktree hash-object -- $entry.Key 2>&1)
      if ($LASTEXITCODE -ne 0 -or [string]$actual -ne $entry.Value) { throw "PF57_NATIVE_SOURCE_DRIFT: $($entry.Key)" }
      Write-Host "Source pin OK: $($entry.Key)"
    }
    Write-Host 'Native source pin PASS. Runtime integration and gameplay E2E NOT RUN.'
  }
  Write-Host 'PF57 candidate tests PASS; NOT GAMEPLAY READY; flags remain OFF.'
}
finally { Pop-Location }
