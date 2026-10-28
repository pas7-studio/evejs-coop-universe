# COOP-042 A-Life native economy unit+scenario preflight (no Docker actions).
# Usage: pwsh -File scripts/Run-Alife-Economy-Tests.ps1
# Data: scripts/lib/gates.json -> alifeEconomy (38 test files, 10 acceptance
# manifests that must stay NOT_RUN, three extra tests behind -IncludeExistingEconomyTests).
[CmdletBinding()]
param(
 [string]$ReportDir = "",
 [switch]$IncludeExistingEconomyTests
)
$ErrorActionPreference = "Stop"
. (Join-Path $PSScriptRoot "lib/CoopGate.ps1")
Invoke-CoopGateById -Id "alifeEconomy" -ReportDir $ReportDir `
 -Switches @{IncludeExistingEconomyTests=[bool]$IncludeExistingEconomyTests}
