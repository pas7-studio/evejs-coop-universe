# LW-04E source-only original ALIFE-09 and corporate warehouse title gate
[CmdletBinding()]
param([string]$ReportDir="")
$ErrorActionPreference="Stop"
. (Join-Path $PSScriptRoot "lib/CoopGate.ps1")
Invoke-CoopGateById -Id "lw04e" -ReportDir $ReportDir
