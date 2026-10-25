#Requires -Version 5.1
[CmdletBinding()]
param(
  [string]$CodePath='C:\Games\EveCoop\upstream-evejs\Code',
  [int]$SystemID=30100032,
  [int]$StationID=0
)
$ErrorActionPreference='Stop'
Set-StrictMode -Version Latest
if ($SystemID -lt 1 -or $StationID -lt 0) { throw 'SystemID must be positive and StationID must be zero (list stations) or positive' }
$compose=Join-Path $CodePath 'compose.yaml'
$script=Join-Path $PSScriptRoot 'coop-market-station-readiness.cjs'
if (!(Test-Path -LiteralPath $compose -PathType Leaf)) { throw 'Missing upstream compose.yaml' }
if (!(Test-Path -LiteralPath $script -PathType Leaf)) { throw 'Missing read-only native market readiness script' }
$body=[IO.File]::ReadAllText($script,[Text.Encoding]::UTF8)
# node -e never executes require.main===module; run only our read-only inspector.
$body += [Environment]::NewLine + 'console.log(JSON.stringify(run({systemID:Number(process.argv[2]),stationID:Number(process.argv[3]) || null}),null,2));'
$base64=[Convert]::ToBase64String([Text.Encoding]::UTF8.GetBytes($body))
$runner='eval(Buffer.from(process.argv[1],String.fromCharCode(98,97,115,101,54,52)).toString())'
Write-Host "[COOP MARKET] Native market SQLite READ-ONLY, system $SystemID, station $StationID (0 = list)."
& docker compose -f $compose exec -T server node -e $runner $base64 $SystemID $StationID
if ($LASTEXITCODE -ne 0) { throw "Market station inspection failed: Docker exit $LASTEXITCODE" }
Write-Host '[COOP MARKET] Stock evidence is NOT client buy proof; do not reseed/restart without permission.'
