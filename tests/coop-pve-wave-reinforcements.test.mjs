import test from "node:test";
import assert from "node:assert/strict";
import {createRequire} from "node:module";
const require=createRequire(import.meta.url);
const {createWaveReinforcements}=require("../integration/coopPveWaveReinforcements.cjs");
const systemID=30000144;
function setup({wrongCorp=false,stale=false,duplicate=false,warpOutcome="yes",
 attackOutcome="yes",anotherSite=false}={}){
 let now=1000000;
 const beacon={itemID:7001,kind:"universeAnomalySite",dungeonSiteID:7001,
  dungeonSiteInstanceID:6001,position:{x:0,y:0,z:0}};
 const npc=(id,x,corp=5001)=>({itemID:id,typeID:30001,systemID,kind:"ship",
  nativeNpc:true,corporationID:corp,mode:"STOP",position:{x,y:0,z:0}});
 const victim=npc(101,3000),reserve=npc(102,800000,wrongCorp?5002:5001);
 const attacker={itemID:901,typeID:500,systemID,kind:"ship",nativeNpc:false,position:{x:5000,y:0,z:0}};
 const entities=new Map([beacon,victim,reserve,attacker].map(x=>[x.itemID,x]));
 const session={characterID:77,_space:{systemID,shipID:901,initialStateSent:true},
  socket:{destroyed:false}};
 const scene={systemID,sessions:new Map([[77,session]]),getEntityByID:id=>entities.get(id)};
 if(duplicate)scene.sessions.set(88,{...session,socket:{destroyed:false}});
 const instance={instanceID:6001,solarSystemID:systemID,instanceScope:"shared",
  lifecycleState:"active",siteKind:"anomaly",templateID:"native-authored",
  siteKey:"universe-anomaly:"+systemID+":7001",metadata:{siteID:7001},
  spawnState:{encounterStatesByKey:{
   "wave-a":{waveIndex:1,spawnedAtMs:900000,spawnedEntityIDs:[101]},
   "wave-b":{waveIndex:2,spawnedAtMs:900001,spawnedEntityIDs:[102]}
  }}};
 const ctrl=new Map([[101,{entityID:101,systemID,runtimeKind:"nativeCombat",
   lastAggressorID:901,lastAggressedAtMs:stale?800000:now-1000}],
  [102,{entityID:102,systemID,runtimeKind:"nativeCombat"}]]);
 const native=new Map([101,102].map((entityID,i)=>[entityID,{entityID,systemID,
  typeID:30001,nativeNpc:true,transient:true,createdAtMs:899999+i}]));
 const calls=[];
 const director=createWaveReinforcements({
  clock:()=>now,getNativeEntity:id=>native.get(id),getController:id=>ctrl.get(id),
  resolveVerifiedPlayer:(s,e)=>e===attacker?77:null,
  warpToEntity:(shipID,targetID)=>{calls.push({action:"warp",shipID,targetID});
   if(warpOutcome==="throw")throw Error("uncertain");
   return warpOutcome==="unknown"?{}:{success:warpOutcome==="yes"};},
  attack:(shipID,targetID)=>{calls.push({action:"attack",shipID,targetID});
   if(attackOutcome==="throw")throw Error("uncertain");
   return attackOutcome==="unknown"?{}:{success:attackOutcome==="yes"};}
 });
 const instances=[instance];
 if(anotherSite){
  const other={...instance,instanceID:6002,siteKey:"other-site",
   metadata:{siteID:7002},spawnState:{encounterStatesByKey:{
    "wave-b":{waveIndex:2,spawnedAtMs:900001,spawnedEntityIDs:[102]}
   }}};
  instance.spawnState.encounterStatesByKey["wave-b"].spawnedEntityIDs=[];
  entities.set(7002,{...beacon,itemID:7002,dungeonSiteID:7002,dungeonSiteInstanceID:6002});
  instances.push(other);
 }
 return {director,calls,instance,instances,scene,session,ctrl,native,victim,reserve,attacker,
  tick:(excludedIDs=[])=>director.tick({systemID,scene,instances,excludedIDs}),
  advance:ms=>{now+=ms}};
}
test("different already spawned waves authorize a real native rescue warp, not another spawn",()=>{
 const f=setup(),r=f.tick();
 assert.equal(r.warpOrders,1);
 assert.equal(r.attackOrders,0);
 assert.deepEqual(f.calls,[{action:"warp",shipID:102,targetID:901}]);
 assert.equal(r.events[0].sourceEncounterKey,"wave-b");
 assert.equal(f.tick().warpOrders,0,"same helper cannot warp twice");
});
test("physical displacement and actual target proximity are necessary for subsequent attack",()=>{
 const f=setup();f.tick();f.advance(30000);
 assert.equal(f.tick().attackOrders,0,"no fake warp arrival from ACK");
 f.reserve.mode="WARP";assert.equal(f.tick().attackOrders,0);
 f.reserve.mode="STOP";f.reserve.position.x=9500;f.advance(1000);
 const r=f.tick();
 assert.equal(r.attackOrders,1);
 assert.deepEqual(f.calls.map(x=>x.action),["warp","attack"]);
 assert.equal(f.tick().attackOrders,0);
});
test("a target can leave while reserve is in warp: no speculative attack",()=>{
 const f=setup();f.tick();f.attacker.position.x=950000;f.reserve.position.x=949000;
 f.advance(30000);assert.equal(f.tick().attackOrders,0);
});
test("only distinct authored live encounter wave cohorts may respond",()=>{
 for(const tweak of [
  f=>{f.instance.spawnState.encounterStatesByKey["wave-b"].spawnedAtMs=0;},
  f=>{f.instance.spawnState.encounterStatesByKey["wave-b"].waveIndex=0;},
  f=>{f.instance.spawnState.encounterStatesByKey["wave-b"].completedAtMs=900100;},
  f=>{f.instance.spawnState.encounterStatesByKey["wave-a"].spawnedEntityIDs.push(102);},
  f=>{f.instance.spawnState.encounterStatesByKey["wave-b"].spawnedEntityIDs=[];},
  f=>{f.instance.lifecycleState="completed";}
 ]){
  const f=setup();tweak(f);assert.equal(f.tick().warpOrders,0);
 }
});
test("no cross-site reinforcements, faction mismatches or false attack evidence",()=>{
 for(const opts of [{anotherSite:true},{wrongCorp:true},{stale:true},{duplicate:true}]){
  const f=setup(opts);assert.equal(f.tick().warpOrders,0);
 }
});
test("occupied native hull, missing store and reserved A-Life hull fail closed",()=>{
 for(const tweak of [
  f=>{f.ctrl.get(102).currentTargetID=9;},
  f=>{f.native.delete(102);},
  f=>{f.native.get(102).typeID=42;},
  f=>{f.native.get(102).createdAtMs=990000;},
  f=>{f.reserve.mode="WARP";}
 ]){
  const f=setup();tweak(f);assert.equal(f.tick().warpOrders,0);
 }
 const f=setup();assert.equal(f.tick([102]).warpOrders,0);
});
test("unknown warp result is fenced; native rejection doesn't authorize attack",()=>{
 for(const warpOutcome of ["unknown","throw","no"]){
  const f=setup({warpOutcome});
  const one=f.tick();assert.equal(one.warpOrders,0);
  assert.equal(f.tick().warpOrders,0);
  assert.equal(f.calls.length,1);
  f.reserve.position.x=9500;f.advance(30000);
  assert.equal(f.tick().attackOrders,0);
  assert.equal(f.calls.length,1);
 }
});
test("unknown attack cannot be replayed after physical warp-in",()=>{
 for(const attackOutcome of ["unknown","throw"]){
  const f=setup({attackOutcome});
  f.tick();f.reserve.position.x=9500;f.advance(30000);
  assert.equal(f.tick().attackOrders,0);
  assert.equal(f.tick().attackOrders,0);
  assert.equal(f.calls.filter(x=>x.action==="attack").length,1);
  assert.equal(f.director.snapshot()[0].phase,"OUTCOME_UNKNOWN");
 }
});
test("a disconnect after warp acceptance prevents the follow-up attack",()=>{
 const f=setup();f.tick();f.session.socket.destroyed=true;f.reserve.position.x=9500;
 f.advance(30000);assert.equal(f.tick().attackOrders,0);
});
test("fail closed on excessive exclusions, fake scene or missing author list",()=>{
 const f=setup();
 assert.equal(f.tick(new Array(1025).fill(0)).status,"INVALID_NATIVE_CONTEXT");
 assert.equal(f.director.tick({systemID,scene:{systemID},instances:[f.instance]}).status,"INVALID_NATIVE_CONTEXT");
 assert.equal(f.calls.length,0);
});
