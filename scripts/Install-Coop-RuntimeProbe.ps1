#Requires -Version 5.1
[CmdletBinding()]
param(
  [string]$CodePath = 'C:\Games\EveCoop\upstream-evejs\Code',
  [switch]$Remove,
  [switch]$DryRun,
  [switch]$Check
)
$ErrorActionPreference='Stop'
$node=Get-Command 'node' -ErrorAction Stop
$patcher=Join-Path $PSScriptRoot 'patch-evejs-coop.cjs'
if(-not (Test-Path -LiteralPath $patcher)){throw "Missing patch engine: $patcher"}
$argsList=@($patcher,'--code-path',$CodePath)
if($Check){$argsList+='--check'}
if($Remove){$argsList+='--remove'}
if($DryRun){$argsList+='--dry-run'}
& $node.Source @argsList
if($LASTEXITCODE -ne 0){
  if($Check){throw "Deployed co-op overlay does not match this repository (exit $LASTEXITCODE). See docs/DEVELOPMENT_DOCTRINE.md section 6; do not redeploy over drift."}
  throw "Pinned EveJS co-op overlay failed (exit $LASTEXITCODE); original sources were not intentionally overwritten."
}
