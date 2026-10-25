import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
const root=path.resolve(import.meta.dirname,"..");
const read=p=>fs.readFileSync(path.join(root,p),"utf8");
const runtime=read("integration/coopVirtualWorldRuntime.cjs");
const patcher=read("scripts/patch-evejs-coop.cjs");
const brain=read("integration/coopAlifeEconomy.cjs");
const sensor=read("integration/coopAlifeEconomySensor.cjs");
const news=read("integration/coopAlifeNews.cjs");
const manifest=JSON.parse(read("tests/scenarios/alife-native-economy-e2e.json"));
test("A-Life economy is inside existing 30-second world tick and has no competing timer",()=>{
 const tick=runtime.indexOf("timer=setInterval(()=>{");
 const nativeDepot=runtime.indexOf('safeNpcPhase("native-depot",syncNativeDeliveries);',tick);
 const observer=runtime.indexOf('safeNpcPhase("alife-native-economy-observe"',tick);
 const nativeMarket=runtime.indexOf('safeNpcPhase("native-market-schedule"',tick);
 assert.ok(tick>=0&&nativeDepot>tick&&observer>nativeDepot&&nativeMarket>observer);
 assert.doesNotMatch(brain,/setInterval|setTimeout|marketDaemonClient|issue\(/);
 assert.doesNotMatch(sensor,/setInterval|setTimeout|marketDaemonClient|\\.transact\(/);
});
test("both explicit A-Life flags guard the stage",()=>{
 assert.match(runtime,/EVEJS_COOP_ALIFE==="1"&&process\.env\.EVEJS_COOP_ALIFE_ECONOMY==="1"/);
 assert.match(brain,/ALIFE_ECONOMY_DISABLED/);
 assert.match(brain,/supportsNativeMutation:false/);
});
test("pinned overlay actually installs both new observer modules",()=>{
 assert.match(patcher,/"coopAlifeEconomy","coopAlifeEconomySensor"/);
 assert.match(runtime,/require\("\.\/coopAlifeEconomy"\)/);
 assert.match(runtime,/require\("\.\/coopAlifeEconomySensor"\)/);
});
test("A-Life intent is not misreported as completed native economic trade",()=>{
 assert.match(news,/alife-economy-intent/);
 assert.match(news,/планує/);
 assert.match(news,/ще не виконано/);
 assert.match(brain,/nativeMutation:false/);
});
test("manifest contains unique and unexecuted local E2E cases with required receipts",()=>{
 assert.equal(manifest.schema,"coop-alife-economy-acceptance/v1");
 assert.equal(manifest.execution,"DISPOSABLE_LOCAL_ONLY");
 assert.equal(manifest.preserveDockerVolume,"evejs-data");
 assert.ok(manifest.scenarios.length>=20);
 assert.equal(new Set(manifest.scenarios.map(x=>x.id)).size,manifest.scenarios.length);
 for(const row of manifest.scenarios){
  assert.match(row.id,/^ALIFE-\d{3}$/);
  assert.equal(row.status,"NOT_RUN");
  assert.equal(row.mode,"LOCAL_E2E");
  assert.equal(row.destructive,false);
  assert.ok(row.steps.length>=2&&row.expected.length>=2&&row.requiredEvidence.length>=2);
 }
});
test("required edge scenarios are present and remain explicitly unverified",()=>{
 const titles=manifest.scenarios.map(s=>s.title.toLowerCase()).join("\n");
 for(const phrase of ["concurrent buyers","lost rust","restart","cash","combat","ammunition","physical ore","two clients"])
  assert.ok(titles.includes(phrase),phrase);
});
test("scenario acceptance cannot bypass real Rust worker, 2 clients and conservation",()=>{
 assert.ok(manifest.mergeGates.some(x=>x.includes("cargo check")));
 assert.ok(manifest.mergeGates.some(x=>x.includes("better-sqlite3")));
 assert.ok(manifest.mergeGates.some(x=>x.includes("2-client")));
 assert.ok(manifest.mergeGates.some(x=>x.includes("ledger")));
});
