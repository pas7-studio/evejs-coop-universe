#Requires -Version 5.1
<#
.SYNOPSIS
  Safely synchronize EveJS Personal Fleet PR #350 and run local-only tests.
.DESCRIPTION
  READ-ONLY except optional non-destructive git fetch / fast-forward on the
  coop orchestration checkout. Never changes PLAY/WORK containers or volumes,
  never builds an image, never switches or pulls the running EveJS fork.
.EXAMPLE
  .\scripts\Test-PersonalFleet-Local.ps1 -Sync -WithNative
#>
[CmdletBinding()]
param(
  [switch]$Sync,
  [switch]$WithNative,
  [string]$ForkRoot = 'C:\Games\EveCoop\upstream-evejs',
  [switch]$AllowDirtyReadOnly
)
$ErrorActionPreference='Stop'
$branch='docs/personal-fleet-contract-freeze-v1-4-20261104'
$repoRoot=(Resolve-Path (Join-Path $PSScriptRoot '..')).Path
function Run-Command([string]$label,[string]$workdir,[string]$exe,[string[]]$commandArgs){
  Write-Host "=== $label ==="
  Push-Location -LiteralPath $workdir
  try {
    & $exe @commandArgs
    if ($LASTEXITCODE -ne 0) { throw "$label FAILED (exit $LASTEXITCODE)" }
  } finally { Pop-Location }
}
function Git-Output([string]$dir,[string[]]$args){
  $out=& git -C $dir @args
  if ($LASTEXITCODE -ne 0) { throw "git failed: $($args -join ' ')" }
  return (($out | Out-String).Trim())
}
if (-not (Get-Command git -ErrorAction SilentlyContinue)) { throw 'git is required' }
if (-not (Get-Command node -ErrorAction SilentlyContinue)) { throw 'Node.js >=22 is required' }
$nodeMajor=[int]((& node -p 'process.versions.node.split(".")[0]').Trim())
if ($nodeMajor -lt 22) { throw 'Node.js 22+ required' }
if ((Git-Output $repoRoot @('rev-parse','--is-inside-work-tree')) -ne 'true'){
  throw "Orchestration checkout is not git: $repoRoot"
}
$origin=Git-Output $repoRoot @('remote','get-url','origin')
if ($origin -notmatch 'pas7-studio/evejs-coop-universe(\.git)?$'){
  throw "Unexpected orchestration origin: $origin"
}
$current=Git-Output $repoRoot @('branch','--show-current')
if ($current -ne $branch) { throw "Wrong branch: $current. First switch to $branch manually." }
$dirty=Git-Output $repoRoot @('status','--porcelain')
if ($dirty -and (-not $AllowDirtyReadOnly -or $Sync)) {
  throw "Uncommitted changes exist. Preserve them; refuse sync/test by default."
}
if (-not (Test-Path -LiteralPath $ForkRoot -PathType Container)){
  throw "Native fork checkout missing: $ForkRoot"
}
$nativeOrigin=Git-Output $ForkRoot @('remote','get-url','origin')
if ($nativeOrigin -notmatch 'pas7-studio/EveJS(\.git)?$'){
  throw "Unexpected native fork origin: $nativeOrigin"
}
$forkBranch=Git-Output $ForkRoot @('branch','--show-current')
if ($forkBranch -ne 'coop/pas7std'){
  throw "Native fork is on $forkBranch, not coop/pas7std. Refusing to change branch."
}
$engine=Join-Path $ForkRoot 'Code\server\src\space\coopGameStoreAtomic.js'
if (-not (Test-Path -LiteralPath $engine -PathType Leaf)){
  throw "Native GameStore code missing: $engine"
}
if ($Sync) {
  if (Git-Output $ForkRoot @('status','--porcelain')) {
    throw 'Native fork dirty; refusing sync. No changes were overwritten.'
  }
  Run-Command 'Fetch Personal Fleet branch' $repoRoot 'git' @('fetch','origin',$branch)
  Run-Command 'Fast-forward Personal Fleet branch' $repoRoot 'git' @('merge','--ff-only',"origin/$branch")
  # Native fork may back the owner's PLAY; fetch ONLY, never switch, merge,
  # reset, rebuild or restart the fork automatically.
  Run-Command 'Fetch engine fork (no working-tree modifications)' $ForkRoot 'git' @('fetch','origin','coop/pas7std')
  $head=Git-Output $ForkRoot @('rev-parse','HEAD')
  $remote=Git-Output $ForkRoot @('rev-parse','FETCH_HEAD')
  if ($head -ne $remote){
    Write-Warning 'Native fork differs from origin/coop/pas7std; NOT pulling it. Manual merge after inspecting local work required.'
  }
}
$revision=Git-Output $repoRoot @('rev-parse','HEAD')
Write-Host "PF_TEST_REVISION=$revision"
$all=@(Get-ChildItem (Join-Path $repoRoot 'scripts\lib') -Filter 'personal-fleet-*.cjs' -File)
$tests=@(Get-ChildItem (Join-Path $repoRoot 'tests') -Filter 'coop-personal-fleet-*.test.*' -File)
if ($all.Count -lt 10 -or $tests.Count -lt 11){
  throw "Incomplete branch: $($all.Count) modules / $($tests.Count) tests; refusing partial PASS"
}
foreach($src in @($all)+@($tests)){
  Run-Command "Syntax: $($src.Name)" $repoRoot 'node' @('--check',$src.FullName)
}
$isWindows=[System.Environment]::OSVersion.Platform -eq [PlatformID]::Win32NT
$regularTests=@($tests | Where-Object {$_.Name -ne 'coop-personal-fleet-sqlite-crash.test.cjs'})
$crashTest=Join-Path $repoRoot 'tests\\coop-personal-fleet-sqlite-crash.test.cjs'
if(-not (Test-Path -LiteralPath $crashTest -PathType Leaf)){
  throw 'PF15 SQLite crash test missing; refusing partial PASS'
}
Run-Command 'Real Node reference contract suite' $repoRoot 'node' (@('--test')+@($regularTests | ForEach-Object {$_.FullName}))
Write-Host 'PF_REFERENCE_CONTRACTS_PASS'
if(-not $isWindows){
  Run-Command 'Real SQLite SIGKILL PF15' $repoRoot 'node' @('--test',$crashTest)
  Write-Host 'PF15_SQLITE_SIGKILL_PASS'
}
if($WithNative){
  if([System.Environment]::OSVersion.Platform -ne [PlatformID]::Win32NT){
    throw 'Native SIGKILL gate requires Linux/WSL; run from Windows with WSL2 installed'
  }
  if(-not (Get-Command wsl.exe -ErrorAction SilentlyContinue)){
    throw 'WSL2 required for native Linux SIGKILL tests'
  }
  $winRepo=(Resolve-Path $repoRoot).Path
  $winFork=(Resolve-Path $ForkRoot).Path
  $linuxRepo=(& wsl.exe -- wslpath -a $winRepo | Out-String).Trim()
  if($LASTEXITCODE -ne 0 -or -not $linuxRepo){throw 'WSL cannot access orchestration checkout'}
  $linuxFork=(& wsl.exe -- wslpath -a $winFork | Out-String).Trim()
  if($LASTEXITCODE -ne 0 -or -not $linuxFork){throw 'WSL cannot access native fork'}
  $linuxCrash="$linuxRepo/tests/coop-personal-fleet-sqlite-crash.test.cjs"
  & wsl.exe -- env NODE_NO_WARNINGS=1 node --test $linuxCrash
  if($LASTEXITCODE -ne 0){throw "PF15_SQLITE_SIGKILL_FAILED exit $LASTEXITCODE"}
  Write-Host 'PF15_SQLITE_SIGKILL_PASS'
  $linuxTest="$linuxRepo/tests/native/coop-personal-fleet-gamestore.native.test.cjs"
  & wsl.exe -- env "EVEJS_NATIVE_FORK_ROOT=$linuxFork" NODE_NO_WARNINGS=1 node --test $linuxTest
  if($LASTEXITCODE -ne 0){throw "PF_NATIVE_SQLITE_GATE_FAILED exit $LASTEXITCODE"}
  Write-Host 'PF_NATIVE_SQLITE_GATE_PASS'
}else{
  Write-Warning 'Native fork SIGKILL gate NOT RUN. Re-run with -WithNative and WSL2 Node 22+.'
}
Write-Host 'PF_CHECKS_COMPLETE; this is NOT proof of in-game NPC fleet functionality'
