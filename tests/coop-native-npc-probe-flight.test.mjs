import test from "node:test";
import assert from "node:assert/strict";
import {createRequire} from "node:module";
const require=createRequire(import.meta.url);
const {createNativeNpcProbeFlight}=require("../integration/coopNativeNpcProbeFlight.cjs");
const sid=30000142,entityID=980000000011,ownerID=901,corpID=700;
function fixture(){
 let now=1000000,failFlush=false,failSpawn=false,failProjection=false,flushes=0,writes=0,spawns=0;
 const ship={itemID:entityID,kind:"ship",nativeNpc:true,systemID:sid,
  ownerID,corporationID:corpID,position:{x:0,y:0,z:0}};
 const native={entityID,systemID:sid,ownerID,corporationID:corpID};
 const controller={entityID,systemID:sid};
 const module={moduleID:980100000011,entityID,ownerID,typeID:1001,
  groupID:481,categoryID:7,moduleState:{online:true}};
 let cargo=Array.from({length:4},(_,i)=>({cargoID:980200000001+i,entityID,ownerID,
  moduleID:module.moduleID,typeID:3001,groupID:479,categoryID:8,
  quantity:1,singleton:false}));
 const sceneMap=new Map([[entityID,ship]]);
 const scene={systemID:sid,getEntityByID:id=>sceneMap.get(id),
  spawnDynamicEntity:(entity,options)=>{
   assert.equal(options.broadcast,true);
   if(failSpawn)return {success:false};
   if(sceneMap.has(entity.itemID))return {success:false};
   spawns++;sceneMap.set(entity.itemID,entity);return {success:true};
  }};
 const assignments=[{pilotID:"coop-pilot-310",entityID,systemID:sid}];
 const ops=[];
 const deps={
  getNativeEntity:()=>native,getController:()=>controller,
  listNativeModulesForEntity:()=>[module],
  listNativeCargoForEntity:()=>cargo.map(x=>({...x,deployedProbe:x.deployedProbe?{...x.deployedProbe}:undefined})),
  upsertNativeCargo:row=>{writes++;ops.push("write:"+row.cargoID);
   cargo=cargo.map(old=>old.cargoID===row.cargoID?row:old);return {success:true}},
  flushNpcCargo:()=>{flushes++;ops.push("flush");return {success:!failFlush}},
  relocateNativeProbe:({scene,row})=>{
   const old=scene.getEntityByID(row.cargoID);
   if(!old||old.nativeNpcProbe!==true||old.nativeNpcCargoID!==row.cargoID)
    return {success:false};
   old.position={...row.deployedProbe.position};
   old.targetPoint={...row.deployedProbe.position};
   return {success:true};
  },
  refreshNativeCargoProjection:(ship,id)=>{
   assert.equal(id,entityID);
   if(failProjection)return false;
   ship.nativeCargoItems=cargo.filter(x=>x.quantity>0)
    .map(x=>({itemID:x.cargoID,quantity:x.quantity}));
   return true;
  },
  compatibleCharges:()=>[3001],
  resolveProbeRange:(_type,step)=>({rangeStep:step,scanRange:1e10}),
  buildProbeSceneEntity:(probe,{ownerID:owner,systemID:system})=>({
   itemID:probe.probeID,kind:"probe",typeID:probe.typeID,
   ownerID:owner,systemID:system,
   position:{x:probe.pos[0],y:probe.pos[1],z:probe.pos[2]}
  }),
  clock:()=>now};
 const api=createNativeNpcProbeFlight(deps);
 const tick=()=>api.tick({scene,entityID,assignments});
 return {tick,ops,sceneMap,ship,native,module,assignments,api,
  cargo:()=>cargo,writes:()=>writes,flushes:()=>flushes,spawns:()=>spawns,
  failFlush:()=>{failFlush=true},clearFlush:()=>{failFlush=false},
  failProjection:()=>{failProjection=true},clearProjection:()=>{failProjection=false},
  failSpawn:()=>{failSpawn=true},clearSpawn:()=>{failSpawn=false},
  advance:ms=>{now+=ms}};
}
test("one original cargo unit is durably debited before its exact native probe is spawned",()=>{
 const f=fixture(),r=f.tick();
 assert.equal(r.status,"NATIVE_PROBE_LAUNCHED");
 assert.equal(r.cargoID,980200000001);
 assert.equal(r.physicalProbeID,r.cargoID);
 assert.deepEqual(f.ops,["write:980200000001","flush"]);
 assert.equal(f.cargo()[0].quantity,0);
 assert.equal(f.cargo()[0].deployedProbe.probeID,f.cargo()[0].cargoID);
 assert.equal(f.sceneMap.get(r.cargoID).kind,"probe");
 assert.equal(f.ship.nativeCargoItems.some(item=>item.itemID===r.cargoID),false);
 assert.equal(f.spawns(),1);
});
test("four genuine original charges produce four distinct persistent physical probes",()=>{
 const f=fixture();
 for(let i=0;i<4;i++)assert.equal(f.tick().status,"NATIVE_PROBE_LAUNCHED");
 assert.equal(f.writes(),4);assert.equal(f.flushes(),4);
 assert.equal(f.spawns(),4);
 assert.equal(new Set(f.cargo().map(x=>x.deployedProbe?.probeID)).size,4);
 assert.equal(f.tick().status,"NO_NATIVE_PROBE_CHARGE");
 assert.equal(f.spawns(),4);
});
test("flush failure cannot spawn a non-durable probe",()=>{
 const f=fixture();f.failFlush();
 const r=f.tick();assert.equal(r.status,"BLOCKED");
 assert.equal(r.reason,"NPC_PROBE_CARGO_DURABILITY_UNCONFIRMED");
 assert.equal(f.spawns(),0);
 f.clearFlush();assert.equal(f.tick().status,"BLOCKED");
 assert.equal(f.spawns(),0);
});
test("crash after durable debit but failed scene creation is repaired without free ammo",()=>{
 const f=fixture();f.failSpawn();
 const first=f.tick();
 assert.equal(first.status,"NATIVE_PROBE_PENDING_RECONCILIATION");
 assert.equal(first.nativeCargoDebited,true);assert.equal(f.spawns(),0);
 f.clearSpawn();
 const second=f.tick();
 assert.equal(second.status,"NATIVE_PROBE_LAUNCHED");
 assert.equal(second.cargoID,980200000002);
 assert.equal(f.spawns(),2);assert.equal(f.writes(),2);
 assert.equal(f.sceneMap.get(980200000001).itemID,980200000001);
});
test("restart with persisted flight records restores original IDs without any new debit",()=>{
 const f=fixture();f.tick();
 f.sceneMap.delete(980200000001);
 const r=f.tick();assert.equal(r.status,"NATIVE_PROBE_LAUNCHED");
 assert.equal(f.spawns(),3);
 assert.equal(f.cargo()[0].deployedProbe.probeID,980200000001);
 assert.equal(f.cargo()[0].quantity,0);
});
test("native scene itemID collision quarantines row; never replaces unrelated ship",()=>{
 const f=fixture();f.sceneMap.set(980200000001,{itemID:980200000001,kind:"ship"});
 f.failSpawn();const r=f.tick();
 assert.equal(r.status,"NATIVE_PROBE_PENDING_RECONCILIATION");
 f.clearSpawn();const after=f.tick();assert.equal(after.status,"BLOCKED");
 assert.equal(after.reason,"NPC_PROBE_NATIVE_SCENE_ID_COLLISION");
 assert.equal(f.sceneMap.get(980200000001).kind,"ship");
});
test("missing original online launcher, foreign corp and fake pilot never debit",()=>{
 for(const mutate of [
  f=>{f.module.moduleState.online=false},
  f=>{f.ship.corporationID=777},
  f=>{f.assignments.push({pilotID:"coop-pilot-310",entityID:22,systemID:sid})}
 ]){
  const f=fixture();mutate(f);assert.notEqual(f.tick().status,"NATIVE_PROBE_LAUNCHED");
  assert.equal(f.writes(),0);
 }
});
test("stacked or singleton scanner charges require native unit split before launch",()=>{
 const f=fixture();for(const row of f.cargo())row.quantity=9;
 assert.equal(f.tick().status,"NO_NATIVE_PROBE_CHARGE");assert.equal(f.writes(),0);
 const g=fixture();for(const row of g.cargo())row.singleton=true;
 assert.equal(g.tick().status,"NO_NATIVE_PROBE_CHARGE");assert.equal(g.writes(),0);
});
test("expired flight does not get rematerialized from stale original cargo",()=>{
 const f=fixture();f.tick();f.sceneMap.delete(980200000001);
 f.advance(3600001);const r=f.tick();assert.equal(r.status,"BLOCKED");
 assert.equal(r.reason,"NPC_PROBE_FLIGHT_INVALID_OR_EXPIRED");assert.equal(f.writes(),1);
});
test("NPC warp or lost original pilot link prohibits native launch",()=>{
 const f=fixture();f.ship.pendingWarp={};
 assert.equal(f.tick().status,"BLOCKED");
 const g=fixture();g.assignments.length=0;
 assert.equal(g.tick().status,"BLOCKED");
});

test("duplicate original cargo IDs are refused before any native custody mutation",()=>{
 const f=fixture();f.cargo()[1].cargoID=f.cargo()[0].cargoID;
 assert.equal(f.tick().status,"BLOCKED");
 assert.equal(f.writes(),0);assert.equal(f.spawns(),0);
});
test("failed native cargo projection leaves durable source receipt pending, no free probe",()=>{
 const f=fixture();f.failProjection();
 const first=f.tick();
 assert.equal(first.status,"NATIVE_PROBE_PENDING_RECONCILIATION");
 assert.equal(first.nativeCargoDebited,true);
 assert.equal(f.spawns(),0);
 f.clearProjection();
 const recovered=f.tick();
 assert.equal(recovered.status,"NATIVE_PROBE_LAUNCHED");
 assert.equal(f.sceneMap.get(980200000001).kind,"probe");
 assert.equal(f.cargo()[0].quantity,0);
});

test("durable NPC probe sweep geometry is reconciled to SAME sealed physical itemID",()=>{
 const f=fixture(),first=f.tick();assert.equal(first.status,"NATIVE_PROBE_LAUNCHED");
 const originalID=first.cargoID,physical=f.sceneMap.get(originalID);
 assert.equal(physical.nativeNpcProbe,true);
 assert.equal(physical.nativeNpcCargoID,originalID);
 const newPosition={...f.cargo()[0].deployedProbe.position,x:1e10};
 f.cargo()[0].deployedProbe.position=newPosition;
 const out=f.tick();
 assert.equal(out.status,"NATIVE_PROBE_LAUNCHED");
 assert.deepEqual(f.sceneMap.get(originalID).position,newPosition);
 assert.equal(f.cargo()[0].quantity,0);
 assert.equal(f.sceneMap.get(originalID).itemID,originalID);
});
test("foreign unsealed original-ID probe cannot be moved on durable mismatch",()=>{
 const f=fixture(),first=f.tick();
 const physical=f.sceneMap.get(first.cargoID);
 physical.nativeNpcProbe=false;
 f.cargo()[0].deployedProbe.position={...physical.position,x:2e10};
 const out=f.tick();
 assert.equal(out.status,"BLOCKED");
 assert.equal(out.reason,"NPC_PROBE_NATIVE_SCENE_ID_COLLISION");
});
