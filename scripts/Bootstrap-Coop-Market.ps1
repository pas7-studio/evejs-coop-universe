#Requires -Version 5.1
# OFFLINE only. Defaults to a dry-run; APPLY needs explicit owner approval.
[CmdletBinding()]
param(
 [string]$CodePath='C:\Games\EveCoop\upstream-evejs\Code',
 [int]$SolarSystemID=30100032,
 [string]$Candidate='/var/lib/evejs/market/coop-manifest.candidate.sqlite',
 [switch]$Apply,
 [switch]$ConfirmMarketMutation
)
$ErrorActionPreference='Stop'
Set-StrictMode -Version Latest
if ($Apply -and -not $ConfirmMarketMutation) {throw 'Refusing to apply without -ConfirmMarketMutation'}
if ($SolarSystemID -ne 30100032) {throw 'First release only supports the verified Manifest starter system 30100032'}
if ($Candidate -notmatch '^/var/lib/evejs/market/[A-Za-z0-9_.-]+\.sqlite$') {throw 'Candidate path must be within the dedicated market dir'}
$compose=Join-Path $CodePath 'compose.yaml'
$script=Join-Path $PSScriptRoot 'coop-market-additive-seed.cjs'
if (!(Test-Path -LiteralPath $compose -PathType Leaf)) {throw 'Missing pinned EveJS compose.yaml'}
if (!(Test-Path -LiteralPath $script -PathType Leaf)) {throw 'Missing additive market tool'}
# Native market service holds the same .market.lock. flock -n ensures we can
# never execute a write while the market daemon owns the database.
$bind="${PSScriptRoot}:/coop-market-tools:ro"
$args=@('compose','-f',$compose,'run','--rm','--no-deps',
 '--entrypoint','flock','-v',$bind,'-e','EVEJS_COOP_MARKET_OFFLINE_LOCK_HELD=1',
 'market-tools','-n','-x','/var/lib/evejs/market/.market.lock',
 'node','/coop-market-tools/coop-market-additive-seed.cjs',
 '--market','/var/lib/evejs/market/market.sqlite',
 '--candidate',$Candidate,'--system-id',"$SolarSystemID")
if ($Apply) {
 $args+=@('--apply','--confirm','IMPORT_MANIFEST_WITH_BACKUP',
  '--backup-dir','/var/lib/evejs/market/backups')
 Write-Host '[COOP MARKET] OFFLINE APPLY requested; one SQLite backup is required before any market mutation.'
} else { Write-Host '[COOP MARKET] DRY RUN. No market changes will be performed.' }
& docker @args
if ($LASTEXITCODE -ne 0) {throw "Market add-on aborted (exit $LASTEXITCODE); original market remains in place unless backup+apply completed."}