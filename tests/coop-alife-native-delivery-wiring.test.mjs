import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
const root=path.resolve(import.meta.dirname,"..");
const read=p=>fs.readFileSync(path.join(root,p),"utf8");
const manifest=JSON.parse(read("tests/scenarios/alife-native-delivery-e2e.json"));
test("ALIFE native warehouse handoff always requires eight real NOT_RUN E2E gates",()=>{
 assert.equal(manifest.schema,"evejs-coop/alife-native-delivery-e2e/v1");
 assert.equal(manifest.execution,"DISPOSABLE_LOCAL_ONLY");
 assert.equal(manifest.preserveDockerVolume,"evejs-data");
 assert.equal(manifest.scenarios.length,8);
 assert.equal(new Set(manifest.scenarios.map(x=>x.id)).size,8);
 for(const x of manifest.scenarios){
  assert.match(x.id,/^ALIFE-DEL-00[1-8]$/);
  assert.equal(x.status,"NOT_RUN");
  assert.equal(x.mode,"LOCAL_E2E");
  assert.equal(x.destructive,false);
  assert.ok(x.steps.length>=2);
  assert.ok(x.expected.length>=2);
  assert.ok(x.requiredEvidence.length>=2);
 }
});
test("event bridge is on original native arrival path and never writes cargo or money",()=>{
 const station=read("integration/coopNativeStationArrival.cjs");
 const helper=read("integration/coopAlifeNativeDeliveryEvidence.cjs");
 const patch=read("scripts/patch-evejs-coop.cjs");
 assert.match(station,/verifyFullNativeDelivery\(trip,manifestVerified\)/);
 assert.match(station,/alife-native-delivery-settled/);
 assert.ok(station.indexOf('manifestDirector.verify(')<station.indexOf('probe.observe("alife-native-delivery-settled"'));
 assert.match(patch,/"coopAlifeNativeDeliveryEvidence"/);
 assert.doesNotMatch(helper,/grantItem|removeNativeCargo|\.transact\(|setInterval|setTimeout|creditISK/);
});
test("empty cargo after committed last warehouse receipt is never an optimistic finish",()=>{
 const station=read("integration/coopNativeStationArrival.cjs");
 assert.match(station,/!stackCount&&!trip.completedStackCount&&!manifestDirector/);
 assert.match(station,/manifestVerified\?\.status!=="FULL_NATIVE_CARGO_DELIVERY_VERIFIED"/);
 assert.match(station,/NATIVE_FULL_MANIFEST_WITNESSED/);
});
