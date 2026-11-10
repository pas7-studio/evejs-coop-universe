#Requires -Version 5.1
<# PF46-53 isolated candidate test runner. READ-ONLY, no WORK/PLAY changes. #>
$ErrorActionPreference = 'Stop'
$repo = Split-Path -Parent (Split-Path -Parent $MyInvocation.MyCommand.Path)
$paths = @(
 'tests/pf46-shutdown.test.mjs',
 'tests/pf47-gamestore-adapter.test.mjs',
 'tests/pf48-native-writer-audit.test.mjs',
 'scripts/pf49/tests/pf49-native-mining-txn-guard.test.cjs',
 'scripts/pf49/tests/pf49-sqlite-durability.test.cjs',
 'scripts/pf50/tests/pf50-guard.test.cjs',
 'scripts/pf50/tests/pf50-sqlite.test.cjs',
 'scripts/pf50/tests/pf50-sqlite-sigkill.test.cjs',
 'scripts/pf51/tests/pf51-patch-smoke.test.cjs',
 'scripts/pf51/tests/pf51-sqlite-sigkill.test.cjs',
 'scripts/pf51/tests/pf51-startup-fence.test.cjs',
 'scripts/pf52/tests/pf52-hangar.test.cjs',
 'scripts/pf52/tests/pf52-sqlite-sigkill.test.cjs',
 'scripts/pf53/tests/pf53-paid-hiring.test.cjs',
 'scripts/pf53/tests/pf53-paid-hiring-sigkill.test.cjs'
)
$files = @()
foreach ($path in $paths) {
  $file = Join-Path $repo ($path -replace '/', [IO.Path]::DirectorySeparatorChar)
  if (-not (Test-Path -LiteralPath $file -PathType Leaf)) { throw "[PF46-53] Missing test file: $path" }
  $files += $file
}
& node --test @files
if ($LASTEXITCODE -ne 0) { throw '[PF46-53] FAIL: no native activation authorized' }
Write-Host '[PF46-53] Source/SQLite tests PASS. Native WORK E2E NOT RUN; Personal Fleet remains OFF.'
