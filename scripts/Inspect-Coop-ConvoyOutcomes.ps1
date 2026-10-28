#Requires -Version 5.1
# READ-ONLY: print the native cargo/loss outcome receipts from the running server.
[CmdletBinding()]
param(
  [string]$CodePath='C:\Games\EveCoop\upstream-evejs\Code'
)
$ErrorActionPreference='Stop'
Set-StrictMode -Version Latest
. (Join-Path $PSScriptRoot 'lib/CoopContainerProbe.ps1')
Invoke-CoopContainerProbe -CodePath $CodePath `
  -ComposeMissing 'Missing pinned EveJS compose.yaml' `
  -ModulePath (Join-Path $PSScriptRoot '..\integration\coopConvoyOutcomeProof.cjs') `
  -ModuleMissing 'Missing native convoy outcome reader' `
  -Init 'const out=module.exports.createOutcomes().snapshot();console.log(JSON.stringify(out,null,2));if(out.status!=="READY")process.exitCode=2;' `
  -Before '[COOP CONVOY] Read-only native cargo / loss outcome receipts; no restart, credit or mutation.' `
  -After '[COOP CONVOY] Stock stack != full convoy rescue; cargo and ISK remain native-authoritative.' `
  -FailMessage 'Convoy outcome inspection failed: Docker exit {code}'
