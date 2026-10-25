#Requires -Version 5.1
[CmdletBinding()]
param(
  [string]$CodePath='C:\Games\EveCoop\upstream-evejs\Code'
)
$ErrorActionPreference='Stop'
Set-StrictMode -Version Latest
$compose=Join-Path $CodePath 'compose.yaml'
$source=Join-Path $PSScriptRoot '..\integration\coopConvoyOperations.cjs'
if (!(Test-Path -LiteralPath $compose -PathType Leaf)) { throw 'Missing upstream compose.yaml' }
if (!(Test-Path -LiteralPath $source -PathType Leaf)) { throw 'Missing co-op native convoy incident reader' }
$body=[IO.File]::ReadAllText($source,[Text.Encoding]::UTF8)
# Reading an incident snapshot neither mutates the source nor writes to the
# persistent JSONL. The live server remains fully running throughout.
$body += [Environment]::NewLine + 'const snapshot=module.exports.createOperations().snapshot();console.log(JSON.stringify(snapshot,null,2));if(snapshot.status!=="READY")process.exitCode=2;'
$encoded=[Convert]::ToBase64String([Text.Encoding]::UTF8.GetBytes($body))
$runner='eval(Buffer.from(process.argv[1],String.fromCharCode(98,97,115,101,54,52)).toString())'
Write-Host '[COOP CONVOY] Read-only native convoy incident journal (no Docker restart or asset mutation).'
& docker compose -f $compose exec -T server node -e $runner $encoded
if ($LASTEXITCODE -ne 0) { throw "Native convoy journal inspection blocked: Docker exit $LASTEXITCODE" }
Write-Host '[COOP CONVOY] DUO_INTERVENED means native participation evidence, NOT delivery or ISK reward.'
