# ALIFE-04 native stock mining proof, source-only gate. Does NOT boot Docker,
# run clients, change persistent volumes or alter native ore/items/ISK.
[CmdletBinding()]
param([string]$ReportDir="")
$ErrorActionPreference="Stop"
. (Join-Path $PSScriptRoot "lib/CoopGate.ps1")
Invoke-CoopGateById -Id "alifeMining" -ReportDir $ReportDir
