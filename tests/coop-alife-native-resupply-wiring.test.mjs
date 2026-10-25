import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
const root=path.resolve(import.meta.dirname,"..");
const read=p=>fs.readFileSync(path.join(root,p),"utf8");
const runtime=read("integration/coopVirtualWorldRuntime.cjs");
const ammo=read("integration/coopNpcAmmoSupply.cjs");
const bridge=read("integration/coopAlifeNativeResupplyBridge.cjs");
const overlay=read("scripts/patch-evejs-coop.cjs");
test("COOP-043 Rust/GameStore station authority is preserved after native resupply integration",()=>{
 assert.match(runtime,/async function observeAlifeEconomy/);
 assert.match(runtime,/alifeStationAuthority\.read/);
 assert.match(runtime,/let remainingStations=8/);
 assert.match(runtime,/remainingStations--<=0/);
 assert.match(runtime,/alifeEconomyAuthorityBusy/);
 assert.match(runtime,/readStationEconomy:\(\)=>null/);
 assert.match(overlay,/"coopAlifeStationAuthority","coopAlifeStationAuthorityRuntime"/);
});
test("there remains exactly one native 30 second world tick and no extra A-Life timer",()=>{
 assert.equal((runtime.match(/timer=setInterval\(\(\)=>\{/g)||[]).length,1);
 assert.doesNotMatch(bridge,/setInterval|setTimeout|marketDaemonClient|transact\(/);
 assert.doesNotMatch(bridge,/issueAttackOrder|warpToEntity|issueOrder/);
 assert.equal((runtime.match(/advanceNativeAmmoSupply\(\{mode:"PLANNED"/g)||[]).length,1);
});
test("native order admission is common for raids, squad scouting and rescue",()=>{
 const legacy=runtime.match(/process\.env\.EVEJS_COOP_NPC_ORDER_ARBITER/g)||[];
 assert.equal(legacy.length,0);
 assert.match(runtime,/function alifeOrderArbitrationEnabled\(env=\{\}\)/);
 assert.match(runtime,/!alifeOrderArbitrationEnabled\(process\.env\)/);
});
test("native resupply only follows verified decision and retains urgent survival",()=>{
 const normal=runtime.indexOf('safeNpcPhase("native-ammo-readiness"');
 const survival=runtime.indexOf('safeNpcPhase("native-ammo-survival"');
 const raid=runtime.indexOf('safeNpcPhase("native-raids"');
 const observer=runtime.indexOf("const decision=alifeEconomyObserver.tick(snap)");
 const planned=runtime.indexOf('safeNpcPhase("alife-native-resupply-act"');
 assert.ok(normal>0&&survival>normal&&raid>survival);
 assert.ok(observer>0&&planned>observer);
 assert.match(runtime,/advanceNativeAmmoSupply\(\{mode:"SURVIVAL"\}\)/);
 assert.match(runtime,/advanceNativeAmmoSupply\(\{mode:"PLANNED",systemIDFilter:systemID,decision\}\)/);
 assert.match(bridge,/EVEJS_COOP_ALIFE_NATIVE_RESUPPLY_ACT==="1"/);
});
test("read-only shortage fencing happens before any existing native warp/orbit",()=>{
 const start=ammo.indexOf("function tick(");
 const fence=ammo.indexOf("leases.set(key,",start);
 const monitor=ammo.indexOf("if(observeOnly)continue;",start);
 const warp=ammo.indexOf("warp(entityID",start);
 assert.ok(start>0&&fence>start&&monitor>fence&&warp>monitor);
 assert.match(runtime,/observeOnly:mode==="MONITOR_ONLY"/);
});
test("accepted physical warp order is never reported as an ISK or item settlement",()=>{
 assert.match(runtime,/observe\("alife-native-act-order"/);
 assert.match(runtime,/proof:"NATIVE_ORDER_ACCEPTED"/);
 assert.match(runtime,/cargoCredited:false,iskCredited:false/);
 assert.doesNotMatch(runtime,/alife-native-resupply-settled|alife-native-market-sold/);
});
test("upstream reversible overlay installs the bridge exactly once",()=>{
 assert.equal((overlay.match(/"coopAlifeNativeResupplyBridge"/g)||[]).length,1);
 assert.match(overlay,/"coopAlifeNews","coopAlifeNativeResupplyBridge","coopCivilianOrders"/);
});
