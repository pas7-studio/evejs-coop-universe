#Requires -Version 5.1
<# Read-only PF53 source/SQLite checks. Does not patch, deploy, or modify WORK/PLAY. #>
param(
  [string]$ForkRoot = '',
  [switch]$WithSourcePins
)
$ErrorActionPreference = 'Stop'
$base = Split-Path -Parent $MyInvocation.MyCommand.Path
Write-Host '[PF53] Running isolated original SQLite + SIGKILL checks (no deployment)'
& node --test (Join-Path $base 'tests/pf53-paid-hiring.test.cjs') (Join-Path $base 'tests/pf53-paid-hiring-sigkill.test.cjs')
if ($LASTEXITCODE -ne 0) { throw '[PF53] Local tests FAILED' }
if ($WithSourcePins) {
  if ([string]::IsNullOrWhiteSpace($ForkRoot)) { throw '[PF53] -ForkRoot is required with -WithSourcePins' }
  $expected = @{
    'Code/server/src/space/coopGameStoreAtomic.js' = '2b28b48145f3fbc989ce7346384487ee75e52280'
    'Code/server/src/services/account/walletState.js' = 'ef4799d896ce8dbb854e75b810057b1208932e13'
    'Code/server/src/services/character/characterState.js' = '8a002d190899b6cb1e1068a565451e6d1d808401'
    'Code/server/src/services/corporation/corporationRuntimeState.js' = '1e87597539389567716e75de565519c9cb19a977'
    'Code/server/src/services/account/plexVaultLogState.js' = '62a03b8578a390f5614fc67b6693ffa74b2b2ee5'
    'Code/server/src/space/coopWarFleetRegistry.js' = 'd8bce76a9d033bf9c33e22b8b9d26852a23c92ed'
  }
  foreach ($entry in $expected.GetEnumerator()) {
    $full = Join-Path $ForkRoot ($entry.Key -replace '/', [IO.Path]::DirectorySeparatorChar)
    if (-not (Test-Path -LiteralPath $full -PathType Leaf)) { throw "[PF53] MISSING $($entry.Key)" }
    $sha = ((& git hash-object -- $full) | Out-String).Trim()
    if ($LASTEXITCODE -ne 0 -or $sha -ne $entry.Value) {
      throw "[PF53] SOURCE DRIFT $($entry.Key): $sha (expected $($entry.Value))"
    }
  }
  Write-Host '[PF53] Original source pins MATCH (source only; no runtime validation)'
} else {
  Write-Host '[PF53] Original engine source pins NOT RUN; pass -WithSourcePins -ForkRoot <path>'
}
Write-Host '[PF53] PASS: isolated Node suite. NOT RUN: native GameStore WORK E2E, 2 players, physical NPC deployment.'
Write-Host '[PF53] Personal Fleet stays OFF; do not deploy to PLAY or merge as gameplay ready.'