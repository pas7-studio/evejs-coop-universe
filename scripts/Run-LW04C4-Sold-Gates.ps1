# LW-04C4 source-only strict native NPC SOLD finalization gate.
[CmdletBinding()]
param([string]$ReportDir="")
$ErrorActionPreference="Stop"
. (Join-Path $PSScriptRoot "lib/CoopGate.ps1")
Invoke-CoopGateById -Id "lw04c4" -ReportDir $ReportDir
