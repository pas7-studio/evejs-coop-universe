#Requires -Version 5.1
# READ-ONLY: print the native convoy incident journal from the running server.
[CmdletBinding()]
param(
  [string]$CodePath='C:\Games\EveCoop\upstream-evejs\Code'
)
$ErrorActionPreference='Stop'
Set-StrictMode -Version Latest
. (Join-Path $PSScriptRoot 'lib/CoopContainerProbe.ps1')
Invoke-CoopContainerProbe -CodePath $CodePath `
  -ModulePath (Join-Path $PSScriptRoot '..\integration\coopConvoyOperations.cjs') `
  -ModuleMissing 'Missing co-op native convoy incident reader' `
  -Init 'const snapshot=module.exports.createOperations().snapshot();console.log(JSON.stringify(snapshot,null,2));if(snapshot.status!=="READY")process.exitCode=2;' `
  -Before '[COOP CONVOY] Read-only native convoy incident journal (no Docker restart or asset mutation).' `
  -After '[COOP CONVOY] DUO_INTERVENED means native participation evidence, NOT delivery or ISK reward.' `
  -FailMessage 'Native convoy journal inspection blocked: Docker exit {code}'
