import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
const root=path.resolve(import.meta.dirname,"..");
const read=p=>fs.readFileSync(path.join(root,p),"utf8");
test("existing physical stock EveJS runtime reads loaded scenes, never creates a scene for proofs",()=>{
 const src=read("integration/coopVirtualWorldRuntime.cjs");
 assert.match(src,/runtime\.scenes instanceof Map\?runtime\.scenes\.get\(systemID\)/);
 const begin=src.indexOf("function observeNativeMiningProof()");
 const end=src.indexOf("function syncNativeDeliveries()",begin);
 assert.ok(begin>=0&&end>begin);
 const code=src.slice(begin,end);
 assert.doesNotMatch(code,/ensureScene|spawnBatchInSystem|warpTo|new (?:Scene|Timer)|setInterval/);
 assert.match(code,/mining\.getMiningFleetsForSystem\(systemID\)/);
 assert.match(code,/miningState\.getMineableState\(sc,id\)/);
 assert.match(code,/store\.listNativeCargoForEntity\(id\)/);
});
test("only one native world scheduler, mining witness defaults OFF and has bounded reads",()=>{
 const src=read("integration/coopVirtualWorldRuntime.cjs");
 const witness=read("integration/coopAlifeNativeMiningWitness.cjs");
 assert.match(src,/EVEJS_COOP_ALIFE_MINING_PROOF==="1"/);
 assert.match(src,/EVEJS_COOP_NATIVE_MINING==="1"/);
 assert.match(src,/EVEJS_COOP_ALIFE==="1"/);
 assert.match(src,/\.sort\(\(a,b\)=>a-b\)\.slice\(0,2\)/);
 assert.match(witness,/maxMiners=12/);
 assert.doesNotMatch(witness,/setInterval|setTimeout|allocateCargoID|upsertNativeCargo|grantItem|adjustBalance|issueAttackOrder/);
});
test("reversible pinned overlay includes native witness exactly once",()=>{
 const patch=read("scripts/patch-evejs-coop.cjs");
 assert.equal((patch.match(/"coopAlifeNativeMiningWitness"/g)||[]).length,1);
});
test("six independent physical acceptance scenarios are NOT_RUN and gated",()=>{
 const m=JSON.parse(read("tests/scenarios/alife-native-mining-physical-e2e.json"));
 assert.equal(m.schema,"evejs-coop/alife-native-mining-physical-proof/v1");
 assert.equal(m.execution,"DISPOSABLE_LOCAL_ONLY");
 assert.equal(m.preserveDockerVolume,"evejs-data");
 assert.equal(m.featureFlag,"EVEJS_COOP_ALIFE_MINING_PROOF");
 assert.equal(m.scenarios.length,6);
 assert.equal(new Set(m.scenarios.map(x=>x.id)).size,6);
 for(const x of m.scenarios){
  assert.match(x.id,/^ALIFE-MINE-00[1-6]$/);
  assert.equal(x.status,"NOT_RUN");
  assert.ok(x.steps.length>=2&&x.expected.length>=2&&x.requiredEvidence.length>=2);
 }
});
