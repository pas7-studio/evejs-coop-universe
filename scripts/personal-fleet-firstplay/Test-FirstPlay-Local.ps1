#Requires -Version 5.1
# CONTRACT/WORK REVIEW ONLY. Does not enable, boot, deploy, or touch PLAY.
[CmdletBinding()]
param([string]$NativeCheckout='')
Set-StrictMode -Version Latest
$ErrorActionPreference='Stop'
$root=(Resolve-Path -LiteralPath $PSScriptRoot).Path
$node=(Get-Command node -ErrorAction Stop).Source
$python=(Get-Command python -ErrorAction Stop).Source
$major=[int](& $node -p "process.versions.node.split('.')[0]")
if($LASTEXITCODE -ne 0 -or $major -lt 22){throw 'PF_FIRSTPLAY_NODE_22_REQUIRED'}
& $python -c "import sys;assert sys.version_info >= (3,10)"
if($LASTEXITCODE -ne 0){throw 'PF_FIRSTPLAY_PYTHON_310_REQUIRED'}
$manifest=Join-Path $root 'SHA256SUMS.txt'
if(-not(Test-Path -LiteralPath $manifest -PathType Leaf)){throw 'PF_FIRSTPLAY_MANIFEST_MISSING'}
$expected=@(Get-Content -LiteralPath $manifest | Where-Object { $_.Trim() -ne '' })
$actual=@()
foreach($line in $expected){
 if($line -notmatch '^([a-f0-9]{64})  (native|tests|tools)/[A-Za-z0-9._/-]+$'){
  throw 'PF_FIRSTPLAY_MANIFEST_INVALID'
 }
 $name=$line.Substring(66)
 $file=Join-Path $root $name
 if(-not(Test-Path -LiteralPath $file -PathType Leaf)){throw ('PF_FIRSTPLAY_SOURCE_MISSING: '+$name)}
 $src=[System.IO.File]::ReadAllText($file,[System.Text.Encoding]::UTF8).Replace(([string][char]13+[char]10),[string][char]10)
 $sha=[System.Security.Cryptography.SHA256]::Create()
 try{
  $digest=[System.BitConverter]::ToString($sha.ComputeHash(
   [System.Text.Encoding]::UTF8.GetBytes($src))).Replace('-','').ToLowerInvariant()
 }finally{$sha.Dispose()}
 $actual+=($digest+'  '+$name)
}
if(($expected -join [string][char]10) -cne ($actual -join [string][char]10)){
 throw 'PF_FIRSTPLAY_TESTED_SOURCE_HASH_DRIFT'
}
$tests=Join-Path $root 'tests'
$prior=[Environment]::GetEnvironmentVariable('PYTHONDONTWRITEBYTECODE','Process')
try{
 $env:PYTHONDONTWRITEBYTECODE='1'
 & $node --test --test-concurrency=1 (Join-Path $tests 'personal-fleet-chat-gateway.test.cjs') (Join-Path $tests 'personal-fleet-work-command-owner.test.cjs') (Join-Path $tests 'personal-fleet-original-offers.test.cjs') (Join-Path $tests 'personal-fleet-original-source-bindings.test.cjs') (Join-Path $tests 'personal-fleet-original-work-bootstrap.test.cjs') (Join-Path $tests 'personal-fleet-original-wallet-authority.test.cjs') (Join-Path $tests 'personal-fleet-original-order-witness.test.cjs') (Join-Path $tests 'personal-fleet-original-order-executor.test.cjs') (Join-Path $tests 'personal-fleet-original-durable-order-ack.test.cjs') (Join-Path $tests 'personal-fleet-original-dock-completion.test.cjs') (Join-Path $tests 'personal-fleet-original-terminal-dock-sources.test.cjs') (Join-Path $tests 'personal-fleet-original-dock-coordinator.test.cjs')
 if($LASTEXITCODE -ne 0){throw 'PF_FIRSTPLAY_NODE_TEST_FAILED'}
 & $python -m unittest discover -s $tests -p 'test_*.py' -v
 if($LASTEXITCODE -ne 0){throw 'PF_FIRSTPLAY_PYTHON_TEST_FAILED'}
}finally{
 [Environment]::SetEnvironmentVariable('PYTHONDONTWRITEBYTECODE',$prior,'Process')
}
if($NativeCheckout){
 $native=(Resolve-Path -LiteralPath $NativeCheckout -ErrorAction Stop).Path
 $nativeFile=Join-Path $native 'Code/server/src/services/chat/chatCommands.js'
 if(-not(Test-Path -LiteralPath $nativeFile)){throw 'PF_FIRSTPLAY_NATIVE_CHAT_MISSING'}
 $git=(Get-Command git -ErrorAction Stop).Source
 $actualBlob=(& $git -C $native hash-object 'Code/server/src/services/chat/chatCommands.js').Trim()
 if($LASTEXITCODE -ne 0 -or $actualBlob -cne '5f4dd4d34a398dde3120e8640a7058d2bd3bb038'){
  throw 'PF_FIRSTPLAY_NATIVE_CHAT_SOURCE_PIN_DRIFT'
 }
 $sourcePins=@{
  'Code/server/src/space/npc/npcData.js'='8046ced2336923ec6801c954f67aba300a65e127'
  'Code/server/src/services/corporation/corporationState.js'='2abe99b533d02d731d46d08965c3dcdbf6a6d3d1'
  'Code/server/src/services/corporation/corporationRuntimeState.js'='1e87597539389567716e75de565519c9cb19a977'
  'Code/server/src/services/chat/sessionRegistry.js'='01892cb8f6e35ef46268eae5f2909fd96c4a2a51'
  'Code/server/src/services/structure/structureLocation.js'='0e12ae00721359d526c4453529c81a16f337df22'
  'Code/server/src/services/_shared/stationStaticData.js'='15512a5320dc7979f3bab90cab0281d9fff15332'
  'Code/server/src/space/runtime.js'='0de66d2ab0499bfcff2b1bb57176e775c9b8df22'
  'Code/server/src/gameStore/sqliteStore.js'='d851fb5a84added2d4527c34407879e8a009bb74'
  'Code/server/src/services/account/plexVaultLogState.js'='62a03b8578a390f5614fc67b6693ffa74b2b2ee5'
  'Code/server/src/services/account/walletState.js'='ef4799d896ce8dbb854e75b810057b1208932e13'
  'Code/server/src/services/corporation/corpWalletState.js'='42f7f3ba3d1c66824ce566523df2da19d9da26cf'
  'Code/server/src/space/coopNpcOrderArbiter.js'='aa5447ada4015b1ac8262d14bae5cd975af6ec6b'
  'Code/server/src/space/coopNpcOrderBridge.js'='c0f93af3e5a67703a84dc03cab8da29a65afdf3b'
  'Code/server/src/space/npc/npcRuntime.js'='8ee3d4f82db1600094df8de1060a9aa8e575af1a'
  'Code/server/src/space/npc/npcRegistry.js'='990197ea61d89ddc3f22450840eb047bc548278c'
  'Code/server/src/space/npc/nativeNpcStore.js'='95724ab4537683e7ee933bc3149d0a891082ce7e'
 }
 foreach($name in $sourcePins.Keys){
  $seen=(& $git -C $native hash-object $name).Trim()
  if($LASTEXITCODE -ne 0 -or $seen -cne $sourcePins[$name]){
   throw ('PF_FIRSTPLAY_NATIVE_SOURCE_PIN_DRIFT: '+$name)
  }
 }
 Write-Host 'Original EveJS chat, NPC, wallet, session, station, runtime and SQLite source pins PASS (read-only).'

}else{
 Write-Warning 'Real native source pin NOT RUN: supply -NativeCheckout.'
}
Write-Host 'PF_FIRSTPLAY_342_CONTRACT_TESTS_PASS. WORK and client gameplay NOT RUN.'
