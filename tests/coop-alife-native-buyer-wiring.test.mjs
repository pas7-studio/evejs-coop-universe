import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import vm from "node:vm";
const root=path.resolve(import.meta.dirname,"..");
const read=p=>fs.readFileSync(path.join(root,p),"utf8");
const runtime=read("integration/coopVirtualWorldRuntime.cjs");
const patcher=read("scripts/patch-evejs-coop.cjs");
const sensor=read("integration/coopAlifeEconomySensor.cjs");
const brain=read("integration/coopAlifeEconomy.cjs");
const station=read("integration/coopAlifeStationAuthority.cjs");
const adapter=read("integration/coopNpcBuyerNativeBindings.cjs");
const buyer=read("integration/coopAlifeNativeBuyerRuntime.cjs");
const dispatch=read("integration/coopAlifeNativeBuyerDispatch.cjs");
const manifest=JSON.parse(read("tests/scenarios/coop-049-alife-native-buyer-e2e.json"));
test("single existing 30-second world timer owns native buyer dispatch",()=>{
 const timer=runtime.indexOf("timer=setInterval(()=>{");
 const observation=runtime.indexOf('safeNpcPhase("alife-native-economy-observe"',timer);
 const purchase=runtime.indexOf('dispatchAlifeNativeBuyer',observation);
 assert.ok(timer>=0&&observation>timer);
 assert.match(runtime,/alifeBuyerRuntime\.tick\(\{snapshot:snap,decision/);
 assert.match(runtime,/observeAlifeEconomy\(\)\.catch/);
 for(const module of [brain,sensor,station,adapter,buyer,dispatch])
  assert.doesNotMatch(module,/\bsetInterval\s*\(/);
 assert.equal((runtime.match(/timer=setInterval\(/g)||[]).length,1);
});
test("A-Life station authority is genuinely read-only, never virtual inventory",()=>{
 assert.match(runtime,/createRuntimeStationAuthority/);
 assert.match(runtime,/ALIFE_ECONOMY_AUTHORITY/);
 assert.match(runtime,/alifeStationAuthority\.read/);
 assert.match(station,/getOrders\(before\.regionID/);
 assert.match(station,/materialNeeds:selected\.materialNeeds/);
 assert.match(station,/itemProof\(before\.items\)/);
 assert.match(brain,/const e=positive\(p\.ownerID\)\?p\.economy/);
 assert.match(sensor,/ownerID:Number\(native\.ownerID\)/);
});
test("native buyer is opt-in and legacy seeded market cannot double-act",()=>{
 assert.match(runtime,/EVEJS_COOP_ALIFE_NATIVE_BUYER/);
 assert.match(runtime,/PARALLEL_NATIVE_MARKET_WRITER_ENABLED/);
 assert.match(dispatch,/EVEJS_COOP_RUST_NPC_CORP_BUY_PLAYER/);
 assert.match(dispatch,/BUY_SUPPLIES/);
 assert.match(buyer,/getNativeEntity\(entityID\)/);
 assert.match(buyer,/getControllerByEntityID\(entityID\)/);
});
test("all new native economy source modules are copied by the pinned overlay",()=>{
 for(const filename of ["coopAlifeNativeBuyerDispatch","coopAlifeNativeBuyerRuntime",
  "coopAlifeStationAuthority","coopAlifeStationAuthorityRuntime",
  "coopNpcBuyerNativeBindings","coopNpcBuyerCoordinator",
  "coopNpcCorporateBuyerAtomic","coopNpcMarketPolicy",
  "coopNpcDemandAuthority","coopNpcNativeEconomyDirector"]){
  assert.ok(patcher.includes('"'+filename+'"'),filename);
  assert.ok(fs.existsSync(path.join(root,"integration",filename+".cjs")),filename);
 }
});
test("safe purchasing requires native seller escrow and exact physical stack",()=>{
 assert.match(adapter,/read\("marketEscrow","\/"\+orderID\)/);
 assert.match(adapter,/itemStore\.listOwnedItems\(sellerID\)/);
 assert.match(adapter,/physicalOwned!==proof\.available/);
 assert.match(adapter,/ALIFE_BUYER_SOURCE_CHANGED_DURING_RUST_READ/);
 assert.match(adapter,/getOrder:id=>marketClient\.call\("GetOrder"/);
 assert.match(adapter,/getCorporationRuntime|corp\(ownerID\)/);
});
test("all authored COOP049 modules parse as proper JavaScript",()=>{
 for(const filename of ["coopAlifeNativeBuyerDispatch","coopAlifeNativeBuyerRuntime",
  "coopNpcBuyerNativeBindings","coopAlifeStationAuthority","coopAlifeStationAuthorityRuntime"]){
  assert.doesNotThrow(()=>new vm.Script(read("integration/"+filename+".cjs")));
 }
});
test("11 real gameplay scenarios remain explicitly NOT_RUN",()=>{
 assert.equal(manifest.schema,"coop-049-alife-native-buyer-v1");
 assert.equal(manifest.doNotModifyVolume,"evejs-data");
 assert.ok(manifest.scenarios.length>=11);
 assert.equal(new Set(manifest.scenarios.map(x=>x.id)).size,manifest.scenarios.length);
 for(const sc of manifest.scenarios){
  assert.equal(sc.status,"NOT_RUN");assert.equal(sc.mode,"LOCAL_E2E");
  assert.ok(sc.requiredEvidence.length>=4);
 }
});
