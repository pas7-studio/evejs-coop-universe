#Requires -Version 5.1
# Tests original-shaped read-only PF58 authorization; no native server writes.
[CmdletBinding()]
param()
$ErrorActionPreference='Stop'
$root=Split-Path -Parent $MyInvocation.MyCommand.Path
$node=(Get-Command node -ErrorAction Stop).Source
$major=[int]((& $node -p 'process.versions.node.split(".")[0]'))
if($major -lt 22){ throw 'PF65_NODE22_REQUIRED' }
$tests=@(Get-ChildItem -LiteralPath (Join-Path $root 'tests') -Filter '*.test.cjs' -File | Sort-Object Name)
if($tests.Count -ne 2){ throw 'PF65_EXPECTED_TWO_NODE_TEST_FILES' }
& $node --test '--test-concurrency=1' @($tests.FullName)
if($LASTEXITCODE -ne 0){ throw 'PF65_PERMIT_REGRESSION_FAILED' }
Write-Host 'PF65 19/19 local claims/permit regression; native EveJS and WORK E2E NOT RUN; feature OFF.'
