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
$expected='c3ea396b6761a0ed3e71ad5b8dd7507f9ae6d69f'
$rev=(& git -C (Split-Path -Parent $CodePath) rev-parse HEAD 2>$null | Out-String).Trim()
if ($rev -ne $expected) { throw "Refusing to patch unknown EveJS revision $rev" }
$patches=@(
  @{ path=(Join-Path $server 'services/_shared/sessionDisconnect.js'); marker='  persistCharacterLogoffState(session);'; injection='  require("../../space/coopRuntimeProbe").observe("disconnect-before-persist", session, null);' },
  @{ path=(Join-Path $server 'space/transitions.js'); marker='  const attachElapsedMs = Date.now() - attachStartedAtMs;'; injection='  require("./coopRuntimeProbe").observe("space-login-attach", session, activeShip, { attached: Boolean(shipEntity) });' },
  @{ path=(Join-Path $server 'space/transitions.js'); marker='  const hydrationQueuedAtMs = Date.now();'; injection='  require("./coopNativeNpcDemo").maybeSpawn(session, activeShip);' },
  @{ path=(Join-Path $server 'space/transitions.js'); marker='  const hydrationQueuedAtMs = Date.now();'; injection='  require("./coopVirtualWorldRuntime").observeSession(session, activeShip);' }
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
# After a successful native wreck item transfer, the upstream refresh updates
# the server-side entity but does not notify the other clients about isEmpty.
# Replace exactly one known call with the same refresh plus slim-item broadcast.
# This does not grant items, bypass access, or change authoritative loot logic.
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

if($Remove) {
  if(Test-Path -LiteralPath $probeTarget){Remove-Item -LiteralPath $probeTarget -Force}
  if(Test-Path -LiteralPath $npcTarget){Remove-Item -LiteralPath $npcTarget -Force}
  if(Test-Path -LiteralPath $combatTarget){Remove-Item -LiteralPath $combatTarget -Force}
  if(Test-Path -LiteralPath $directorTarget){Remove-Item -LiteralPath $directorTarget -Force}
  if(Test-Path -LiteralPath $virtualTarget){Remove-Item -LiteralPath $virtualTarget -Force}
  if(Test-Path -LiteralPath $virtualRuntimeTarget){Remove-Item -LiteralPath $virtualRuntimeTarget -Force}
  if(Test-Path -LiteralPath $materializerTarget){Remove-Item -LiteralPath $materializerTarget -Force}
} else {
  Copy-Item -LiteralPath $probeSource -Destination $probeTarget -Force
  Copy-Item -LiteralPath $npcSource -Destination $npcTarget -Force
  Copy-Item -LiteralPath $combatSource -Destination $combatTarget -Force
  Copy-Item -LiteralPath $directorSource -Destination $directorTarget -Force
  Copy-Item -LiteralPath $virtualSource -Destination $virtualTarget -Force
  Copy-Item -LiteralPath $virtualRuntimeSource -Destination $virtualRuntimeTarget -Force
  Copy-Item -LiteralPath $materializerSource -Destination $materializerTarget -Force
}
Write-Host 'Co-op probe installation complete. Set EVEJS_COOP_EVENTS_FILE within the server container to enable JSONL event output.'
