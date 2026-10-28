# LW-04C3B manual source-only NPC manufacturer sale finance gate.
[CmdletBinding()]
param([string]$ReportDir="")
$ErrorActionPreference="Stop"
. (Join-Path $PSScriptRoot "lib/CoopGate.ps1")
Invoke-CoopGateById -Id "lw04c3b" -ReportDir $ReportDir
