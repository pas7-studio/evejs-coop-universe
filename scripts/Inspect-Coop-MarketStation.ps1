#Requires -Version 5.1
# READ-ONLY: report native market readiness for a system, and for a station when
# -StationID is given (0 lists the stations instead).
[CmdletBinding()]
param(
  [string]$CodePath='C:\Games\EveCoop\upstream-evejs\Code',
  [int]$SystemID=30100032,
  [int]$StationID=0
)
$ErrorActionPreference='Stop'
Set-StrictMode -Version Latest
if ($SystemID -lt 1 -or $StationID -lt 0) { throw 'SystemID must be positive and StationID must be zero (list stations) or positive' }
. (Join-Path $PSScriptRoot 'lib/CoopContainerProbe.ps1')
Invoke-CoopContainerProbe -CodePath $CodePath `
  -ModulePath (Join-Path $PSScriptRoot 'coop-market-station-readiness.cjs') `
  -ModuleMissing 'Missing read-only native market readiness script' `
  -Init 'console.log(JSON.stringify(run({systemID:Number(process.argv[2]),stationID:Number(process.argv[3]) || null}),null,2));' `
  -Arguments @($SystemID, $StationID) `
  -Before "[COOP MARKET] Native market SQLite READ-ONLY, system $SystemID, station $StationID (0 = list)." `
  -After '[COOP MARKET] Stock evidence is NOT client buy proof; do not reseed/restart without permission.' `
  -FailMessage 'Market station inspection failed: Docker exit {code}'
