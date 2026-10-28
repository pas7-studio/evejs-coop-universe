# LW-04F exact original COOP-030 hook and ALIFE-09 source/flush regression.
[CmdletBinding()]
param([string]$ReportDir="")
$ErrorActionPreference="Stop"
. (Join-Path $PSScriptRoot "lib/CoopGate.ps1")
Invoke-CoopGateById -Id "lw04f" -ReportDir $ReportDir
