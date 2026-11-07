#Requires -Version 5.1
<#
.SYNOPSIS
  PF46-51 local-only source/SQLite gate. NEVER builds, deploys, or modifies WORK/PLAY.
.EXAMPLE
  .\scripts\Test-PersonalFleet-PF46-51-Local.ps1
  .\scripts\Test-PersonalFleet-PF46-51-Local.ps1 -WithLinuxGates -ForkRoot 'C:\Games\EveCoop\upstream-evejs' -WithNativePreflight
#>
[CmdletBinding()]
param(
 [string]$ForkRoot = 'C:\Games\EveCoop\upstream-evejs',
 [switch]$WithNativePreflight,
 [switch]$WithLinuxGates
)
$ErrorActionPreference='Stop'
$root=(Resolve-Path (Join-Path $PSScriptRoot '..')).Path
if (-not (Get-Command node -ErrorAction SilentlyContinue)) { throw 'Node 22+ required' }
$major=[int]((& node -p 'process.versions.node.split(".")[0]').Trim())
if ($major -lt 22) { throw 'Node 22+ required' }
$files=@(
 'tests\pf46-shutdown.test.mjs',
 'tests\pf47-gamestore-adapter.test.mjs',
 'tests\pf48-native-writer-audit.test.mjs',
 'scripts\pf49\tests\pf49-native-mining-txn-guard.test.cjs',
 'scripts\pf49\tests\pf49-sqlite-durability.test.cjs',
 'scripts\pf50\tests\patch-smoke.cjs',
 'scripts\pf50\tests\pf50-guard.test.cjs',
 'scripts\pf50\tests\pf50-sqlite.test.cjs',
 'scripts\pf51\tests\pf51-startup-fence.test.cjs'
)
$paths=@()
foreach ($rel in $files) {
 $p=Join-Path $root $rel
 if (-not (Test-Path -LiteralPath $p -PathType Leaf)) { throw "MISSING_TEST: $rel" }
 $paths += $p
}
Write-Host '=== PF46-51 isolated source/SQLite tests (NO GAMEPLAY) ==='
& node --test @paths
if ($LASTEXITCODE -ne 0) { throw "PF46_51_SOURCE_TESTS_FAILED exit=$LASTEXITCODE" }
Write-Host 'PF46_51_SOURCE_TESTS_PASS'
# The crash and git-apply fixtures are Linux-specific. Never silently report
# them PASS from a Windows-only run; opt in to WSL2 and Linux Node 22+.
if ($WithLinuxGates) {
 if (-not (Get-Command wsl.exe -ErrorAction SilentlyContinue)) { throw 'WSL2 required for Linux SIGKILL gates' }
 $linuxRel=@(
  'scripts\pf50\tests\pf50-sqlite-sigkill.test.cjs',
  'scripts\pf51\tests\pf51-sqlite-sigkill.test.cjs',
  'scripts\pf51\tests\pf51-patch-smoke.test.cjs'
 )
 $linuxPaths=@()
 foreach ($rel in $linuxRel) {
  $pathWin=Join-Path $root $rel
  if (-not (Test-Path -LiteralPath $pathWin -PathType Leaf)) { throw "MISSING_LINUX_TEST: $rel" }
  $pathLinux=(& wsl.exe -- wslpath -u $pathWin | Out-String).Trim()
  if ($LASTEXITCODE -ne 0 -or -not $pathLinux) { throw "WSLPATH_FAILED: $rel" }
  $linuxPaths += $pathLinux
 }
 & wsl.exe -- node --test @linuxPaths
 if ($LASTEXITCODE -ne 0) { throw "PF46_51_LINUX_GATES_FAILED exit=$LASTEXITCODE" }
 Write-Host 'PF46_51_LINUX_SIGKILL_AND_PATCH_GATES_PASS'
} else {
 Write-Host 'PF46_51_LINUX_SIGKILL_AND_PATCH_GATES_NOT_RUN (add -WithLinuxGates)'
}
if ($WithNativePreflight) {
 if (-not (Test-Path -LiteralPath $ForkRoot -PathType Container)) { throw "FORK_NOT_FOUND: $ForkRoot" }
 if (-not (Get-Command python -ErrorAction SilentlyContinue)) { throw 'Python required for native source preflight' }
 if (-not (Get-Command git -ErrorAction SilentlyContinue)) { throw 'Git required for native source preflight' }
 # PF50 is an incremental patch ON TOP OF PF49, so both cannot be checked
 # against the same untouched fork. Never claim all native patches applicable.
 $pf51Builder=Join-Path $root 'scripts\pf51\build_patch.py'
 $pf51Patch=Join-Path $root 'scripts\pf51\patches\PF51-native-startup-fence.patch'
 if (-not (Test-Path -LiteralPath $pf51Builder -PathType Leaf)) { throw 'PF51_PATCH_BUILDER_MISSING' }
 & python $pf51Builder --fork-root $ForkRoot --output $pf51Patch
 if ($LASTEXITCODE -ne 0) { throw 'PF51_SOURCE_PIN_PREFLIGHT_FAILED' }
 & git -C $ForkRoot apply --check $pf51Patch
 if ($LASTEXITCODE -ne 0) { throw 'PF51_PATCH_CHECK_FAILED' }
 Write-Host 'PF51_NATIVE_PATCH_APPLICABILITY_PASS (NOT APPLIED)'
 Write-Host 'PF49_PF50_STAGED_NATIVE_PATCH_APPLICABILITY_NOT_RUN (requires separate disposable patch sequence)'
} else {
 Write-Host 'PF46_51_NATIVE_PATCH_PREFLIGHT_NOT_RUN'
}
Write-Host 'PF46_51_WORK_GAMEPLAY_E2E_NOT_RUN'
Write-Host 'PF46_51_PERSONAL_FLEET_REMAINS_OFF'