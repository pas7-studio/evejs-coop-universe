# P0 isolated native NPC ammo durability acceptance, no production writes.
# Windows: delegates POSIX fsync / SIGKILL checks to Linux WSL2.
[CmdletBinding()]
param(
  [string]$DisposableCodePath = ""
)
$ErrorActionPreference = "Stop"
Set-StrictMode -Version Latest
$runner = (Join-Path $PSScriptRoot "test-coop-npc-ammo-atomic.sh")
if (!(Test-Path -LiteralPath $runner -PathType Leaf)) {
  throw "NPC_AMMO_LINUX_RUNNER_MISSING"
}
if ([System.Environment]::OSVersion.Platform -eq [System.PlatformID]::Win32NT) {
  if (!(Get-Command wsl.exe -ErrorAction SilentlyContinue)) {
    throw "NPC_AMMO_WSL2_REQUIRED: run in Ubuntu/WSL2 with Node 22+ for POSIX durability tests."
  }
  $linuxRunner = (& wsl.exe -- wslpath -a -u $runner)
  if ($LASTEXITCODE -ne 0 -or [string]::IsNullOrWhiteSpace($linuxRunner)) {
    throw "NPC_AMMO_WSL_PATH_RESOLVE_FAILED"
  }
  $linuxArgs = @($linuxRunner.Trim())
  if ($DisposableCodePath -ne "") {
    if (!(Test-Path -LiteralPath $DisposableCodePath -PathType Container)) {
      throw "NPC_AMMO_DISPOSABLE_CODE_PATH_MISSING"
    }
    $converted = (& wsl.exe -- wslpath -a -u $DisposableCodePath)
    if ($LASTEXITCODE -ne 0 -or [string]::IsNullOrWhiteSpace($converted)) {
      throw "NPC_AMMO_WSL_CODE_PATH_RESOLVE_FAILED"
    }
    $linuxArgs += $converted.Trim()
  }
  & wsl.exe -- bash @linuxArgs
  if ($LASTEXITCODE -ne 0) { throw "NPC_AMMO_WSL_TESTS_FAILED" }
} else {
  $linuxArgs = @($runner)
  if ($DisposableCodePath -ne "") { $linuxArgs += $DisposableCodePath }
  & bash @linuxArgs
  if ($LASTEXITCODE -ne 0) { throw "NPC_AMMO_LINUX_TESTS_FAILED" }
}
Write-Host "NPC_AMMO_POSIX_TESTS_PASS (not a live gameplay acceptance)"
