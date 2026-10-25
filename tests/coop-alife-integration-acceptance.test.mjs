import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
const root=path.resolve(import.meta.dirname,"..");
const manifest=JSON.parse(fs.readFileSync(path.join(root,"tests","scenarios",
 "alife-native-authority-integration.json"),"utf8"));
test("A-Life native integration acceptance remains independent and NOT_RUN",()=>{
 assert.equal(manifest.schema,"evejs-coop/alife-integration-acceptance/v1");
 assert.equal(manifest.execution,"DISPOSABLE_LOCAL_ONLY");
 assert.equal(manifest.preserveDockerVolume,"evejs-data");
 assert.equal(manifest.scenarios.length,8);
 assert.equal(new Set(manifest.scenarios.map(x=>x.id)).size,8);
 for(const s of manifest.scenarios){
  assert.match(s.id,/^ALIFE-INT-00[1-8]$/);
  assert.equal(s.status,"NOT_RUN");
  assert.equal(s.destructive,false);
  assert.equal(s.mode,"LOCAL_E2E");
  assert.ok(s.steps.length>=2&&s.expected.length>=2&&s.requiredEvidence.length>=2);
 }
});
test("no acceptance shortcut: manual matrix includes real-client, conservation, restart and arbitration",()=>{
 const text=manifest.scenarios.map(s=>s.title+" "+s.steps.join(" ")).join(" ").toLowerCase();
 for(const phrase of ["two real connected clients","market receipt","restart","compete",
  "manufacture","ammunition"])assert.ok(text.includes(phrase),phrase);
});
