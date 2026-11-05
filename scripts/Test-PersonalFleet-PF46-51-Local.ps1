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
 foreach ($step in @('pf49','pf50','pf51')) {
  $script=Join-Path $root ('scripts\'+$step+'\Test-'+$step.ToUpper()+'-NativePatch.ps1')
  if (-not (Test-Path -LiteralPath $script -PathType Leaf)) { throw "PREFLIGHT_MISSING: $step" }
  & $script -ForkRoot $ForkRoot
  if ($LASTEXITCODE -ne 0) { throw "NATIVE_PREFLIGHT_FAILED: $step" }
 }
 Write-Host 'PF46_51_NATIVE_PATCH_PREFLIGHT_PASS (patch applicability only)'
} else {
 Write-Host 'PF46_51_NATIVE_PATCH_PREFLIGHT_NOT_RUN'
}
Write-Host 'PF46_51_WORK_GAMEPLAY_E2E_NOT_RUN'
Write-Host 'PF46_51_PERSONAL_FLEET_REMAINS_OFF'