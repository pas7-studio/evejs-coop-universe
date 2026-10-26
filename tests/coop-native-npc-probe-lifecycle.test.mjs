import test from "node:test";
import assert from "node:assert/strict";
import {createRequire} from "node:module";
const require=createRequire(import.meta.url);
const {createNativeNpcProbeLifecycle}=require("../integration/coopNativeNpcProbeLifecycle.cjs");
function fixture(){
 let now=1000000,writes=0,flushes=0,removes=0,failFlush=false,failRemove=false,fakeRemovalAck=false;
 const entityID=980000000111,systemID=30000142,ownerID=901,corporationID=700;
 const ship={itemID:entityID,kind:"ship",nativeNpc:true,
  ownerID,corporationID,position:{x:0,y:0,z:0}};
 let cargo=[1,2,3,4].map(i=>({cargoID:980200000000+i,entityID,ownerID,
  groupID:479,categoryID:8,typeID:30013,quantity:0,singleton:false,
  deployedProbe:{probeID:980200000000+i,entityID,ownerID,systemID,
   typeID:30013,launchedAtMs:now-10000,status:"IN_SPACE",
   position:{x:1000+i*100,y:0,z:0},originPosition:{x:0,y:0,z:0},
   sweepStep:0,rangeStep:4,scanRange:1e10}}));
 const entities=new Map([[entityID,ship],...cargo.map(r=>[r.cargoID,{
  itemID:r.cargoID,kind:"probe",nativeNpcProbe:true,
  nativeNpcCargoID:r.cargoID,ownerID,typeID:30013,systemID,
  position:{...r.deployedProbe.position}}])]);
 const scene={systemID,getEntityByID:id=>entities.get(id)};
 const deps={
  getNativeEntity:()=>({entityID,systemID,ownerID,corporationID}),
  getController:()=>({entityID,systemID}),
  listNativeCargoForEntity:()=>cargo.map(c=>({...c,deployedProbe:{...c.deployedProbe}})),
  upsertNativeCargo:row=>{writes++;cargo=cargo.map(c=>c.cargoID===row.cargoID?row:c);return{success:true}},
  flushNpcCargo:()=>{flushes++;return {success:!failFlush}},
  removeNativeProbe:(system,id)=>{assert.equal(system,systemID);
   if(failRemove)return {success:false};
   if(fakeRemovalAck)return {success:true};
   removes++;entities.delete(id);return{success:true}},
  refreshNativeCargoProjection:(s,id)=>{assert.equal(id,entityID);
   s.nativeCargoItems=cargo.filter(r=>r.quantity>0);
   return true;},
  clock:()=>now
 };
 const make=()=>createNativeNpcProbeLifecycle(deps);
 let api=make();
 const assignments=[{pilotID:"coop-pilot-777",entityID,systemID}];
 return {tick:opts=>api.tick({scene,entityID,assignments,...opts}),
  restart:()=>{api=make()},advance:x=>{now+=x},
  rows:()=>cargo,entities,ship,assignments,failedFlush:()=>{failFlush=true},
  clearFlush:()=>{failFlush=false},failedRemove:()=>{failRemove=true},
  clearRemove:()=>{failRemove=false},fakeRemovalAck:()=>{fakeRemovalAck=true},
  writes:()=>writes,flushes:()=>flushes,removes:()=>removes};
}
test("expiration durably seals original cargo before any physical removal",()=>{
 const f=fixture();f.advance(3600000);
 assert.equal(f.tick().status,"NPC_PROBE_EXPIRY_COMMITTED");
 assert.equal(f.rows()[0].deployedProbe.status,"EXPIRED");
 assert.equal(f.rows()[0].quantity,0);assert.equal(f.removes(),0);
 assert.equal(f.tick().status,"NPC_PROBE_EXPIRED");
 assert.equal(f.removes(),1);assert.equal(f.entities.has(980200000001),false);
});
test("expiry never refunds original probe, even after process-style controller recreation",()=>{
 const f=fixture();f.advance(3600000);f.tick();f.restart();f.tick();
 assert.equal(f.rows()[0].quantity,0);
 assert.equal(f.rows()[0].deployedProbe.status,"EXPIRED");
});
test("four expired original probes clear independently without starvation",()=>{
 const f=fixture();f.advance(3600000);
 for(let i=0;i<4;i++){
  assert.equal(f.tick().status,"NPC_PROBE_EXPIRY_COMMITTED");
  assert.equal(f.tick().status,"NPC_PROBE_EXPIRED");
 }
 assert.equal(f.removes(),4);
 assert.equal(f.tick().status,"NO_LIFECYCLE_ACTION");
 assert.equal(f.rows().every(r=>r.quantity===0),true);
});
test("nearby recall is two durable transitions, no simultaneous ship and space charge",()=>{
 const f=fixture();let r=f.tick({requestRecall:true});
 assert.equal(r.status,"NPC_PROBE_RECALL_COMMITTED");assert.equal(f.rows()[0].quantity,0);
 assert.equal(f.entities.has(r.cargoID),true);
 r=f.tick();assert.equal(r.status,"NPC_PROBE_RETURNED");
 assert.equal(f.entities.has(r.cargoID),false);
 assert.equal(f.rows()[0].quantity,1);
 assert.equal(f.rows()[0].deployedProbe.status,"STOWED");
 assert.equal(f.ship.nativeCargoItems.length,1);
});
test("crash after RECALLING receipt never refunds before physical item removed",()=>{
 const f=fixture();f.tick({requestRecall:true});
 f.restart();assert.equal(f.rows()[0].quantity,0);
 assert.equal(f.tick().status,"NPC_PROBE_RETURNED");
 assert.equal(f.rows()[0].quantity,1);
});
test("removal failure blocks refund and preserves original durable RECALLING",()=>{
 const f=fixture();f.tick({requestRecall:true});f.failedRemove();
 assert.equal(f.tick().reason,"NPC_PROBE_NATIVE_REMOVAL_UNCONFIRMED");
 assert.equal(f.rows()[0].quantity,0);assert.equal(f.entities.has(980200000001),true);
 f.clearRemove();assert.equal(f.tick().status,"NPC_PROBE_RETURNED");
});
test("out-of-range probe cannot teleport back and produce free charge",()=>{
 const f=fixture();f.entities.get(980200000001).position.x=1e10;
 assert.equal(f.tick({requestRecall:true}).status,"NPC_PROBE_RECALL_COMMITTED");
 // Other nearby probe may be legitimately recalled, but the distant
 // original source ID must NEVER be credited to native ship cargo.
 assert.equal(f.rows()[0].quantity,0);
 assert.equal(f.rows()[0].deployedProbe.status,"IN_SPACE");
});
test("foreign physical item identity collision fails closed before any deletion",()=>{
 const f=fixture();f.entities.get(980200000001).nativeNpcCargoID=77;
 f.advance(3600000);assert.equal(f.tick().reason,"NPC_PROBE_LIFECYCLE_FOREIGN_ITEM_COLLISION");
 assert.equal(f.writes(),0);assert.equal(f.removes(),0);
});
test("durability uncertainty quarantines original cargo and prevents physical deletion",()=>{
 const f=fixture();f.failedFlush();f.advance(3600000);
 assert.equal(f.tick().reason,"NPC_PROBE_END_DURABILITY_UNCONFIRMED");
 assert.equal(f.entities.has(980200000001),true);
 f.clearFlush();assert.equal(f.tick().reason,"NPC_PROBE_OPERATOR_REPAIR_REQUIRED");
 assert.equal(f.removes(),0);
});
test("duplicate IDs, player-occupied hull and absent durable pilot fail closed",()=>{
 for(const change of [
  f=>{f.rows()[1].cargoID=f.rows()[0].cargoID},
  f=>{f.ship.session={characterID:42}},
  f=>{f.assignments.length=0}
 ]){
  const f=fixture();change(f);f.advance(3600000);
  assert.equal(f.tick().status,"BLOCKED");assert.equal(f.writes(),0);
 }
});

test("stale nearby physical probe cannot refund original remote durable charge",()=>{
 const f=fixture();
 f.rows()[0].deployedProbe.position={x:1e10,y:0,z:0};
 // Physical entity is still near ship. A fake/misordered move may not
 // override the original source of truth to mint a returned charge.
 assert.equal(f.tick({requestRecall:true}).status,"NPC_PROBE_RECALL_COMMITTED");
 assert.equal(f.rows()[0].deployedProbe.status,"IN_SPACE");
 assert.equal(f.rows()[0].quantity,0);
});
test("expired source with physical object absent is idempotently cleaned after restart",()=>{
 const f=fixture();f.advance(3600000);f.tick();
 f.entities.delete(980200000001);
 f.restart();
 assert.equal(f.tick().status,"NPC_PROBE_EXPIRY_COMMITTED");
 assert.equal(f.rows()[0].quantity,0);
 assert.equal(f.rows()[0].deployedProbe.status,"EXPIRED");
});

test("native removal false-success ACK cannot refund while physical probe remains",()=>{
 const f=fixture();assert.equal(f.tick({requestRecall:true}).status,
  "NPC_PROBE_RECALL_COMMITTED");
 f.fakeRemovalAck();
 const returned=f.tick();
 assert.equal(returned.reason,"NPC_PROBE_NATIVE_REMOVAL_UNCONFIRMED");
 assert.equal(f.rows()[0].quantity,0);
 assert.equal(f.rows()[0].deployedProbe.status,"RECALLING");
 assert.equal(f.entities.has(980200000001),true);
});
