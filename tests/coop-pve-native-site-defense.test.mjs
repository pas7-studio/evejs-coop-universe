import test from "node:test";
import assert from "node:assert/strict";
import {createRequire} from "node:module";
const require=createRequire(import.meta.url);
const {siteEntries,createDirector}=require("../integration/coopPveNativeSiteDefense.cjs");
const systemID=30000144;
const mk=(itemID,nativeNpc,x,extra={})=>({
 itemID,kind:"ship",nativeNpc,typeID:30001,systemID,position:{x,y:0,z:0},factionID:5001,mode:"STOP",...extra
});
function fixture({
 age=1000,duplicatePilot=false,outcome="accepted",missingBeacon=false,
 wrongSite=false,helperBusy=false,otherFaction=false,disconnected=false,
 // Owner report 2026-11-05: a pilot sniped a site from 150 km and the defenders never reacted.
 far=0,lockRange=0,warpCapability=true,witness=null,warpOutcome="accepted"
}={}){
 const now=1000000,siteID=7001,instanceID=6001;
 const beacon={itemID:siteID,kind:"universeAnomalySite",dungeonSiteID:siteID,
  dungeonSiteInstanceID:wrongSite?9999:instanceID,position:{x:0,y:0,z:0}};
 const victim=mk(101,true,2000),helper=mk(102,true,4000,{factionID:otherFaction?5002:5001}),
  attacker=mk(901,false,10000);
 if(far>0)attacker.position={x:far,y:0,z:0};
 if(lockRange>0)helper.maxTargetRange=lockRange;
 const session={characterID:77,_space:{shipID:901,systemID,initialStateSent:true},socket:{destroyed:disconnected}};
 const entities=new Map([beacon,victim,helper,attacker].map(x=>[x.itemID,x]));
 if(missingBeacon)entities.delete(siteID);
 const scene={systemID,getEntityByID:id=>entities.get(id),sessions:new Map([[77,session]])};
 if(duplicatePilot)scene.sessions.set(80,{...session,socket:{destroyed:false}});
 const instance={instanceID,solarSystemID:systemID,lifecycleState:"active",
  instanceScope:"shared",siteKind:"anomaly",templateID:"authored:combat",siteKey:"universe-anomaly:"+systemID+":"+siteID,
  metadata:{siteID},spawnState:{encounterStatesByKey:{
   "wave-1":{spawnedAtMs:900000,spawnedEntityIDs:[101,102]}}}};
 const controllers=new Map([[101,{entityID:101,systemID,lastAggressorID:901,
  lastAggressedAtMs:now-age}],[102,{entityID:102,systemID,
  ...(helperBusy?{currentTargetID:12345}:{})}]]);
 const orders=[],warps=[],events=[];
 const nativeRecords=new Map([101,102].map(entityID=>[entityID,{entityID,systemID,nativeNpc:true,transient:true,typeID:30001,createdAtMs:900000}]));
 for(const entry of controllers.values())entry.runtimeKind="nativeCombat";
 const director=createDirector({clock:()=>now,getController:id=>controllers.get(id),
  getNativeEntity:id=>nativeRecords.get(id),
  resolveVerifiedPlayer:(_scene,entity)=>entity===attacker?77:null,
  issueAttack:(source,target)=>{orders.push([source,target]);
   if(outcome==="throw")throw Error("native unknown");
   if(outcome==="unknown")return {};
   return {success:outcome==="accepted"};},
  ...(warpCapability?{warpToAttacker:(source,target,options)=>{
   warps.push([source,target,options]);
   if(warpOutcome==="throw")throw Error("native unknown");
   if(warpOutcome==="unknown")return {};
   return {success:warpOutcome==="accepted"};}}:{}),
  ...(witness?{aggressionFor:({ victimEntityID }) => (victimEntityID === 101 ? witness : null)}:{}),
  notify:e=>events.push(e)});
 const tick=(instances=[instance],excludedIDs=[])=>director.tick({systemID,scene,instances,excludedIDs});
 return {tick,instance,scene,entities,victim,helper,attacker,session,controllers,nativeRecords,orders,warps,events,director,beacon};
}
test("native site spawn ledger + physical beacon establish precise owner of two ships",()=>{
 const f=fixture(),proof=siteEntries(systemID,f.scene,[f.instance]);
 assert.equal(proof.status,"OK");
 assert.equal(proof.sites.length,1);
 assert.equal(proof.owners.get(101).length,1);
 assert.equal(proof.owners.get(102)[0].site.instanceID,6001);
});
test("site defenders issue ONE native order against a verified recent aggressor",()=>{
 const f=fixture();const first=f.tick();
 assert.equal(first.status,"NATIVE_ORDERS_ACCEPTED");
 assert.equal(first.orders,1);
 assert.deepEqual(f.orders,[[102,901]]);
 assert.deepEqual(f.events.map(x=>x.status),["NATIVE_SITE_DEFENSE_ORDER_ACCEPTED"]);
 assert.equal(f.tick().orders,0,"never spam the same native order on the next A-Life tick");
});
test("no original site beacon or wrong instance identity means no native order",()=>{
 for(const o of [{missingBeacon:true},{wrongSite:true}]){
  const f=fixture(o);assert.equal(f.tick().orders,0);assert.deepEqual(f.orders,[]);
 }
});
test("site completion, wrong system and duplicate native ownership all stop response",()=>{
 for(const edit of [
  f=>{f.instance.lifecycleState="completed";},
  f=>{f.instance.instanceScope="private";},
  f=>{f.instance.solarSystemID=30000142;},
  f=>{f.instance.templateID="";},
  f=>{f.instance.spawnState.encounterStatesByKey["wave-2"]=
   {spawnedAtMs:999999,spawnedEntityIDs:[102]};}
 ]){
  const f=fixture();edit(f);assert.equal(f.tick().orders,0);
 }
});
test("a helper spawned for a DIFFERENT active site cannot reinforce this victim",()=>{
 const f=fixture();
 f.instance.spawnState.encounterStatesByKey["wave-1"].spawnedEntityIDs=[101];
 const other={...f.instance,instanceID:6002,metadata:{siteID:7002},
  siteKey:"other:7002",spawnState:{encounterStatesByKey:{
   "wave-1":{spawnedAtMs:900000,spawnedEntityIDs:[102]}}}};
 f.entities.set(7002,{itemID:7002,kind:"universeAnomalySite",dungeonSiteID:7002,
  dungeonSiteInstanceID:6002,position:{x:0,y:0,z:0}});
 assert.equal(f.tick([f.instance,other]).orders,0);
});
test("stale aggression, unverified login, disconnected pilot and helper in combat deny attack",()=>{
 for(const o of [{age:120001},{duplicatePilot:true},{disconnected:true},
  {helperBusy:true},{otherFaction:true}]){
  const f=fixture(o);assert.equal(f.tick().orders,0);assert.deepEqual(f.orders,[]);
 }
});
test("recycled hull ID, missing native store/controller and impossible position deny order",()=>{
 for(const edit of [
  f=>f.entities.delete(102),
  f=>f.controllers.delete(102),
  f=>f.nativeRecords.delete(102),
  f=>{f.nativeRecords.get(102).typeID=2;},
  f=>{f.nativeRecords.get(102).nativeNpc=false;},
  f=>{f.nativeRecords.get(102).transient=false;},
  f=>{f.nativeRecords.get(102).createdAtMs=950000;},
  f=>{f.nativeRecords.get(102).createdAtMs=700000;},
  f=>{f.controllers.get(102).runtimeKind="nativeAmbient";},
  f=>{f.helper.kind="container";},
  f=>{f.helper.nativeNpc=false;},
  f=>{f.attacker.position.x=300000;},
  f=>{f.helper.position.x=300000;}
 ]){
  const f=fixture();edit(f);assert.equal(f.tick().orders,0);
 }
});
test("ambiguous native ACK remains fenced rather than retrying unknown attack",()=>{
 for(const outcome of ["unknown","throw"]){
  const f=fixture({outcome});
  assert.equal(f.tick().status,"OUTCOME_UNKNOWN");
  assert.equal(f.orders.length,1);
  assert.equal(f.tick().orders,0);
  assert.equal(f.orders.length,1);
  assert.equal(f.director.snapshot()[0].phase,"UNKNOWN");
 }
});
test("definitive native refusal creates no accepted combat evidence",()=>{
 const f=fixture({outcome:"rejected"});
 assert.equal(f.tick().orders,0);
 assert.equal(f.events.length,0);
 assert.equal(f.director.snapshot().length,0);
});
test("invalid input or truncated site catalog fails closed",()=>{
 const f=fixture();
 assert.equal(f.tick(new Array(257).fill(f.instance)).status,"INVALID_SITE_SOURCE");
 assert.equal(siteEntries(systemID,{systemID},[f.instance]).status,"INVALID_SITE_SOURCE");
 assert.equal(f.orders.length,0);
});

test("named A-Life or war-owned IDs cannot be hijacked by site defense",()=>{
 const f=fixture();assert.equal(f.tick([f.instance],[102]).orders,0);
 assert.equal(f.tick([f.instance],new Array(1025).fill(0)).status,"INVALID_EXCLUSIONS");
});

test("a signature beacon cannot impersonate an anomaly and vice versa",()=>{
 const f=fixture();f.beacon.kind="universeSignatureSite";
 assert.equal(f.tick().orders,0);
});

// ---- 150 km sniper (owner report 2026-11-05) -------------------------------
// A defender that cannot lock the attacker must warp into it and only then fight. A defender that
// CAN reach it keeps shooting from where it stands.
test("a defender that cannot lock the sniper warps to him instead of getting a useless attack order", () => {
  const f = fixture({ far: 150000, lockRange: 40000 });
  const first = f.tick();
  assert.equal(first.status, "NATIVE_ORDERS_ACCEPTED");
  assert.deepEqual(f.warps.map(([source, target]) => [source, target]), [[102, 901]],
    "the far defender is sent to the sniper");
  assert.deepEqual(f.orders, [], "no attack order that could never reach");
  assert.equal(f.warps[0][2].forceImmediateStart, true);
  assert.deepEqual(f.events.map((x) => x.status), ["NATIVE_SITE_DEFENSE_WARP_ISSUED"]);
  assert.equal(f.director.snapshot()[0].phase, "WARPING");
});

test("a defender whose own lock range covers the sniper keeps the native attack order", () => {
  const f = fixture({ far: 150000, lockRange: 180000 });
  assert.equal(f.tick().orders, 1);
  assert.deepEqual(f.orders, [[102, 901]]);
  assert.deepEqual(f.warps, [], "a hull that can shoot 150 km must not fly anywhere");
});

test("the attack order waits for the same hull to physically arrive, and no second warp", () => {
  const f = fixture({ far: 150000, lockRange: 40000 });
  f.tick();
  assert.equal(f.warps.length, 1);
  // still in warp on the next tick: nothing new is issued
  f.helper.mode = "WARP";
  f.helper.pendingWarp = { targetPoint: { x: 150000, y: 0, z: 0 } };
  f.tick();
  assert.equal(f.warps.length, 1);
  assert.equal(f.orders.length, 0);
  // the real arrival: same hull, out of warp, inside reach
  f.helper.mode = "STOP";
  f.helper.pendingWarp = null;
  f.helper.position = { x: 140000, y: 0, z: 0 };
  const arrived = f.tick();
  assert.deepEqual(f.orders, [[102, 901]], "it fights only once it is really there");
  assert.equal(arrived.status, "NATIVE_ORDERS_ACCEPTED");
  assert.equal(f.warps.length, 1, "arrival must never trigger another warp");
  assert.equal(f.events.at(-1).status, "NATIVE_SITE_DEFENSE_ORDER_ACCEPTED");
});

test("without a warp capability a far defender is left alone, never faked into an attack", () => {
  const f = fixture({ far: 150000, lockRange: 40000, warpCapability: false });
  assert.equal(f.tick().orders, 0);
  assert.deepEqual(f.orders, []);
  assert.deepEqual(f.warps, []);
});

test("an ambiguous warp ACK is fenced exactly like an attack ACK", () => {
  const f = fixture({ far: 150000, lockRange: 40000, warpOutcome: "unknown" });
  assert.equal(f.tick().status, "OUTCOME_UNKNOWN");
  assert.equal(f.warps.length, 1);
  assert.equal(f.tick().orders, 0, "an unknown native outcome is never retried");
  assert.equal(f.warps.length, 1, "no second warp after an unknown ACK");
  assert.equal(f.director.snapshot()[0].phase, "UNKNOWN");
});

test("the verified damage witness is the aggressor when the native controller has none", () => {
  const witness = { attackerShipID: 901, characterID: 77, atMs: 999500 };
  const f = fixture({ witness });
  f.controllers.get(101).lastAggressorID = 0;
  const first = f.tick();
  assert.equal(first.orders, 1);
  assert.ok(f.events.some((x) => x.status === "NATIVE_SITE_DEFENSE_FROM_WITNESS"),
    "the source of the aggression is named, not assumed");
  assert.deepEqual(f.orders, [[102, 901]]);
});

test("a stale witness is not aggression", () => {
  const f = fixture({ witness: { attackerShipID: 901, characterID: 77, atMs: 700000 } });
  // No native aggressor AND no native timestamp: only the witness could speak, and it is 5 min old.
  Object.assign(f.controllers.get(101), { lastAggressorID: 0, lastAggressedAtMs: 0 });
  assert.equal(f.tick().orders, 0);
  assert.equal(f.tick().events.length, 0);
});
