#Requires -Version 5.1
[CmdletBinding()]
param(
  [string]$CodePath='C:\Games\EveCoop\upstream-evejs\Code'
)
$ErrorActionPreference='Stop'
Set-StrictMode -Version Latest
$compose=Join-Path $CodePath 'compose.yaml'
$source=Join-Path $PSScriptRoot '..\integration\coopConvoyOutcomeProof.cjs'
if (!(Test-Path -LiteralPath $compose -PathType Leaf)) { throw 'Missing pinned EveJS compose.yaml' }
if (!(Test-Path -LiteralPath $source -PathType Leaf)) { throw 'Missing native convoy outcome reader' }
$body=[IO.File]::ReadAllText($source,[Text.Encoding]::UTF8)
$body += [Environment]::NewLine + 'const out=module.exports.createOutcomes().snapshot();console.log(JSON.stringify(out,null,2));if(out.status!=="READY")process.exitCode=2;'
$encoded=[Convert]::ToBase64String([Text.Encoding]::UTF8.GetBytes($body))
$runner='eval(Buffer.from(process.argv[1],String.fromCharCode(98,97,115,101,54,52)).toString())'
Write-Host '[COOP CONVOY] Read-only native cargo / loss outcome receipts; no restart, credit or mutation.'
& docker compose -f $compose exec -T server node -e $runner $encoded
if ($LASTEXITCODE -ne 0) { throw "Convoy outcome inspection failed: Docker exit $LASTEXITCODE" }
Write-Host '[COOP CONVOY] Stock stack != full convoy rescue; cargo and ISK remain native-authoritative.'
