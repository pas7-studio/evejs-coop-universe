#Requires -Version 5.1
# Offline explicit native market-seed donor creation. Never touches market.sqlite.
[CmdletBinding()]
param(
 [string]$CodePath='C:\Games\EveCoop\upstream-evejs\Code',
 [switch]$BuildCandidate
)
$ErrorActionPreference='Stop'
Set-StrictMode -Version Latest
$compose=Join-Path $CodePath 'compose.yaml'
$script=Join-Path $PSScriptRoot 'coop-market-build-candidate.cjs'
if (!(Test-Path -LiteralPath $compose -PathType Leaf)) {throw 'Missing pinned EveJS compose.yaml'}
if (!(Test-Path -LiteralPath $script -PathType Leaf)) {throw 'Missing candidate builder'}
$bind="${PSScriptRoot}:/coop-market-tools:ro"
$args=@('compose','-f',$compose,'run','--rm','--no-deps',
 '--entrypoint','flock','-v',$bind,'-e','EVEJS_COOP_MARKET_OFFLINE_LOCK_HELD=1',
 'market-tools','-n','-x','/var/lib/evejs/market/.market.lock',
 'node','/coop-market-tools/coop-market-build-candidate.cjs')
if ($BuildCandidate) {
 Write-Host '[COOP MARKET] Explicit creation of a new Manifest-only candidate, not a rebuild of market.sqlite.'
 $args+=@('--build')
} else { Write-Host '[COOP MARKET] PREVIEW ONLY. No database changes.' }
& docker @args
if ($LASTEXITCODE -ne 0) {throw "Manifest candidate action blocked (exit $LASTEXITCODE)"}