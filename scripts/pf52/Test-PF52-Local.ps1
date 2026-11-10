#Requires -Version 5.1
<#
 Source-only PF52 tests and read-only Git source pin checks. No install, deploy,
 git patch apply, GameStore writes, Docker restart or PLAY access.
#>
param([string]$ForkRoot = '')
$ErrorActionPreference = 'Stop'
$Root = Split-Path -Parent $MyInvocation.MyCommand.Path
$Node = (Get-Command node -ErrorAction Stop).Source
Write-Host '[PF52] running isolated original SQLite source tests'
& $Node --test (Join-Path $Root 'tests\pf52-hangar.test.cjs') (Join-Path $Root 'tests\pf52-sqlite-sigkill.test.cjs')
if ($LASTEXITCODE -ne 0) { throw 'PF52_NODE_TEST_FAILED' }
if (-not [string]::IsNullOrWhiteSpace($ForkRoot)) {
  if (-not (Test-Path -Path $ForkRoot -PathType Container)) { throw 'PF52_FORK_ROOT_MISSING' }
  $Git = (Get-Command git -ErrorAction Stop).Source
  $Pins = @(
    @('Code/server/src/space/coopGameStoreAtomic.js','2b28b48145f3fbc989ce7346384487ee75e52280'),
    @('Code/server/src/services/inventory/itemStore.js','e992d56ee9cff1911d54247bf46d44d01e5d8060'),
    @('Code/server/src/space/coopWarFleetRegistry.js','d8bce76a9d033bf9c33e22b8b9d26852a23c92ed'),
    @('Code/server/src/space/coopNpcOrderBridge.js','c0f93af3e5a67703a84dc03cab8da29a65afdf3b')
  )
  foreach ($Pair in $Pins) {
    $File = Join-Path $ForkRoot ($Pair[0].Replace('/',[IO.Path]::DirectorySeparatorChar))
    if (-not (Test-Path -LiteralPath $File -PathType Leaf)) { throw ('PF52_SOURCE_NOT_FOUND: '+$Pair[0]) }
    $Blob = (& $Git -C $ForkRoot hash-object -- $Pair[0] 2>&1 | Out-String).Trim()
    if ($LASTEXITCODE -ne 0 -or $Blob -ne $Pair[1]) { throw ('PF52_ORIGINAL_SOURCE_PIN_MISMATCH: '+$Pair[0]+' (got '+$Blob+')') }
    Write-Host ('[PF52] pinned original: '+$Pair[0])
  }
}
Write-Host '[PF52] PASS isolated tests; NOT RUN: native bridge integration, WORK gameplay, 2 players, UI, payroll or deployment.'
Write-Host '[PF52] PERSONAL FLEET OFF. No source files or running servers were modified.'