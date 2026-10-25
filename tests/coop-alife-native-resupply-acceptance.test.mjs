import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
const root=path.resolve(import.meta.dirname,"..");
const manifest=JSON.parse(fs.readFileSync(path.join(root,"tests","scenarios",
 "alife-native-resupply-act-e2e.json"),"utf8"));
test("ALIFE-02 physical native resupply manual acceptance remains unexecuted",()=>{
 assert.equal(manifest.schema,"evejs-coop/alife-native-resupply-act-acceptance/v1");
 assert.equal(manifest.execution,"DISPOSABLE_LOCAL_ONLY");
 assert.equal(manifest.preserveDockerVolume,"evejs-data");
 assert.equal(manifest.newFeatureFlag,"EVEJS_COOP_ALIFE_NATIVE_RESUPPLY_ACT");
 assert.equal(manifest.scenarios.length,7);
 assert.equal(new Set(manifest.scenarios.map(x=>x.id)).size,7);
 for(const s of manifest.scenarios){
  assert.match(s.id,/^ALIFE-ACT-00[1-7]$/);
  assert.equal(s.status,"NOT_RUN");
  assert.equal(s.mode,"LOCAL_E2E");
  assert.equal(s.destructive,false);
  assert.ok(s.steps.length>=2,s.id+" steps");
  assert.ok(s.expected.length>=2,s.id+" acceptance");
  assert.ok(s.requiredEvidence.length>=2,s.id+" source proof");
 }
});
test("A-Life ACT gameplay requires physical shortage, survival, restart and dual-client proof",()=>{
 const titles=manifest.scenarios.map(s=>s.title.toLowerCase()).join(" ");
 for(const token of ["native station warp","cannot raid","emergency retreat",
  "repeated","bought and loaded","two-clients","restart/crash"])
  assert.ok(titles.includes(token),token);
});
