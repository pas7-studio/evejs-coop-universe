import test from "node:test";
import assert from "node:assert/strict";
import {createRequire} from "node:module";
const require=createRequire(import.meta.url);
const {patchStartupRecovery}=
 require("../scripts/coop-mining-startup-recovery-patch.cjs");
const fixture="function handleSceneCreated(scene) {\n  const startupKey = String(scene.systemID) + \":\" + String(resolveStartupFleetCount());\n  if (startupSceneSeedSet.has(startupKey)) return;\n  startupSceneSeedSet.add(startupKey);\n  const fleetCount = resolveStartupFleetCount();\n  if (fleetCount <= 0) return;\n  for (let index = 0; index < fleetCount; index += 1) {\n    const spawnResult = spawnMiningFleetInternal(scene,index);\n    if (!spawnResult.success || !spawnResult.data) {\n      continue;\n    }\n    createMiningFleetRecord({\n      source:\"startup\",\n      startupKey:String(scene.systemID)+\":\"+String(index+1),\n      systemID:scene.systemID\n    });\n  }\n}\n\nfunction deactivateMiningModulesForEntity() {}\n";
function harness(source,{enabled=true,fleetCount=1,outcomes=[]}={}){
 const records=[],seeded=new Set(),attempts=[],events=[];
 const start=new Function("require","console","process","startupSceneSeedSet","resolveStartupFleetCount",
  "spawnMiningFleetInternal","createMiningFleetRecord","getMiningFleetsForSystem",
  source+"; return handleSceneCreated;");
 const run=start(()=>({observe:(_name,_session,_ship,extra)=>events.push(extra)}),
  {warn:()=>{}},{env:{EVEJS_COOP_MINING_STARTUP_RETRY:enabled?"1":"0"}},
  seeded,()=>fleetCount,
  (_scene,index)=>{
   attempts.push(index);
   const success=outcomes.shift()!==false;
   return {success,data:success?{}:null};
  },record=>records.push(record),
  systemID=>records.filter(record=>record.systemID===systemID));
 return {run:()=>run({systemID:30000144}),records,attempts,seeded,events};
}
test("native mining startup retry patch is source-idempotent and exactly removable",()=>{
 const applied=patchStartupRecovery(fixture);
 assert.notEqual(applied,fixture);
 assert.equal(patchStartupRecovery(applied),applied);
 assert.equal(patchStartupRecovery(applied,true),fixture);
 assert.equal(patchStartupRecovery(fixture,true),fixture);
});
test("first failed fleet may retry without creating any fake ship or duplicate",()=>{
 const h=harness(patchStartupRecovery(fixture),{outcomes:[false,true]});
 h.run();assert.equal(h.records.length,0);assert.equal(h.seeded.size,0);
 h.run();assert.equal(h.records.length,1);assert.equal(h.seeded.size,1);
 h.run();assert.deepEqual(h.attempts,[0,0]);
 assert.deepEqual(h.events.map(e=>e.status),["FAILED","SEEDED"]);
});
test("partial two-fleet startup retries only the missing real slot",()=>{
 const h=harness(patchStartupRecovery(fixture),{
  fleetCount:2,outcomes:[true,false,true]
 });
 h.run();assert.equal(h.records.length,1);assert.equal(h.seeded.size,0);
 h.run();assert.deepEqual(h.attempts,[0,1,1]);
 assert.deepEqual(h.records.map(f=>f.startupKey),["30000144:1","30000144:2"]);
 assert.equal(h.seeded.size,1);
 h.run();assert.equal(h.attempts.length,3);
});
test("disabled opt-in preserves pinned upstream single-attempt behavior",()=>{
 const h=harness(patchStartupRecovery(fixture),{
  enabled:false,outcomes:[false,true]
 });
 h.run();h.run();
 assert.equal(h.attempts.length,1);
 assert.equal(h.records.length,0);
});
test("partially edited startup patch fails closed",()=>{
 const applied=patchStartupRecovery(fixture);
 const broken=applied.replace("Array.from({length:fleetCount}","Array.from({length:999}");
 assert.throws(()=>patchStartupRecovery(broken),/Unexpected native mining startup recovery source/);
});
