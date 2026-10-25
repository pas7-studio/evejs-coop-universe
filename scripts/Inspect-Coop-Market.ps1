#Requires -Version 5.1
[CmdletBinding()]
param(
  [string]$CodePath='C:\Games\EveCoop\upstream-evejs\Code',
  [string]$SolarSystems='30000142,30000144'
)
$ErrorActionPreference='Stop'
Set-StrictMode -Version Latest
$compose=Join-Path $CodePath 'compose.yaml'
$jsPath=Join-Path $PSScriptRoot 'coop-market-inspect.cjs'
if (!(Test-Path -LiteralPath $compose -PathType Leaf)) {throw 'Missing upstream compose.yaml'}
if (!(Test-Path -LiteralPath $jsPath -PathType Leaf)) {throw 'Missing coop-market-inspect.cjs'}
if ($SolarSystems -notmatch '^\d+(,\d+){0,9}$') {throw 'SolarSystems must be 1-10 comma-separated positive IDs'}
$body=[IO.File]::ReadAllText($jsPath,[Text.Encoding]::UTF8)
# node -e is not a regular CJS entrypoint: execute the read-only inspect explicitly.
$body += "`nconsole.log(JSON.stringify(run({systems:process.argv[2].split(',').map(Number)}),null,2));"
$encoded=[Convert]::ToBase64String([Text.Encoding]::UTF8.GetBytes($body))
$runner='eval(Buffer.from(process.argv[1],String.fromCharCode(98,97,115,101,54,52)).toString())'
Write-Host '[COOP MARKET] Reading current SQLite market stock; no seed/rebuild/write/restart.'
& docker compose -f $compose exec -T server node -e $runner $encoded $SolarSystems
if ($LASTEXITCODE -ne 0) {throw "Market inspection failed, docker exit code $LASTEXITCODE"}
Write-Host '[COOP MARKET] If stock is elsewhere, buy in that seeded station; orders must be fulfilled by native wallet/inventory settlement.'