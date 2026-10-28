#Requires -Version 5.1
# READ-ONLY: print current seeded-market stock for 1-10 solar systems.
[CmdletBinding()]
param(
  [string]$CodePath='C:\Games\EveCoop\upstream-evejs\Code',
  [string]$SolarSystems='30100032,30000142,30000144'
)
$ErrorActionPreference='Stop'
Set-StrictMode -Version Latest
if ($SolarSystems -notmatch '^\d+(,\d+){0,9}$') {throw 'SolarSystems must be 1-10 comma-separated positive IDs'}
. (Join-Path $PSScriptRoot 'lib/CoopContainerProbe.ps1')
Invoke-CoopContainerProbe -CodePath $CodePath `
  -ModulePath (Join-Path $PSScriptRoot 'coop-market-inspect.cjs') `
  -ModuleMissing 'Missing coop-market-inspect.cjs' `
  -Separator "`n" `
  -Init "console.log(JSON.stringify(run({systems:process.argv[2].split(',').map(Number)}),null,2));" `
  -Arguments @($SolarSystems) `
  -Before '[COOP MARKET] Reading current SQLite market stock; no seed/rebuild/write/restart.' `
  -After '[COOP MARKET] If stock is elsewhere, buy in that seeded station; orders must be fulfilled by native wallet/inventory settlement.' `
  -FailMessage 'Market inspection failed, docker exit code {code}'
