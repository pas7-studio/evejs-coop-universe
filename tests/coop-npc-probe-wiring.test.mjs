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
