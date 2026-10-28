# LW-04C2 source-only original production stage gate.
# No running EveJS/Docker/production database access.
[CmdletBinding()]
param([string]$ReportDir="")
$ErrorActionPreference="Stop"
. (Join-Path $PSScriptRoot "lib/CoopGate.ps1")
Invoke-CoopGateById -Id "lw04c2" -ReportDir $ReportDir
