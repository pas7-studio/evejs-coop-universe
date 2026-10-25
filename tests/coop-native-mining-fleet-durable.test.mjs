import test from "node:test";
import assert from "node:assert/strict";
import {createRequire} from "node:module";
const require=createRequire(import.meta.url);
const {createService,roleMarker,slotKey}=require("../integration/coopNativeMiningFleetDurable.cjs");
const SYSTEM=30000142;
function fixture(t,shared=null){
 const oldFlag=process.env.EVEJS_COOP_NATIVE_MINING_FLEET_DURABLE;
 process.env.EVEJS_COOP_NATIVE_MINING_FLEET_DURABLE="1";
 t.after(()=>{if(oldFlag===undefined)delete process.env.EVEJS_COOP_NATIVE_MINING_FLEET_DURABLE;
  else process.env.EVEJS_COOP_NATIVE_MINING_FLEET_DURABLE=oldFlag;});
 const world=shared||{
  slots:new Map(),entities:new Map(),controllers:new Map(),cargo:new Map(),modules:new Map()
 };
 let persisted=true,spawnMode="normal",registerFails=false,spawnCalls=0,restores=0;
 let physical=new Map(),fleets=[],log=[];
 const scene={systemID:SYSTEM,getEntityByID:id=>physical.get(id)||null};
 const db={
  read(t,p){const key=p.split("/").at(-1);return world.slots.has(key)?
    {success:true,data:structuredClone(world.slots.get(key))}:
    {success:false,errorMsg:"ENTRY_NOT_FOUND"};},
  write(t,p,v){if(!persisted)return{success:false};
   world.slots.set(p.split("/").at(-1),structuredClone(v));return{success:true};},
  flushTableSync(){return{success:persisted}},
  flushTablesSync(){return{success:persisted}},
 };
 const store={
  listNativeEntitiesForSystem:s=>[...world.entities.values()].filter(x=>x.systemID===s),
  getNativeEntity:id=>world.entities.get(id)||null,
  getNativeController:id=>world.controllers.get(id)||null,
  listNativeCargoForEntity:id=>[...world.cargo.values()].filter(x=>x.entityID===id),
  listNativeModulesForEntity:id=>[...world.modules.values()].filter(x=>x.entityID===id),
 };
 const nativeService={materializeStoredNativeController(scene,id){
  restores++;
  const row=world.entities.get(id);
  if(!row)return{success:false,errorMsg:"NOT_FOUND"};
  physical.set(id,{kind:"ship",nativeNpc:true,itemID:id,ownerID:row.ownerID});
  return{success:true};
 }};
 const register=(slot,data)=>{
  if(registerFails)throw Error("SIMULATED_REGISTER_CRASH");
  const fleet={startupKey:SYSTEM+":"+slot,fleetID:SYSTEM*32+slot,...data};
  fleets.push(fleet);return fleet;
 };
 function spawn(slot){
  spawnCalls++;
  const miners=[71001+(slot-1)*10],haulers=[71002+(slot-1)*10];
  for(const [role,ids] of [["miner",miners],["hauler",haulers]]){
   for(const id of ids){
    const marker=roleMarker(SYSTEM,slot,role);
    world.entities.set(id,{entityID:id,systemID:SYSTEM,ownerID:950,
      operatorKind:marker,nativeNpc:true,transient:false});
    if(spawnMode==="partial"&&role==="hauler")continue;
    world.controllers.set(id,{entityID:id,systemID:SYSTEM,operatorKind:marker,
      profileID:"npc-mining",transient:false,startupRuleID:null});
    physical.set(id,{kind:"ship",nativeNpc:true,itemID:id,ownerID:950});
   }
  }
  if(spawnMode==="reject")return{success:false};
  if(spawnMode==="partial")return{success:true,data:{minerEntityIDs:miners,
    haulerEntityIDs:haulers,haulerSpawnResult:{data:{partialFailure:{failedAt:1}}}}};
  return{success:true,data:{minerEntityIDs:miners,haulerEntityIDs:haulers,
    originAnchor:{position:{x:1,y:2,z:3}}}};
 }
 const create=()=>createService({db,store,nativeService,ensureState:()=>{},
   spawn,register,getFleets:()=>fleets,log:s=>log.push(s)});
 return {world,scene,db,store,nativeService,create,
  start:(count=1)=>create().start({scene,fleetCount:count}),
  getSpawnCalls:()=>spawnCalls,getRestores:()=>restores,
  setMode:m=>spawnMode=m,setPersist:b=>persisted=b,
  setRegisterFail:b=>registerFails=b,
  setPhysical:m=>physical=m,getPhysical:()=>physical,
  getFleets:()=>fleets,log};
}
test("first startup uses two original persistent NPC identities and records durable ACTIVE witness",t=>{
 const f=fixture(t),r=f.start();
 assert.equal(r.status,"OK");
 assert.equal(r.slots[0].status,"SPAWNED");
 assert.equal(f.getSpawnCalls(),1);
 assert.deepEqual(f.world.slots.get(slotKey(SYSTEM,1)).minerEntityIDs,[71001]);
 assert.deepEqual(f.world.slots.get(slotKey(SYSTEM,1)).haulerEntityIDs,[71002]);
 assert.equal(f.world.slots.get(slotKey(SYSTEM,1)).status,"ACTIVE");
 assert.equal(f.world.slots.get(slotKey(SYSTEM,1)).fleetID,SYSTEM*32+1);
 assert.equal(f.getFleets()[0].startupKey,SYSTEM+":1");
});
test("same process repeated scene callback does not respawn or register a duplicate fleet",t=>{
 const f=fixture(t);assert.equal(f.start().status,"OK");
 const r=f.start();
 assert.equal(r.slots[0].status,"ALREADY_ACTIVE");
 assert.equal(f.getSpawnCalls(),1);
 assert.equal(f.getFleets().length,1);
});
test("fresh process restores original miner, hauler, native IDs and cargo ownership",t=>{
 const first=fixture(t);assert.equal(first.start().status,"OK");
 first.world.cargo.set(980201,{cargoID:980201,entityID:71001,ownerID:950,typeID:34,quantity:9,transient:false});
 const next=fixture(t,first.world),r=next.start();
 assert.equal(r.status,"OK");
 assert.equal(r.slots[0].status,"RESTORED");
 assert.equal(next.getSpawnCalls(),0);
 assert.equal(next.getRestores(),2);
 assert.equal(next.getPhysical().get(71001).itemID,71001);
 assert.equal(next.world.cargo.get(980201).quantity,9);
 assert.equal(next.getFleets()[0].startupKey,SYSTEM+":1");
});
test("crash after PREPARING but before native spawn permanently quarantines slot",t=>{
 const f=fixture(t);
 f.world.slots.set(slotKey(SYSTEM,1),{version:1,status:"PREPARING",systemID:SYSTEM,slot:1});
 const r=f.start();
 assert.equal(r.status,"NEEDS_OPERATOR_REPAIR");
 assert.equal(f.getSpawnCalls(),0);
 assert.equal(f.world.slots.get(slotKey(SYSTEM,1)).status,"PREPARING");
});
test("partial native spawn leaves slot PREPARING and restart cannot duplicate miner",t=>{
 const f=fixture(t);f.setMode("partial");
 const initial=f.start();assert.equal(initial.status,"NEEDS_OPERATOR_REPAIR");
 assert.equal(f.getSpawnCalls(),1);
 const after=fixture(t,f.world),r=after.start();
 assert.equal(r.status,"NEEDS_OPERATOR_REPAIR");
 assert.equal(after.getSpawnCalls(),0);
});
test("native actor tags with no manifest are quarantined rather than respawned",t=>{
 const f=fixture(t);
 f.world.entities.set(199,{entityID:199,systemID:SYSTEM,operatorKind:roleMarker(SYSTEM,1,"miner")});
 const r=f.start();
 assert.equal(r.slots[0].reason,"ORPHAN_NATIVE_SLOT_WITHOUT_MANIFEST");
 assert.equal(f.getSpawnCalls(),0);
});
test("missing native controller on an ACTIVE slot is blocked with no automatic replacement",t=>{
 const f=fixture(t);f.start();f.world.controllers.delete(71001);
 const other=fixture(t,f.world),r=other.start();
 assert.equal(r.status,"NEEDS_OPERATOR_REPAIR");
 assert.equal(other.getSpawnCalls(),0);
 assert.equal(other.getRestores(),0);
});
test("foreign owner of original cargo blocks restore and does not mutate ore",t=>{
 const f=fixture(t);f.start();
 f.world.cargo.set(99009,{cargoID:99009,entityID:71001,ownerID:999,typeID:34,quantity:15});
 const restarted=fixture(t,f.world),r=restarted.start();
 assert.equal(r.status,"NEEDS_OPERATOR_REPAIR");
 assert.equal(restarted.getSpawnCalls(),0);
 assert.equal(f.world.cargo.get(99009).quantity,15);
});
test("failure after ACTIVE manifest but before runtime fleet registration can be recovered",t=>{
 const f=fixture(t);f.setRegisterFail(true);
 const r=f.start();
 assert.equal(r.status,"NEEDS_OPERATOR_REPAIR");
 assert.equal(f.world.slots.get(slotKey(SYSTEM,1)).status,"ACTIVE");
 const restarted=fixture(t,f.world),r2=restarted.start();
 assert.equal(r2.slots[0].status,"RESTORED");
 assert.equal(restarted.getSpawnCalls(),0);
});
test("disabled mode never alters original native store",t=>{
 const f=fixture(t);delete process.env.EVEJS_COOP_NATIVE_MINING_FLEET_DURABLE;
 const r=f.start();
 assert.equal(r.reason,"ALIFE08_NOT_ENABLED");
 assert.equal(f.getSpawnCalls(),0);
 assert.equal(f.world.slots.size,0);
});
test("failed witness persistence prevents any native actor allocation",t=>{
 const f=fixture(t);f.setPersist(false);
 const r=f.start();
 assert.equal(r.status,"NEEDS_OPERATOR_REPAIR");
 assert.equal(f.getSpawnCalls(),0);
 assert.equal(f.world.entities.size,0);
});
test("invalid scene and oversized startup count fail closed",t=>{
 const f=fixture(t);
 assert.equal(f.start(17).reason,"ALIFE08_INVALID_STARTUP");
 assert.equal(f.getSpawnCalls(),0);
});

test("legacy ACTIVE slot without fleetID refuses to relink haul receipts",t=>{
 const original=fixture(t);assert.equal(original.start().status,"OK");
 const witness=original.world.slots.get(slotKey(SYSTEM,1));delete witness.fleetID;
 const restarted=fixture(t,original.world),outcome=restarted.start();
 assert.equal(outcome.status,"NEEDS_OPERATOR_REPAIR");
 assert.equal(restarted.getSpawnCalls(),0);
 assert.equal(restarted.getRestores(),0);
});
test("tampered durable fleetID is quarantined without new NPC spawn",t=>{
 const original=fixture(t);assert.equal(original.start().status,"OK");
 original.world.slots.get(slotKey(SYSTEM,1)).fleetID=42;
 const restarted=fixture(t,original.world),outcome=restarted.start();
 assert.equal(outcome.status,"NEEDS_OPERATOR_REPAIR");
 assert.equal(restarted.getSpawnCalls(),0);
 assert.equal(restarted.getRestores(),0);
});
test("native cargo haul tag matches same fleetID after physical hauler restore",t=>{
 const original=fixture(t);assert.equal(original.start().status,"OK");
 const cargoID=980200012345,stableID=SYSTEM*32+1;
 original.world.cargo.set(cargoID,{cargoID,entityID:71002,ownerID:950,typeID:34,
   quantity:9,transient:false,coopHaulFleetID:stableID,coopHaulFromMinerID:71001});
 const reboot=fixture(t,original.world),outcome=reboot.start();
 assert.equal(outcome.status,"OK");
 assert.equal(reboot.getFleets()[0].fleetID,stableID);
 assert.equal(reboot.world.cargo.get(cargoID).coopHaulFleetID,stableID);
 assert.equal(reboot.world.cargo.get(cargoID).quantity,9);
 assert.equal(reboot.getSpawnCalls(),0);
});

test("ALIFE-12 persistent hauler with original cargo resumes loaded delivery after cold start",t=>{
 const old=process.env.EVEJS_COOP_NATIVE_STATION_TRIP_RECOVERY;
 const oldManifest=process.env.EVEJS_COOP_NATIVE_HAUL_MANIFEST;
 process.env.EVEJS_COOP_NATIVE_STATION_TRIP_RECOVERY="1";
 process.env.EVEJS_COOP_NATIVE_HAUL_MANIFEST="1";
 t.after(()=>{
  if(old===undefined)delete process.env.EVEJS_COOP_NATIVE_STATION_TRIP_RECOVERY;
  else process.env.EVEJS_COOP_NATIVE_STATION_TRIP_RECOVERY=old;
  if(oldManifest===undefined)delete process.env.EVEJS_COOP_NATIVE_HAUL_MANIFEST;
  else process.env.EVEJS_COOP_NATIVE_HAUL_MANIFEST=oldManifest;
 });
 const first=fixture(t);assert.equal(first.start().status,"OK");
 const cargoID=980200000181,fleetID=SYSTEM*32+1;
 first.world.cargo.set(cargoID,{cargoID,entityID:71002,ownerID:950,
  typeID:34,quantity:15,transient:false,coopHaulFleetID:fleetID,
  coopHaulFromMinerID:71001});
 const reboot=fixture(t,first.world),result=reboot.start();
 assert.equal(result.status,"OK");
 assert.equal(result.slots[0].status,"RESTORED");
 assert.equal(result.slots[0].pendingStationCargo,true);
 assert.equal(reboot.getFleets()[0].state,"loaded");
 assert.equal(reboot.getFleets()[0].nextThinkAtMs,0);
 assert.equal(reboot.getSpawnCalls(),0);
 assert.equal(reboot.world.cargo.get(cargoID).entityID,71002);
 assert.equal(reboot.world.cargo.size,1);
});
test("ALIFE-12 original restored cargo with wrong fleet ID quarantines slot",t=>{
 const old=process.env.EVEJS_COOP_NATIVE_STATION_TRIP_RECOVERY;
 const oldManifest=process.env.EVEJS_COOP_NATIVE_HAUL_MANIFEST;
 process.env.EVEJS_COOP_NATIVE_STATION_TRIP_RECOVERY="1";
 process.env.EVEJS_COOP_NATIVE_HAUL_MANIFEST="1";
 t.after(()=>{
  if(old===undefined)delete process.env.EVEJS_COOP_NATIVE_STATION_TRIP_RECOVERY;
  else process.env.EVEJS_COOP_NATIVE_STATION_TRIP_RECOVERY=old;
  if(oldManifest===undefined)delete process.env.EVEJS_COOP_NATIVE_HAUL_MANIFEST;
  else process.env.EVEJS_COOP_NATIVE_HAUL_MANIFEST=oldManifest;
 });
 const first=fixture(t);assert.equal(first.start().status,"OK");
 first.world.cargo.set(980201,{cargoID:980201,entityID:71002,ownerID:950,
  typeID:34,quantity:10,transient:false,coopHaulFleetID:123,
  coopHaulFromMinerID:71001});
 const reboot=fixture(t,first.world),result=reboot.start();
 assert.equal(result.status,"NEEDS_OPERATOR_REPAIR");
 assert.match(result.slots[0].reason,/ALIFE12_NATIVE_HAUL_CUSTODY_AMBIGUOUS/);
 assert.equal(reboot.getSpawnCalls(),0);
});

test("a witness whose ships were never durable is archived and the slot is seeded again",t=>{
 const f=fixture(t);
 const old=process.env.EVEJS_COOP_NATIVE_MINING_SLOT_RECONCILE;
 process.env.EVEJS_COOP_NATIVE_MINING_SLOT_RECONCILE="1";
 t.after(()=>{if(old===undefined)delete process.env.EVEJS_COOP_NATIVE_MINING_SLOT_RECONCILE;
  else process.env.EVEJS_COOP_NATIVE_MINING_SLOT_RECONCILE=old;});
 // A previous scene generation seeded this slot while durable startup was OFF:
 // the witness is ACTIVE but every hull behind it is gone, cargo and modules too.
 f.world.slots.set(slotKey(SYSTEM,1),{version:1,status:"ACTIVE",systemID:SYSTEM,slot:1,
  fleetID:SYSTEM*32+1,minerEntityIDs:[71001],haulerEntityIDs:[71002],
  originAnchor:{position:{x:1,y:2,z:3}}});
 f.world.entities.clear();f.world.controllers.clear();f.setPhysical(new Map());
 const r=f.start();
 assert.equal(r.status,"OK");
 assert.equal(r.slots[0].status,"SPAWNED");
 assert.equal(r.slots[0].reseededFrom,"ABANDONED_WITNESS");
 assert.equal(f.getSpawnCalls(),1);
 const archived=[...f.world.slots.keys()].filter(k=>k.startsWith(slotKey(SYSTEM,1)+"-"));
 assert.equal(archived.length,1,"the old witness is archived, never silently dropped");
 assert.deepEqual(f.world.slots.get(slotKey(SYSTEM,1)).minerEntityIDs,[71001]);
});
test("an abandoned-looking witness that still holds cargo is never re-seeded",t=>{
 const f=fixture(t);
 const old=process.env.EVEJS_COOP_NATIVE_MINING_SLOT_RECONCILE;
 process.env.EVEJS_COOP_NATIVE_MINING_SLOT_RECONCILE="1";
 t.after(()=>{if(old===undefined)delete process.env.EVEJS_COOP_NATIVE_MINING_SLOT_RECONCILE;
  else process.env.EVEJS_COOP_NATIVE_MINING_SLOT_RECONCILE=old;});
 f.world.slots.set(slotKey(SYSTEM,1),{version:1,status:"ACTIVE",systemID:SYSTEM,slot:1,
  fleetID:SYSTEM*32+1,minerEntityIDs:[71001],haulerEntityIDs:[71002]});
 f.world.entities.clear();f.world.controllers.clear();f.setPhysical(new Map());
 // Real ore is still on record for that ship: never guess it away.
 f.world.cargo.set(9001,{cargoID:9001,entityID:71002,quantity:500,ownerID:950});
 const r=f.start();
 assert.equal(r.status,"NEEDS_OPERATOR_REPAIR");
 assert.equal(f.getSpawnCalls(),0);
 assert.equal(r.slots[0].status,"NEEDS_OPERATOR_REPAIR");
});
test("a stale runtime fleet whose ships are gone is re-pointed instead of blocking the slot",t=>{
 const f=fixture(t);assert.equal(f.start().status,"OK");
 // Simulate a scene generation that kept the runtime record but lost the hulls.
 f.world.entities.clear();f.world.controllers.clear();f.setPhysical(new Map());
 f.getFleets()[0].minerEntityIDs=[990001];f.getFleets()[0].haulerEntityIDs=[990002];
 f.setPhysical(new Map());
 for(const id of [71001,71002]){
  f.world.entities.set(id,{entityID:id,systemID:SYSTEM,ownerID:950,
   operatorKind:roleMarker(SYSTEM,1,id===71001?"miner":"hauler"),nativeNpc:true,transient:false});
  f.world.controllers.set(id,{entityID:id,systemID:SYSTEM,
   operatorKind:roleMarker(SYSTEM,1,id===71001?"miner":"hauler"),
   profileID:"npc-mining",transient:false,startupRuleID:null});
 }
 const r=f.start();
 assert.equal(r.status,"OK");
 assert.deepEqual(f.getFleets()[0].minerEntityIDs,[71001]);
 assert.deepEqual(f.getFleets()[0].haulerEntityIDs,[71002]);
});
