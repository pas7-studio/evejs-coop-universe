import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
const read=(name)=>fs.readFileSync(new URL("../"+name,import.meta.url),"utf8");
test("native EX-03B scan runs only in same opt-in A-Life expedition cycle",()=>{
 const runtime=read("integration/coopVirtualWorldRuntime.cjs");
 assert.match(runtime,/EVEJS_COOP_NPC_PROBE_SCAN!=="1"/);
 assert.match(runtime,/EVEJS_COOP_NPC_EXPEDITIONS==="1"/);
 assert.match(runtime,/scanRuntime\.buildSignatureScanResults\(systemID,probes\)/);
 assert.match(runtime,/store\.listNativeCargoForEntity\(id\)/);
 assert.match(runtime,/store\.listNativeModulesForEntity\(id\)/);
 assert.match(runtime,/signatures\.listSystemSignatureSites\(systemID\)/);
 const blockStart=runtime.indexOf("timer=setInterval(()=>worldPhaseCoordinator.tick(runPhase=>{");
 const blockEnd=runtime.indexOf(" }),30000);",blockStart);
 assert.ok(blockStart>0&&blockEnd>blockStart);
 const block=runtime.slice(blockStart,blockEnd);
 assert.equal([...block.matchAll(/runPhase\("native-expeditions"/g)].length,1);
});
test("EX-03B never grants fake probes, free ISK or all-signatures scan",()=>{
 const hardware=read("integration/coopNpcProbeHardware.cjs");
 const scanner=read("integration/coopNpcProbeScanEvidence.cjs");
 for(const module of [hardware,scanner]){
  assert.doesNotMatch(module,/launchCharacterProbes\s*\(/);
  assert.doesNotMatch(module,/buildResolvedSignatureScanResults\s*\(/);
  assert.doesNotMatch(module,/grantItemToCharacterLocation\s*\(/);
  assert.doesNotMatch(module,/upsertNativeCargo\s*\(/);
 }
 assert.match(scanner,/flight\.probeID!==row\.cargoID/);
 assert.match(scanner,/scanNativeResults\(scene\.systemID,new Map/);
 assert.match(scanner,/entry\.certainty!==1/);
});
test("a remote scan is rechecked against live site identity before NPC native warp",()=>{
 const director=read("integration/coopNpcExpeditionDirector.cjs");
 assert.match(director,/source:"NATIVE_PROBE_SCAN"/);
 assert.match(director,/stamp!==proof\.siteFingerprint/);
 assert.match(director,/nativeScanCertainty!==1/);
 assert.match(director,/originalProbeCount<4/);
 assert.match(director,/tip\.source==="NATIVE_PROBE_SCAN"/);
 assert.match(director,/const matches=listNativeSites\(tip\.systemID\)/);
 assert.match(director,/warpToPoint\(p\.entityID/);
});
test("new native source modules are deployed with original overlay",()=>{
 const source=read("scripts/overlay-spec.cjs");
 assert.match(source,/"coopNpcExpeditionDirector".*"coopNpcProbeHardware","coopNpcProbeScanEvidence"/);
});
test("probe evidence remains explicit opt-in, requires exploration and A-Life",()=>{
 const deploy=read("scripts/Deploy-Coop-RuntimeProbe.ps1");
 assert.match(deploy,/\[switch\]\$EnableNpcProbeScan/);
 assert.match(deploy,/-not \$EnableNpcExpeditions -or -not \$EnableNativeExploration/);
 assert.match(deploy,/EVEJS_COOP_NPC_PROBE_SCAN: '1'/);
 assert.doesNotMatch(deploy,/if \(\$LivingCoop\) \{[^}]*EVEJS_COOP_NPC_PROBE_SCAN/s);
});

test("EX-03B2 original cargo debit is flushed before materializing the physical probe",()=>{
 const flight=read("integration/coopNativeNpcProbeFlight.cjs");
 const debit=flight.indexOf("persisted=upsertNativeCargo(changed)");
 const flush=flight.indexOf("flushed=flushNpcCargo()");
 const spawn=flight.indexOf("const physical=materialize(ctx,changed,now)");
 assert.ok(debit>=0&&flush>debit&&spawn>flush);
 assert.match(flight,/probeID:row\.cargoID/);
 assert.match(flight,/quantity:0,deployedProbe/);
 assert.match(flight,/refreshNativeCargoProjection/);
 assert.doesNotMatch(flight,/launchCharacterProbes\s*\(/);
 assert.doesNotMatch(flight,/grantItemToCharacterLocation\s*\(/);
});
test("EX-03B2 is separately disabled unless explicit native probe launch flag",()=>{
 const runtime=read("integration/coopVirtualWorldRuntime.cjs");
 const deploy=read("scripts/Deploy-Coop-RuntimeProbe.ps1");
 const overlay=read("scripts/overlay-spec.cjs");
 assert.match(runtime,/EVEJS_COOP_NPC_PROBE_LAUNCH==="1"/);
 assert.match(runtime,/gameStore\.flushTableSync\("npcCargo"\)/);
 assert.match(runtime,/ship\.nativeCargoItems=cargo\.filter/);
 assert.match(deploy,/\[switch\]\$EnableNpcProbeLaunch/);
 assert.match(deploy,/-not \$EnableNpcProbeScan/);
 assert.match(deploy,/EVEJS_COOP_NPC_PROBE_LAUNCH: '1'/);
 assert.match(overlay,/"coopNpcProbeScanEvidence","coopNativeNpcProbeFlight"/);
});

test("EX-03B3 original NPC cargo unitization is pinned-source opt-in only",()=>{
 const installer=read("scripts/patch-evejs-coop.cjs");
 const deploy=read("scripts/Deploy-Coop-RuntimeProbe.ps1");
 const patch=read("scripts/coop-npc-probe-loadout-split-patch.cjs");
 assert.match(installer,/coop-npc-probe-loadout-split-patch\.cjs/);
 assert.match(deploy,/\[switch\]\$EnableNpcProbeLoadoutSplit/);
 assert.match(deploy,/if \(\$EnableNpcProbeLoadoutSplit -and -not \$EnableNpcProbeLaunch\)/);
 assert.match(deploy,/EVEJS_COOP_NPC_PROBE_LOADOUT_SPLIT: '1'/);
 assert.match(patch,/EVEJS_COOP_NPC_PROBE_LOADOUT_SPLIT === "1"/);
 assert.match(patch,/EVEJS_COOP_NPC_PROBE_LAUNCH === "1"/);
 assert.match(patch,/quantity: splitNativeScannerCharges \? 1 : quantityPerModule/);
 assert.match(patch,/const originalUnits = splitNativeScannerCharges \? quantityPerModule : 1/);
});

test("EX-03B4 blind probe sweep never consults secret signature sites or client probes",()=>{
 const sweep=read("integration/coopNativeNpcProbeSweep.cjs");
 const runtime=read("integration/coopVirtualWorldRuntime.cjs");
 assert.match(sweep,/flushNpcCargo\(\)/);
 assert.match(sweep,/upsertNativeCargo\(changed\)/);
 assert.match(sweep,/SWEEP_OPERATOR_REPAIR_REQUIRED/);
 assert.match(sweep,/nativeNpcCargoID!==row\.cargoID/);
 assert.doesNotMatch(sweep,/listNativeSites|signatureRuntime|resolveNativeSite|buildResolvedSignatureScanResults|launchCharacterProbes/);
 assert.match(runtime,/EVEJS_COOP_NPC_PROBE_SWEEP==="1"/);
 assert.match(runtime,/EVEJS_COOP_NPC_PROBE_LAUNCH==="1"/);
 assert.match(runtime,/npcProbeSweep\.tick\(\{scene,entityID,assignments\}\)/);
});
test("EX-03B4 original scout hardware is a conditional source-authored fitting",()=>{
 const code=read("integration/coopNpcScoutLoadout.cjs");
 const source=read("scripts/coop-npc-scout-loadout-patch.cjs");
 const installer=read("scripts/patch-evejs-coop.cjs");
 const deploy=read("scripts/Deploy-Coop-RuntimeProbe.ps1");
 assert.match(code,/LAUNCHER_TYPE_ID=17938/);
 assert.match(code,/CHARGE_TYPE_ID=30013/);
 assert.match(code,/compatibleCharges\(LAUNCHER_TYPE_ID\)/);
 assert.match(source,/options\.coopExpeditionScout === true/);
 assert.match(source,/options\.transient === false/);
 assert.match(source,/EVEJS_COOP_NPC_SCOUT_LOADOUT === "1"/);
 assert.match(installer,/coop-npc-scout-loadout-patch\.cjs/);
 assert.match(deploy,/\[switch\]\$EnableNpcScoutLoadout/);
 assert.match(deploy,/EVEJS_COOP_NPC_SCOUT_LOADOUT: '1'/);
 const manifest=read("scripts/overlay-spec.cjs");
 assert.match(manifest,/"coopNativeNpcProbeSweep","coopNativeNpcProbeLifecycle","coopNativeNpcProbeSceneTransition","coopNpcScoutLoadout"/);
});

test("EX-03B5 source expiry and recovery use original gameStore single-table durability barrier",()=>{
 const lifecycle=read("integration/coopNativeNpcProbeLifecycle.cjs");
 const runtime=read("integration/coopVirtualWorldRuntime.cjs");
 const deploy=read("scripts/Deploy-Coop-RuntimeProbe.ps1");
 const manifest=read("scripts/overlay-spec.cjs");
 assert.match(lifecycle,/"RECALLING"/);
 assert.match(lifecycle,/status:"STOWED"/);
 assert.match(lifecycle,/"EXPIRED"/);
 assert.match(lifecycle,/upsertNativeCargo\(row\)/);
 assert.match(lifecycle,/flushNpcCargo\(\)/);
 assert.match(lifecycle,/removeNativeProbe\(scene\.systemID,row\.cargoID\)/);
 assert.match(runtime,/EVEJS_COOP_NPC_PROBE_LIFECYCLE==="1"/);
 assert.match(runtime,/runtime\.removeDynamicEntity\(systemID,probeID/);
 assert.match(runtime,/gameStore\.flushTableSync\("npcCargo"\)/);
 assert.match(deploy,/\[switch\]\$EnableNpcProbeLifecycle/);
 assert.match(deploy,/EnableNpcProbeLifecycle -and -not \$EnableNpcProbeLaunch/);
 assert.match(deploy,/EVEJS_COOP_NPC_PROBE_LIFECYCLE: '1'/);
 assert.match(manifest,/"coopNativeNpcProbeSweep","coopNativeNpcProbeLifecycle"/);
});
test("EX-03B5 cannot produce player/client inventory or synthetic ISK during probe end",()=>{
 const lifecycle=read("integration/coopNativeNpcProbeLifecycle.cjs");
 assert.doesNotMatch(lifecycle,/grantItemToCharacterLocation|transferISK|wallet|launchCharacterProbes|resolveNativeSite/);
 assert.match(lifecycle,/p\.probeID!==row\.cargoID/);
 assert.match(lifecycle,/dist\(physical\.position,p\.position\)<=1/);
});

test("EX-03B6 native probe position changes are source-first broadcast transitions",()=>{
 const move=read("integration/coopNativeNpcProbeSceneTransition.cjs");
 const sweep=read("integration/coopNativeNpcProbeSweep.cjs");
 const flight=read("integration/coopNativeNpcProbeFlight.cjs");
 const world=read("integration/coopVirtualWorldRuntime.cjs");
 const manifest=read("scripts/overlay-spec.cjs");
 assert.match(move,/removeDynamicEntity\(scene\.systemID,id/);
 assert.match(move,/scene\.spawnDynamicEntity\(candidate,\{broadcast:true\}\)/);
 assert.match(move,/nativeNpcCargoID!==id/);
 assert.match(move,/allowSessionOwned:false,broadcast:true/);
 assert.match(sweep,/relocateNativeProbe\(\{scene,row:changed\}\)/);
 assert.match(sweep,/flush=flushNpcCargo\(\)/);
 assert.match(flight,/relocateNativeProbe\(\{scene:ctx\.scene,row\}\)/);
 assert.match(world,/createNativeNpcProbeSceneTransition/);
 assert.match(world,/npcProbeSceneTransition\.move\(payload\)/);
 assert.match(manifest,/"coopNativeNpcProbeSceneTransition"/);
 assert.doesNotMatch(sweep,/live\.position=\{\.\.\.position\}/);
});
test("EX-03B6 CI includes real SQLite SIGKILL and native scene acceptance fixtures",()=>{
 const ci=read(".github/workflows/ex03-native-npc-probes.yml");
 const script=read("scripts/verify-npc-probe-sqlite-crash.mjs");
 assert.match(ci,/npm ci --no-audit --no-fund/);
 assert.match(ci,/node scripts\/verify-npc-probe-sqlite-crash\.mjs/);
 assert.match(ci,/coop-native-npc-probe-scene-transition\.test\.mjs/);
 assert.match(script,/process\.kill\(process\.pid,"SIGKILL"\)/);
 assert.match(script,/EVEJS_GAMESTORE_DATA_DIR:data/);
 assert.match(script,/EVEJS_PINNED_SERVER/);
 assert.match(script,/flushTableSync\("npcCargo"\)/);
});

test("EX-03B7 production probe state machines use attested native SQLite across kill windows",()=>{
 const workflow=read(".github/workflows/ex03-native-npc-probes.yml");
 const source=read("scripts/verify-npc-probe-feature-sqlite-crash.mjs");
 const original=read("scripts/verify-npc-probe-sqlite-crash.mjs");
 assert.match(workflow,/node scripts\/verify-npc-probe-feature-sqlite-crash\.mjs/);
 assert.match(source,/createNativeNpcProbeFlight/);
 assert.match(source,/createNativeNpcProbeSweep/);
 assert.match(source,/createNativeNpcProbeLifecycle/);
 assert.match(source,/native\.upsertNativeCargo/);
 assert.match(source,/flushTableSync\("npcCargo"\)/);
 assert.match(source,/process\.kill\(process\.pid,"SIGKILL"\)/);
 assert.match(source,/EX03B7_NATIVE_FEATURE_SQLITE_PASS/);
 for(const script of [original,source]){
  assert.match(script,/function assertDisposableNativeStore\(\)/);
  assert.match(script,/EVEJS_TEST_STORE_ISOLATED/);
  assert.match(script,/EX03_TEST_ROOT_SYMLINK_FORBIDDEN/);
  assert.match(script,/evejs-test-store-attestation\.json/);
 }
});
test("EX-03 strict source provenance is checked by both scanner and launch replay",()=>{
 const scanner=read("integration/coopNpcProbeScanEvidence.cjs");
 const flight=read("integration/coopNativeNpcProbeFlight.cjs");
 assert.match(scanner,/physical\.nativeNpcProbe!==true/);
 assert.match(scanner,/physical\.nativeNpcCargoID!==row\.cargoID/);
 assert.match(scanner,/physical\.systemID!==scene\.systemID/);
 assert.match(flight,/existing\.nativeNpcProbe===true/);
 assert.match(flight,/existing\.nativeNpcCargoID===row\.cargoID/);
});

test("EX-03B9 native scanner priority cannot be starved by virtual miners",()=>{
 const director=read("integration/coopNpcExpeditionDirector.cjs");
 const world=read("integration/coopVirtualWorldRuntime.cjs");
 const workflow=read(".github/workflows/ex03-native-npc-probes.yml");
 assert.match(director,/roles\[a\.pilotID\]==="patrol"/);
 assert.match(director,/isNativeProbeScout\(id,scene\.systemID\)/);
 assert.match(director,/SCANNER_PREFLIGHT_BUDGET=128/);
 assert.match(director,/scannerCursor=\(scannerCursor\+checks\)%candidateIDs\.length/);
 assert.match(director,/const all=\[\.\.\.equipped\]/);
 assert.match(director,/if\(nativeProbeScan&&isNativeProbeScout&&candidateIDs\.length\)/);
 assert.match(director,/if\(equipped\.length>=2\)break/);
 assert.match(world,/isNativeProbeScout:\(id,systemID\)=>/);
 assert.match(world,/store\.listNativeModulesForEntity\(id\)/);
 assert.match(world,/m\.groupID===481&&m\.categoryID===7/);
 assert.match(workflow,/feat\/ch22-23-npc-expedition-competition-20261026/);
 const push=workflow.split("  push:\n")[1]?.split("  workflow_dispatch:")[0];
 assert.ok(push,"EX03_PUSH_EVENT_REQUIRED");
 assert.match(push,/integration\/coopNpcExpedition\*\.cjs/);
 assert.match(push,/tests\/coop-npc-\*/);
});

test("EX-03B11 native scanner handoff orders the scout before escorted patrols",()=>{
 const director=read("integration/coopNpcExpeditionDirector.cjs");
 const runtime=read("integration/coopVirtualWorldRuntime.cjs");
 const pinned=read("tests/coop-npc-probe-pinned-native-source.test.mjs");
 assert.match(director,/const warpCandidates=scoutWarpFirst\?\[scout\]:all/);
 assert.match(director,/action:scoutWarpFirst\?/);
 assert.match(director,/safeObserve\(\{scene,siteID:tip\.siteID,shipID:scout\.entityID\}\)/);
 assert.match(director,/nativeSite\(tip\.systemID,tip\.siteID,true\)/);
 assert.match(director,/scoutWarpOrders,patrolWarpOrders,scoutOnGridVerified/);
 assert.match(runtime,/scoutWarpOrders:result\.scoutWarpOrders\|\|0/);
 assert.match(runtime,/patrolWarpOrders:result\.patrolWarpOrders\|\|0/);
 assert.match(runtime,/sourceScoutOnGridVerified:result\.scoutOnGridVerified\|\|0/);
 assert.match(pinned,/pinned native certainty 1 flows from real original probes/);
 assert.match(pinned,/EX-03B11/);
});

test("EX-03B12/B13 source checks protect the native scout-to-arbiter bridge",()=>{
 const director=read("integration/coopNpcExpeditionDirector.cjs");
 const live=read("tests/coop-npc-expedition-native-bridge.test.mjs");
 const tests=read("tests/coop-npc-expedition-director.test.mjs");
 const workflow=read(".github/workflows/ex03-native-npc-probes.yml");
 assert.match(director,/let ship,c,n;/);
 assert.match(director,/catch\{return null\}/);
 assert.match(director,/uncertainOrders\.add\(moveKey\)/);
 assert.match(director,/unknownOrderOutcomes:uncertainOrders\.size/);
 assert.match(director,/const safeObserve=args=>/);
 assert.match(director,/result\?\.errorMsg==="COOP_NPC_ORDER_REPAIR_REQUIRED"/);
 assert.match(live,/createOrderArbiter/);
 assert.match(live,/createOrderBridge/);
 assert.match(live,/actual native order bridge\/arbiter accepts scout-first warp/);
 assert.match(tests,/ambiguous arbiter issue result is permanently fenced/);
 assert.match(workflow,/tests\/coop-npc-expedition-native-bridge\.test\.mjs/);
});

test("EX-03B15/B16 original native hack, ItemStore title and wormhole source wiring",()=>{
 const runtime=read("integration/coopVirtualWorldRuntime.cjs");
 const operations=read("integration/coopNpcExpeditionOperations.cjs");
 const loot=read("integration/coopNpcExpeditionLoot.cjs");
 const wormholes=read("integration/coopNpcWormholeTransit.cjs");
 const hacking=read("scripts/coop-npc-expedition-hacking-patch.cjs");
 const fitting=read("integration/coopNpcScoutLoadout.cjs");
 const patch=read("scripts/patch-evejs-coop.cjs");
 const overlay=read("scripts/overlay-spec.cjs");
 const workflow=read(".github/workflows/ex03-native-npc-probes.yml");
 assert.match(runtime,/npcExpeditionDirector\.operations\(\)/);
 assert.match(runtime,/createNpcExpeditionOperations/);
 assert.match(runtime,/EVEJS_COOP_NPC_EXPEDITION_HACK==="1"/);
 assert.match(runtime,/EVEJS_COOP_NPC_EXPEDITION_LOOT==="1"/);
 assert.match(runtime,/EVEJS_COOP_NPC_EXPEDITION_WORMHOLES==="1"/);
 assert.match(runtime,/createNpcWormholeTransit/);
 assert.match(runtime,/expedition-wormhole-cross/);
 assert.match(operations,/hackingService\.nativeNpcTurn/);
 assert.match(operations,/listMaterializedUniverseSiteContentEntities/);
 assert.match(operations,/loot\.collect/);
 assert.match(operations,/loot\.deliver/);
 assert.match(loot,/transferItemToOwnerLocation/);
 assert.match(loot,/moveItemToLocation/);
 assert.match(loot,/updateInventoryItem/);
 assert.match(loot,/flushTableSync\("items"\)/);
 assert.match(wormholes,/wormholes\.prepareJump/);
 assert.match(wormholes,/wormholes\.commitJump/);
 assert.match(wormholes,/wormholes\.buildJumpSpawnState/);
 assert.match(wormholes,/wormholeRuntimeState/);
 assert.match(wormholes,/materializeStoredNativeController/);
 assert.match(hacking,/EX03_NPC_HACK_SOURCE_BEGIN/);
 assert.match(fitting,/withAnalyzers/);
 assert.match(patch,/coop-npc-expedition-hacking-patch/);
 for(const name of ["coopNpcExpeditionLoot","coopNpcExpeditionOperations",
  "coopNpcWormholeTransit"])assert.match(overlay,new RegExp('"'+name+'"'));
 for(const file of ["coop-npc-expedition-hacking.test.mjs",
  "coop-npc-expedition-loot.test.mjs",
  "coop-npc-expedition-operations.test.mjs",
  "coop-npc-wormhole-transit.test.mjs"])assert.ok(workflow.includes(file));
 assert.match(workflow,/EVEJS_PINNED_HACKING_SOURCE/);
 assert.match(workflow,/EVEJS_COOP_NPC_EXPEDITION_HACK: '0'/);
 assert.match(workflow,/EVEJS_COOP_NPC_EXPEDITION_WORMHOLES: '0'/);
});

test("EX-03B17 native SQLite SIGKILL and two-client live acceptance remain explicit hard gates",()=>{
 const runtime=read("integration/coopVirtualWorldRuntime.cjs");
 const workflow=read(".github/workflows/ex03-native-npc-probes.yml");
 const crash=read("scripts/verify-npc-expedition-loot-sqlite-crash.mjs");
 const e2e=JSON.parse(read("tests/scenarios/ex03-native-two-client-exploration-e2e.json"));
 assert.match(runtime,/expedition-wormhole-approach/);
 assert.match(runtime,/npc\.follow\(link\.entityID,tip\.siteID,2500/);
 assert.match(runtime,/expedition-wormhole-wingman/);
 assert.match(runtime,/crossedWingmen>=2/);
 assert.match(crash,/process\.kill\(process\.pid,"SIGKILL"\)/);
 assert.match(crash,/store\._sqliteTables\.has\("items"\)/);
 assert.match(crash,/items\.updateInventoryItem/);
 assert.match(crash,/items\.transferItemToOwnerLocation/);
 assert.match(crash,/items\.moveItemToLocation/);
 assert.match(workflow,/node scripts\/verify-npc-expedition-loot-sqlite-crash\.mjs/);
 assert.match(workflow,/EVEJS_PINNED_HACKING_SOURCE/);
 assert.equal(e2e.releaseStatus,"NOT_VERIFIED");
 assert.ok(e2e.steps.length>=16);
 assert.ok(e2e.steps.every(x=>x.status==="NOT_RUN"),
  "source-only tests cannot make a fake two-client E2E pass");
});
