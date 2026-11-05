#Requires -Version 5.1
<# PF56 local-only tests and read-only source preflight; NO PLAY/WORK mutation #>
[CmdletBinding()]
param([string]$NativeWorktree = '')
Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'
$root = $PSScriptRoot
Push-Location $root
try {
    $node = (Get-Command node -ErrorAction Stop).Source
    $tests = @(
        'tests/pf56-return-dock.test.cjs',
        'tests/pf56-native-api.test.cjs',
        'tests/pf56-sqlite-sigkill.test.cjs'
    )
    & $node --test $tests
    if ($LASTEXITCODE -ne 0) { throw 'PF56_NODE_TESTS_FAILED' }
    if ($NativeWorktree -ne '') {
        $native = (Resolve-Path -LiteralPath $NativeWorktree -ErrorAction Stop).Path
        $pins = [ordered]@{
            'Code/server/src/services/inventory/itemStore.js' = 'e992d56ee9cff1911d54247bf46d44d01e5d8060'
            'Code/server/src/space/npc/npcRuntime.js' = '8ee3d4f82db1600094df8de1060a9aa8e575af1a'
            'Code/server/src/space/npc/nativeNpcService.js' = 'ca039daaaad2839d17f7109de2f3834cec0373a8'
            'Code/server/src/space/npc/nativeNpcStore.js' = '95724ab4537683e7ee933bc3149d0a891082ce7e'
            'Code/server/src/space/coopNativeStationArrival.js' = '308af8e09def7fdba7fd248b3eba65f6054789ea'
            'Code/server/src/space/transitions.js' = 'f53a3439fd361294a52f733085f0455c79cc1a7b'
            'Code/server/src/space/coopGameStoreAtomic.js' = '2b28b48145f3fbc989ce7346384487ee75e52280'
            'Code/server/src/space/coopNpcOrderBridge.js' = 'c0f93af3e5a67703a84dc03cab8da29a65afdf3b'
        }
        foreach ($p in $pins.Keys) {
            $onDisk = Join-Path $native $p
            if (-not (Test-Path -LiteralPath $onDisk -PathType Leaf)) {
                throw ('PF56_NATIVE_SOURCE_MISSING: ' + $p)
            }
            $actual = ((& git -C $native hash-object -- $p) | Out-String).Trim()
            if ($LASTEXITCODE -ne 0 -or $actual -ne $pins[$p]) {
                throw ('PF56_NATIVE_SOURCE_PIN_CHANGED: ' + $p + ' expected=' + $pins[$p] + ' actual=' + $actual)
            }
            Write-Host ('PIN OK ' + $p)
        }
        Write-Host 'All checked native source blobs match; NO original engine patch applied.'
    } else {
        Write-Host 'ORIGINAL NATIVE SOURCE PRE-FLIGHT NOT RUN (pass -NativeWorktree).'
    }
    if ($env:OS -eq 'Windows_NT') {
        Write-Warning 'SIGKILL scenarios SKIPPED on Windows: rerun on Linux before WORK.'
    }
    Write-Host 'PF56 LOCAL CANDIDATE TESTED. Actual source native dock and two-player WORK E2E NOT RUN.'
    Write-Host 'PF42 exclusion stays ON. Personal Fleet OFF. Do not deploy PLAY.'
} finally { Pop-Location }
