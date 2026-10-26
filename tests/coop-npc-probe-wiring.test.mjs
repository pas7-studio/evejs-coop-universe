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
 assert.match(source,/"coopNpcExpeditionDirector","coopNpcProbeHardware","coopNpcProbeScanEvidence"/);
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
 assert.match(sweep,/flushed=flushNpcCargo\(\)/);
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
