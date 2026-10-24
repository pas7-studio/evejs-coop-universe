#Requires -Version 5.1
[CmdletBinding()]
param(
  [string]$CodePath = 'C:\Games\EveCoop\upstream-evejs\Code',
  [switch]$Remove,
  [switch]$DryRun
)
$ErrorActionPreference='Stop'
$node=Get-Command 'node' -ErrorAction Stop
$patcher=Join-Path $PSScriptRoot 'patch-evejs-coop.cjs'
if(-not (Test-Path -LiteralPath $patcher)){throw "Missing patch engine: $patcher"}
$argsList=@($patcher,'--code-path',$CodePath)
if($Remove){$argsList+='--remove'}
if($DryRun){$argsList+='--dry-run'}
& $node.Source @argsList
if($LASTEXITCODE -ne 0){throw "Pinned EveJS co-op overlay failed (exit $LASTEXITCODE); original sources were not intentionally overwritten."}
