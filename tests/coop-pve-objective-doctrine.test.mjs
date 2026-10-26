import test from "node:test";
import assert from "node:assert/strict";
import {createRequire} from "node:module";
const require=createRequire(import.meta.url);
const {createObjectiveDoctrine}=require("../integration/coopPveObjectiveDoctrine.cjs");
const systemID=30000144;
function fixture({lowHealth=false,wrongSite=false,uncertain=false,missingObjective=false,
 duplicate=false,stale=false,disconnected=false,busy=false,noSafeExit=false}={}){
 let now=1_000_000;
 const beacon={itemID:7001,kind:"universeAnomalySite",dungeonSiteInstanceID:6001,
  dungeonSiteID:7001,position:{x:0,y:0,z:0}};
 const structure={itemID:5200,kind:"siteKillableStructure",runtimeKind:"missionCombatStructure",
  dungeonMaterializedSiteContent:true,dungeonMaterializedKillableStructure:true,
  dungeonSiteID:wrongSite?8888:7001,dungeonSiteInstanceID:6001,dungeonEncounterKey:"wave-a",
  typeID:200,structureHP:10000,conditionState:{damage:0},position:{x:10000,y:0,z:0}};
 const npcShip={itemID:101,kind:"ship",nativeNpc:true,systemID,typeID:30001,
  corporationID:5001,position:{x:9000,y:0,z:0},mode:"STOP"};
 const player={itemID:901,kind:"ship",nativeNpc:false,systemID,
  position:{x:13000,y:0,z:0}};
 const entities=new Map([beacon,structure,npcShip,player].map(v=>[v.itemID,v]));
 const session={characterID:77,_space:{shipID:901,systemID,initialStateSent:true},
  socket:{destroyed:disconnected}};
 const scene={systemID,getEntityByID:id=>entities.get(id),
  staticEntitiesByID:new Map([[structure.itemID,structure]]),
  sessions:new Map([[77,session]])};
 if(duplicate)scene.sessions.set(88,{...session,socket:{destroyed:false}});
 if(missingObjective){scene.staticEntitiesByID.delete(structure.itemID);}
 const instance={instanceID:6001,solarSystemID:systemID,lifecycleState:"active",
  instanceScope:"shared",siteKind:"anomaly",templateID:"native-authored",
  siteKey:"authored:7001",metadata:{siteID:7001},
  spawnState:{encounterStatesByKey:{"wave-a":{
   waveIndex:1,spawnedAtMs:900000,spawnedEntityIDs:[101,5200]}}}};
 const ctrl=new Map([[101,{entityID:101,systemID,runtimeKind:"nativeCombat",
  lastAggressorID:901,lastAggressedAtMs:stale?800000:now-1000,
  ...(busy?{currentTargetID:701}:{})}]]);
 const original=new Map([[101,{entityID:101,systemID,nativeNpc:true,
  transient:true,typeID:30001,corporationID:5001,createdAtMs:899999}]]);
 const callbacks=[];
 const director=createObjectiveDoctrine({clock:()=>now,
  getNativeEntity:id=>original.get(id),getController:id=>ctrl.get(id),
  resolveVerifiedPlayer:(s,e)=>e===player?77:null,
  getHealth:()=>lowHealth?{armor:0.2,structure:0.65}:{armor:0.9,structure:1},
  isScrambled:()=>false,
  attack:(source,target)=>{callbacks.push({type:"attack",source,target});
   if(uncertain)throw Error("unknown");return {success:true};},
  warpToPoint:(source,target)=>{callbacks.push({type:"warp",source,target});
   if(uncertain)throw Error("unknown");return {success:true};},
  orbit:(source,target)=>{callbacks.push({type:"orbit",source,target});return {success:true};}
 });
 const waypoints=noSafeExit?[]:[
  {id:8040,kind:"stargate",position:{x:1_000_000,y:0,z:0}},
  {id:8041,kind:"asteroid",position:{x:2_000_000,y:0,z:0}}];
 const tick=(excludedIDs=[],w=waypoints)=>director.tick({systemID,scene,instances:[instance],
  excludedIDs,waypoints:w});
 return {tick,instance,scene,structure,npcShip,player,beacon,ctrl,original,entities,
  callbacks,director,session,now,setNow:v=>{now=v},waypoints};
}
test("original static killable objective and native defender produce acknowledged attack",()=>{
 const f=fixture(),r=f.tick();
 assert.equal(r.status,"NATIVE_OBJECTIVE_ORDERS_ACCEPTED");
 assert.equal(r.objectives,1);
 assert.equal(r.orders,1);
 assert.deepEqual(f.callbacks,[{type:"attack",source:101,target:901}]);
 assert.equal(r.events[0].objectiveID,5200);
 assert.equal(r.events[0].status,"NATIVE_OBJECTIVE_DEFEND_ATTACK_ACK");
 assert.equal(f.tick().orders,0);
});
test("damaged native defender retreats ONLY to safe original stargate/station",()=>{
 const f=fixture({lowHealth:true}),r=f.tick();
 assert.equal(r.orders,1);
 assert.equal(r.events[0].status,"NATIVE_OBJECTIVE_RETREAT_WARP_ACK");
 assert.deepEqual(f.callbacks,[{type:"warp",source:101,target:f.waypoints[0].position}]);
 assert.equal(f.tick().orders,0);
});
test("a missing/forged, finished, or wrong-site structure cannot order defense",()=>{
 const mutators=[
  f=>f.scene.staticEntitiesByID.delete(5200),
  f=>{f.structure.dungeonSiteID=9999;},
  f=>{f.structure.dungeonSiteInstanceID=6002;},
  f=>{f.structure.dungeonEncounterKey="other";},
  f=>{f.structure.kind="siteObjectiveMarker";},
  f=>{f.structure.dungeonMaterializedKillableStructure=false;},
  f=>{f.structure.conditionState.incapacitated=true;},
  f=>{f.instance.lifecycleState="completed";},
  f=>{f.instance.spawnState.encounterStatesByKey["wave-a"].spawnedEntityIDs=[101];}
 ];
 for(const modify of mutators){const f=fixture();modify(f);assert.equal(f.tick().orders,0);}
});
test("session spoof, staleness, and unverified attacker refuse all native orders",()=>{
 for(const o of [{duplicate:true},{disconnected:true},{stale:true}]){
  const f=fixture(o);assert.equal(f.tick().orders,0);
 }
 const f=fixture();f.player.position.x=400000;assert.equal(f.tick().orders,0);
});
test("faction/store/physical NPC identity and conflicting orders cannot be hijacked",()=>{
 const modifications=[
  f=>f.original.delete(101),
  f=>{f.original.get(101).typeID=123;},
  f=>{f.original.get(101).corporationID=11;},
  f=>{f.original.get(101).createdAtMs=700000;},
  f=>{f.npcShip.nativeNpc=false;},
  f=>{f.npcShip.position.x=600000;},
  f=>{f.ctrl.get(101).runtimeKind="nativeAmbient";}
 ];
 for(const change of modifications){const f=fixture();change(f);assert.equal(f.tick().orders,0);}
 const f=fixture({busy:true});assert.equal(f.tick().orders,0);
 assert.equal(fixture().tick([101]).orders,0);
});
test("retreat is blocked when scrambled or when no safe original destination exists",()=>{
 const f=fixture({lowHealth:true,noSafeExit:true});assert.equal(f.tick().orders,0);
 const g=fixture({lowHealth:true});g.npcShip.mode="WARP";assert.equal(g.tick().orders,0);
});
test("uncertain native ACK is fenced and never called again",()=>{
 const f=fixture({uncertain:true});assert.equal(f.tick().status,"OUTCOME_UNKNOWN");
 assert.equal(f.tick().orders,0);
 assert.equal(f.callbacks.length,1);
 assert.equal(f.director.snapshot()[0].phase,"OUTCOME_UNKNOWN");
});
test("native game store without objective is not permission to create one",()=>{
 const f=fixture({missingObjective:true});assert.equal(f.tick().status,"NO_SOURCE_OBJECTIVES");
 assert.deepEqual(f.callbacks,[]);
});
test("bad scene or oversized exclusion list fail closed",()=>{
 const f=fixture();
 assert.equal(f.tick(new Array(1025).fill(0)).status,"INVALID_NATIVE_CONTEXT");
 assert.equal(f.director.tick({systemID,scene:{systemID},instances:[f.instance]}).status,"INVALID_NATIVE_CONTEXT");
 assert.deepEqual(f.callbacks,[]);
});
test("duplicate original source ownership makes objective invalid",()=>{
 const f=fixture();
 f.instance.spawnState.encounterStatesByKey["wave-b"]={
   waveIndex:2,spawnedAtMs:900000,spawnedEntityIDs:[5200]};
 assert.equal(f.tick().orders,0);
});

test("original objective REGROUP issues physical orbit only near a verified player",()=>{
 const f=fixture({stale:true});
 f.npcShip.position.x=40000;
 const r=f.tick();
 assert.equal(r.orders,1);
 assert.equal(r.events[0].status,"NATIVE_OBJECTIVE_REGROUP_ORBIT_ACK");
 assert.equal(f.callbacks.length,1);
 assert.equal(f.callbacks[0].type,"orbit");
 assert.equal(f.callbacks[0].source,101);
 assert.equal(f.callbacks[0].target,5200);
 assert.equal(f.tick().orders,0);
});
test("REGROUP holds when no verified visitor or an existing native controller is engaged",()=>{
 const f=fixture({stale:true,disconnected:true});
 f.npcShip.position.x=40000;
 assert.equal(f.tick().orders,0);
 const b=fixture({stale:true,busy:true});b.npcShip.position.x=40000;
 assert.equal(b.tick().orders,0);
});
