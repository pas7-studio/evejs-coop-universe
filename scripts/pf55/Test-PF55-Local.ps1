#Requires -Version 5.1
<#
 Read-only local-only PF55 gate. Does not deploy, patch or modify WORK/PLAY.
 NativeWorktree optionally checks source pins and patch applicability without
 applying the patch. Windows SIGKILL tests are SKIPPED; run full gates on Linux.
#>
[CmdletBinding()]
param([string]$NativeWorktree = '')
Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'
$root = Split-Path -Parent $MyInvocation.MyCommand.Path
Push-Location $root
try {
    $node = Get-Command node -ErrorAction Stop
    $python = Get-Command python -ErrorAction Stop
    & $node.Source --test tests/pf55-orders.test.cjs tests/pf55-native-executor.test.cjs tests/pf55-sqlite-sigkill.test.cjs tests/pf75-runtime-durable-contract.test.cjs tests/pf76-order-vs-dock.test.cjs tests/pf78-actor-identity.test.cjs
    if ($LASTEXITCODE -ne 0) { throw 'PF55_NODE_TESTS_FAILED' }
    & $python.Source tests/pf55-patch-builder.test.py
    if ($LASTEXITCODE -ne 0) { throw 'PF55_NATIVE_PATCH_BUILDER_TESTS_FAILED' }
    if ($NativeWorktree -ne '') {
        $tempFile = Join-Path ([System.IO.Path]::GetTempPath()) ('pf55-native-' + [guid]::NewGuid().ToString('N') + '.patch')
        try {
            & $python.Source build_native_owner_patch.py --native-worktree $NativeWorktree --output $tempFile
            if ($LASTEXITCODE -ne 0) { throw 'PF55_NATIVE_SOURCE_PIN_OR_PATCH_CHECK_FAILED' }
            Write-Host 'PF55 native source-pinned patch verified. NOT APPLIED.'
            $oldPF82Work = [Environment]::GetEnvironmentVariable('PF82_NATIVE_WORKTREE')
            try {
                $env:PF82_NATIVE_WORKTREE = (Resolve-Path -LiteralPath $NativeWorktree).Path
                & $node.Source --test integration/pf82-friendly-follow-native.test.cjs
                if ($LASTEXITCODE -ne 0) { throw 'PF82_ORIGINAL_FRIENDLY_FOLLOW_SOURCE_ABI_FAILED' }
            } finally {
                if ($null -eq $oldPF82Work) { Remove-Item Env:PF82_NATIVE_WORKTREE -ErrorAction SilentlyContinue }
                else { $env:PF82_NATIVE_WORKTREE = $oldPF82Work }
            }
            Write-Host 'PF82 original NPC physics FOLLOW source-pin test PASS.'
        } finally { Remove-Item -LiteralPath $tempFile -Force -ErrorAction SilentlyContinue }
    } else {
        Write-Host 'PF55 original native source preflight NOT RUN (no -NativeWorktree).'
    }
    if ($env:OS -eq 'Windows_NT') {
        Write-Warning 'PF55 actual child-process SIGKILL tests SKIPPED on Windows. Run Linux gate.'
    }
    Write-Host 'PF55 SOURCE GATES PASS; NATIVE EVEJS GAMEPLAY NOT VERIFIED; PERSONAL FLEET OFF.'
} finally { Pop-Location }