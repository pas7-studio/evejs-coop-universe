# ALIFE-07: isolated SQLite and pinned source checks. No Docker or preserved volume.
[CmdletBinding()]
param([string]$UpstreamCodeRoot="",[string]$ReportDir="")
$ErrorActionPreference="Stop"
. (Join-Path $PSScriptRoot "lib/CoopGate.ps1")
Invoke-CoopGateById -Id "alife07" -ReportDir $ReportDir -UpstreamCodeRoot $UpstreamCodeRoot
