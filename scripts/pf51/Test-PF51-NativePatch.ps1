#Requires -Version 5.1
<# Read-only PF51 source pin + patch check. No native files are changed. #>
[CmdletBinding()]
param([Parameter(Mandatory=$true)][string]$ForkRoot)
$ErrorActionPreference = 'Stop'
$here = $PSScriptRoot
if (-not (Get-Command node -ErrorAction SilentlyContinue)) { throw 'Node.js 22+ required' }
if (-not (Get-Command python -ErrorAction SilentlyContinue)) { throw 'Python 3 required' }
if (-not (Get-Command git -ErrorAction SilentlyContinue)) { throw 'Git required' }
$nodeMajor = [int](& node -p 'process.versions.node.split(".")[0]')
if ($nodeMajor -lt 22) { throw 'Node.js 22+ required' }
$root=(Resolve-Path -LiteralPath $ForkRoot).Path
& node --test (Join-Path $here 'tests/pf51-startup-fence.test.cjs') (Join-Path $here 'tests/pf51-sqlite-sigkill.test.cjs') (Join-Path $here 'tests/pf51-patch-smoke.test.cjs')
if ($LASTEXITCODE -ne 0) { throw 'PF51 local tests FAILED' }
$patchFile=Join-Path $here 'patches/PF51-native-startup-fence.patch'
& python (Join-Path $here 'build_patch.py') --fork-root $root --output $patchFile
if ($LASTEXITCODE -ne 0) { throw 'PF51 source pin or patch generation FAILED' }
& git -C $root apply --check $patchFile
if ($LASTEXITCODE -ne 0) { throw 'PF51 git apply --check FAILED' }
Write-Host 'PF51_PREFLIGHT_PASS: REVIEW PATCH ONLY; NOT APPLIED; NO GAMEPLAY CLAIM'