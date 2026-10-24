#Requires -Version 5.1
[CmdletBinding()]
param(
  [string]$CodePath = 'C:\Games\EveCoop\upstream-evejs\Code',
  [switch]$Remove
)
$ErrorActionPreference='Stop'
$server=Join-Path $CodePath 'server/src'
$probeTarget=Join-Path $server 'space/coopRuntimeProbe.js'
$probeSource=Join-Path $PSScriptRoot '../integration/coopRuntimeProbe.cjs'
$npcSource=Join-Path $PSScriptRoot '../integration/coopNativeNpcDemo.cjs'
$npcTarget=Join-Path $server 'space/coopNativeNpcDemo.js'
$combatSource=Join-Path $PSScriptRoot '../integration/coopCombatProbe.cjs'
$combatTarget=Join-Path $server 'space/coopCombatProbe.js'
$directorSource=Join-Path $PSScriptRoot '../integration/coopEncounterDirector.cjs'
$directorTarget=Join-Path $server 'space/coopEncounterDirector.js'
$virtualSource=Join-Path $PSScriptRoot '../integration/coopVirtualWorld.cjs'
$virtualTarget=Join-Path $server 'space/coopVirtualWorld.js'
$virtualRuntimeSource=Join-Path $PSScriptRoot '../integration/coopVirtualWorldRuntime.cjs'
$virtualRuntimeTarget=Join-Path $server 'space/coopVirtualWorldRuntime.js'
$materializerSource=Join-Path $PSScriptRoot '../integration/coopNpcMaterializer.cjs'
$materializerTarget=Join-Path $server 'space/coopNpcMaterializer.js'
$identitySource=Join-Path $PSScriptRoot '../integration/coopIdentityRegistry.cjs'
$identityTarget=Join-Path $server 'space/coopIdentityRegistry.js'
$economySource=Join-Path $PSScriptRoot '../integration/coopVirtualEconomy.cjs'
$economyTarget=Join-Path $server 'space/coopVirtualEconomy.js'
$lossSource=Join-Path $PSScriptRoot '../integration/coopNpcLossBridge.cjs'
$lossTarget=Join-Path $server 'space/coopNpcLossBridge.js'
$factionSource=Join-Path $PSScriptRoot '../integration/coopFactionDirector.cjs'
$factionTarget=Join-Path $server 'space/coopFactionDirector.js'
$patrolSource=Join-Path $PSScriptRoot '../integration/coopFactionPatrolRuntime.cjs'
$patrolTarget=Join-Path $server 'space/coopFactionPatrolRuntime.js'
$ordersSource=Join-Path $PSScriptRoot '../integration/coopPatrolOrders.cjs'
$ordersTarget=Join-Path $server 'space/coopPatrolOrders.js'
$topologySource=Join-Path $PSScriptRoot '../integration/coopNpcTopology.cjs'
$topologyTarget=Join-Path $server 'space/coopNpcTopology.js'
$navigatorSource=Join-Path $PSScriptRoot '../integration/coopPatrolNavigator.cjs'
$navigatorTarget=Join-Path $server 'space/coopPatrolNavigator.js'
$presentationSource=Join-Path $PSScriptRoot '../integration/coopNpcPresentation.cjs'
$presentationTarget=Join-Path $server 'space/coopNpcPresentation.js'
$presenceSource=Join-Path $PSScriptRoot '../integration/coopSessionPresence.cjs'
$presenceTarget=Join-Path $server 'space/coopSessionPresence.js'
$civilianSource=Join-Path $PSScriptRoot '../integration/coopCivilianOrders.cjs'
$civilianTarget=Join-Path $server 'space/coopCivilianOrders.js'
$expected='c3ea396b6761a0ed3e71ad5b8dd7507f9ae6d69f'
$rev=(& git -C (Split-Path -Parent $CodePath) rev-parse HEAD 2>$null | Out-String).Trim()
if ($rev -ne $expected) { throw "Refusing to patch unknown EveJS revision $rev" }
$patches=@(
  @{ path=(Join-Path $server 'services/_shared/sessionDisconnect.js'); marker='  persistCharacterLogoffState(session);'; injection='  require("../../space/coopRuntimeProbe").observe("disconnect-before-persist", session, null);' },
  @{ path=(Join-Path $server 'space/transitions.js'); marker='  const attachElapsedMs = Date.now() - attachStartedAtMs;'; injection='  require("./coopRuntimeProbe").observe("space-login-attach", session, activeShip, { attached: Boolean(shipEntity) });' },
  @{ path=(Join-Path $server 'space/transitions.js'); marker='  const hydrationQueuedAtMs = Date.now();'; injection='  require("./coopNativeNpcDemo").maybeSpawn(session, activeShip);' },
  @{ path=(Join-Path $server 'space/transitions.js'); marker='  const hydrationQueuedAtMs = Date.now();'; injection='  require("./coopVirtualWorldRuntime").observeSession(session, activeShip);' },
  @{ path=(Join-Path $server 'network/tcp/index.js'); marker='      tidiAutoscaler.init();'; injection='      try { require("../../space/coopVirtualWorldRuntime").start(); } catch (error) { console.warn("[CoopVirtualWorld] startup", error.message); }' }
)
foreach($p in $patches) {
  if(-not (Test-Path -LiteralPath $p.path)){throw "Missing upstream file: $($p.path)"}
  $original=[System.IO.File]::ReadAllText($p.path)
  if(-not $original.Contains($p.marker)){throw "Unexpected upstream layout in $($p.path)"}
  if(-not $Remove -and -not $original.Contains($p.injection)) {
    $updated=$original.Replace($p.marker,$p.marker+[Environment]::NewLine+$p.injection)
    [System.IO.File]::WriteAllText($p.path,$updated,[System.Text.UTF8Encoding]::new($false))
    Write-Host "[INSTALLED] $($p.path)"
  } elseif($Remove -and $original.Contains($p.injection)) {
    $updated=$original.Replace($p.marker+[Environment]::NewLine+$p.injection,$p.marker)
    [System.IO.File]::WriteAllText($p.path,$updated,[System.Text.UTF8Encoding]::new($false))
    Write-Host "[REMOVED] $($p.path)"
  } else { Write-Host "[UNCHANGED] $($p.path)" }
}
# Add entry points for real undock and stargate arrival, not only login-in-space.
# Each marker is unique in the pinned transitions.js and the patch is reversible.
$transitions=Join-Path $server 'space/transitions.js'
$transitionHooks=@(
  @{ marker='    queuePostSpaceAttachFittingHydration(session, moveResult.data.itemID, {'; injection='    require("./coopSessionPresence").schedule(session, moveResult.data, "undock");' },
  @{ marker='  queuePostSpaceAttachFittingHydration(session, moveResult.data && moveResult.data.itemID, {'; injection='  require("./coopSessionPresence").schedule(session, moveResult.data, "stargate");' }
)
foreach($entry in $transitionHooks){
  $source=[System.IO.File]::ReadAllText($transitions)
  if(-not $source.Contains($entry.marker)){throw "Unexpected pinned EveJS transition layout: $($entry.marker)"}
  $insert=$entry.injection+[Environment]::NewLine
  if($Remove){
    $source=$source.Replace($insert,'')
  } elseif(-not $source.Contains($entry.injection)){
    if($source.Split(@($entry.marker),[System.StringSplitOptions]::None).Count -ne 2){throw 'Ambiguous transition anchor; refusing installation'}
    $source=$source.Replace($entry.marker,$insert+$entry.marker)
  }
  [System.IO.File]::WriteAllText($transitions,$source,[System.Text.UTF8Encoding]::new($false))
}
# After a successful native wreck item transfer, the upstream refresh updates
# the server-side entity but does not notify the other clients about isEmpty.
# Replace exactly one known call with the same refresh plus slim-item broadcast.
# This does not grant items, bypass access, or change authoritative loot logic.
# Native destruction callback: executed only after successful wreck spawn.
# It records the confirmed loss, without changing EveJS damage/loot flow.
$hookMarker='  try {'+[Environment]::NewLine+'    const dungeonUniverseSiteService = require(path.join('
$hookLine='  try { require("../coopVirtualWorldRuntime").confirmedNativeNpcWreck(normalizedSystemID, entityID, wreckRecord.wreckID); } catch (_coopError) { /* optional integration */ }'
$wreckFile=Join-Path $server 'space/npc/nativeNpcWreckService.js'
$before='  refreshNativeWreckRuntimeEntity(wreckRecord.systemID, wreckRecord.wreckID);'
$after='  refreshNativeWreckRuntimeEntity(wreckRecord.systemID, wreckRecord.wreckID, { broadcast: true });'
if(-not (Test-Path -LiteralPath $wreckFile)){throw "Missing upstream wreck file: $wreckFile"}
$wreckText=[System.IO.File]::ReadAllText($wreckFile)
$from=if($Remove){$after}else{$before}
$to=if($Remove){$before}else{$after}
if($wreckText.Contains($from)){
  if($wreckText.Split(@($from),[System.StringSplitOptions]::None).Count -ne 2){throw 'Ambiguous wreck refresh call; refuse to patch'}
  $wreckText=$wreckText.Replace($from,$to)
  [System.IO.File]::WriteAllText($wreckFile,$wreckText,[System.Text.UTF8Encoding]::new($false))
  Write-Host "[WRECK SYNC] $wreckFile"
} elseif(-not $wreckText.Contains($to)){throw 'Unknown wreck refresh implementation; refuse to patch'}

$wreckText=[System.IO.File]::ReadAllText($wreckFile)
if(-not $wreckText.Contains($hookMarker)){throw 'Unknown native wreck destruction callback location'}
if($Remove) {
  $wreckText=$wreckText.Replace($hookLine+[Environment]::NewLine,'')
} elseif(-not $wreckText.Contains($hookLine)) {
  $wreckText=$wreckText.Replace($hookMarker,$hookLine+[Environment]::NewLine+$hookMarker)
}
[System.IO.File]::WriteAllText($wreckFile,$wreckText,[System.Text.UTF8Encoding]::new($false))
if($Remove) {
  if(Test-Path -LiteralPath $probeTarget){Remove-Item -LiteralPath $probeTarget -Force}
  if(Test-Path -LiteralPath $npcTarget){Remove-Item -LiteralPath $npcTarget -Force}
  if(Test-Path -LiteralPath $combatTarget){Remove-Item -LiteralPath $combatTarget -Force}
  if(Test-Path -LiteralPath $directorTarget){Remove-Item -LiteralPath $directorTarget -Force}
  if(Test-Path -LiteralPath $virtualTarget){Remove-Item -LiteralPath $virtualTarget -Force}
  if(Test-Path -LiteralPath $virtualRuntimeTarget){Remove-Item -LiteralPath $virtualRuntimeTarget -Force}
  if(Test-Path -LiteralPath $materializerTarget){Remove-Item -LiteralPath $materializerTarget -Force}
  if(Test-Path -LiteralPath $identityTarget){Remove-Item -LiteralPath $identityTarget -Force}
  if(Test-Path -LiteralPath $economyTarget){Remove-Item -LiteralPath $economyTarget -Force}
  if(Test-Path -LiteralPath $lossTarget){Remove-Item -LiteralPath $lossTarget -Force}
  if(Test-Path -LiteralPath $factionTarget){Remove-Item -LiteralPath $factionTarget -Force}
  if(Test-Path -LiteralPath $patrolTarget){Remove-Item -LiteralPath $patrolTarget -Force}
  if(Test-Path -LiteralPath $ordersTarget){Remove-Item -LiteralPath $ordersTarget -Force}
  if(Test-Path -LiteralPath $topologyTarget){Remove-Item -LiteralPath $topologyTarget -Force}
  if(Test-Path -LiteralPath $navigatorTarget){Remove-Item -LiteralPath $navigatorTarget -Force}
  if(Test-Path -LiteralPath $presentationTarget){Remove-Item -LiteralPath $presentationTarget -Force}
  if(Test-Path -LiteralPath $presenceTarget){Remove-Item -LiteralPath $presenceTarget -Force}
  if(Test-Path -LiteralPath $civilianTarget){Remove-Item -LiteralPath $civilianTarget -Force}
} else {
  Copy-Item -LiteralPath $probeSource -Destination $probeTarget -Force
  Copy-Item -LiteralPath $npcSource -Destination $npcTarget -Force
  Copy-Item -LiteralPath $combatSource -Destination $combatTarget -Force
  Copy-Item -LiteralPath $directorSource -Destination $directorTarget -Force
  Copy-Item -LiteralPath $virtualSource -Destination $virtualTarget -Force
  Copy-Item -LiteralPath $virtualRuntimeSource -Destination $virtualRuntimeTarget -Force
  Copy-Item -LiteralPath $materializerSource -Destination $materializerTarget -Force
  Copy-Item -LiteralPath $identitySource -Destination $identityTarget -Force
  Copy-Item -LiteralPath $economySource -Destination $economyTarget -Force
  Copy-Item -LiteralPath $lossSource -Destination $lossTarget -Force
  Copy-Item -LiteralPath $factionSource -Destination $factionTarget -Force
  Copy-Item -LiteralPath $patrolSource -Destination $patrolTarget -Force
  Copy-Item -LiteralPath $ordersSource -Destination $ordersTarget -Force
  Copy-Item -LiteralPath $topologySource -Destination $topologyTarget -Force
  Copy-Item -LiteralPath $navigatorSource -Destination $navigatorTarget -Force
  Copy-Item -LiteralPath $presentationSource -Destination $presentationTarget -Force
  Copy-Item -LiteralPath $presenceSource -Destination $presenceTarget -Force
  Copy-Item -LiteralPath $civilianSource -Destination $civilianTarget -Force
}
Write-Host 'Co-op probe installation complete. Set EVEJS_COOP_EVENTS_FILE within the server container to enable JSONL event output.'
