import test from "node:test";
import assert from "node:assert/strict";
import {createRequire} from "node:module";
const require=createRequire(import.meta.url);
const {unloadCargo}=require("../integration/coopNativeHaulCargo.cjs");

// The same original cargoID must disappear from proven native custody before
// a durable virtual depot receipt may change from PREPARED to COMMITTED.
function fixture({before=null,after,global=undefined,throwAfter=false,
 flushResult,throwFlush=false}={}){
 const hasFlushResult=Object.hasOwn(arguments[0]||{},"flushResult");
 const cargo={cargoID:333,typeID:34,quantity:50,moduleID:0,
  entityID:500,ownerID:1000035,transient:false,coopHaulFleetID:44,
  coopHaulSystemID:30000144,coopHaulFromMinerID:111};
 let removed=false,prepared=0,committed=0,removeCalls=0,reads=0,flushes=0;
 const store={
  listNativeCargoForEntity(){
   reads++;
   if(!removed)return before===null?[cargo]:before;
   if(throwAfter)throw Error("NATIVE_CARGO_READ_FAILED");
   return after;
  },
  removeNativeCargo(id){
   assert.equal(id,333);
   removeCalls++;
   removed=true;
   return {success:true};
  },
  buildNativeCargoItems:()=>[]
 };
 if(global!==undefined)store.listNativeCargo=()=>global;
 const depot={
  prepare(){prepared++;return {status:"PREPARED"}},
  commit(){committed++;return {status:"COMMITTED"}}
 };
 const ship={kind:"ship",itemID:500,ownerID:1000035,
  nativeCargoItems:[{itemID:333,volume:0.1}]};
 const scene={systemID:30000144,getEntityByID:id=>id===500?ship:null};
 const fleet={fleetID:44,systemID:30000144,haulerEntityIDs:[500]};
 const database={flushTableSync:table=>{
  assert.equal(table,"npcCargo");
  flushes++;
  if(throwFlush)throw Error("NATIVE_CARGO_FSYNC_FAILED");
  return hasFlushResult?flushResult:{success:true};
 }};
 const attempt=()=>unloadCargo(scene,fleet,{store,depot,database,probe:{observe:()=>{}}});
 return {attempt,store,database,depot,cargo,ship,scene,fleet,
  stats:()=>({prepared,committed,removeCalls,reads,flushes})};
}

test("P0: unknown post-remove cargo inventory cannot attest debit or credit virtual ore",()=>{
 for(const after of [null,undefined,false,{},"not-an-array"]){
  const f=fixture({after});
  const result=f.attempt();
  assert.equal(result.status,"NEEDS_REPAIR",String(after));
  assert.equal(result.stacks,0);
  assert.equal(f.stats().prepared,1);
  assert.equal(f.stats().committed,0,"no supply commit for unverified native row");
  assert.equal(f.stats().removeCalls,1);
 }
});

test("P0: throwing native cargo readback after remove never commits virtual depot credit",()=>{
 const f=fixture({throwAfter:true});
 const result=f.attempt();
 assert.equal(result.status,"ERROR");
 assert.equal(f.stats().prepared,1);
 assert.equal(f.stats().committed,0);
});

test("P0: if original cargoID remains on source ship, receipt stays pending",()=>{
 const f=fixture({after:[{cargoID:333,entityID:500,typeID:34,quantity:50}]});
 assert.equal(f.attempt().status,"NEEDS_REPAIR");
 assert.equal(f.stats().committed,0);
});

test("P0: global native inventory proves original cargo moved to another hauler",()=>{
 const f=fixture({after:[],global:[{
  cargoID:333,entityID:999,typeID:34,quantity:50,coopHaulFleetID:44
 }]});
 const result=f.attempt();
 assert.equal(result.status,"NEEDS_REPAIR");
 assert.equal(f.stats().committed,0);
});

test("P0: unavailable global cargo enumeration cannot certify original custody",()=>{
 for(const global of [null,{},false]){
  const f=fixture({after:[],global});
  assert.equal(f.attempt().status,"NEEDS_REPAIR");
  assert.equal(f.stats().committed,0);
 }
});

test("P0: null preflight inventory must not silently report NO_CARGO",()=>{
 const f=fixture({before:undefined});
 f.store.listNativeCargoForEntity=()=>null;
 const r=f.attempt();
 assert.equal(r.status,"NEEDS_REPAIR");
 assert.equal(f.stats().prepared,0);
 assert.equal(f.stats().removeCalls,0);
 assert.equal(f.stats().committed,0);
});

test("proven source disappearance still delivers exactly one original cargo stack",()=>{
 const f=fixture({after:[],global:[]});
 const r=f.attempt();
 assert.equal(r.status,"DELIVERED");
 assert.equal(r.stacks,1);
 assert.equal(r.quantity,50);
 assert.equal(f.stats().prepared,1);
 assert.equal(f.stats().committed,1);
 assert.equal(f.stats().removeCalls,1);
});

test("P0: depot never credits ore unless native source deletion is durably flushed",()=>{
 for(const flushResult of [null,undefined,false,{}, {success:false},
  {success:0},{success:"true"}]){
  const f=fixture({after:[],global:[],flushResult});
  const result=f.attempt();
  assert.equal(result.status,"NEEDS_REPAIR",String(flushResult));
  assert.equal(result.stacks,0);
  assert.equal(f.stats().prepared,1);
  assert.equal(f.stats().removeCalls,1);
  assert.equal(f.stats().flushes,1);
  assert.equal(f.stats().committed,0,"no virtual supply credit without native disk ACK");
 }
 const throws=fixture({after:[],global:[],throwFlush:true});
 assert.equal(throws.attempt().status,"NEEDS_REPAIR");
 assert.equal(throws.stats().committed,0);
 assert.equal(throws.stats().flushes,1);
});

test("P0: durable commit can only occur after native cargo flush and verified absence",()=>{
 const events=[],sourceOnDisk=new Map([[333,true]]),sourceInMemory=new Map([[333,true]]);
 let committed=0;
 const f=fixture({after:[],global:[]});
 f.store.removeNativeCargo=id=>{
  events.push("remove");
  sourceInMemory.delete(id);
  return {success:true};
 };
 f.database.flushTableSync=table=>{
  assert.equal(table,"npcCargo");
  events.push("flush");
  sourceOnDisk.clear();
  return {success:true};
 };
 f.store.listNativeCargoForEntity=()=>{
  events.push("readback");
  return sourceInMemory.size?[f.cargo]:[];
 };
 f.store.listNativeCargo=()=>{events.push("global-readback");return [];};
 f.depot.commit=()=>{
  events.push("depot-commit");
  assert.equal(sourceOnDisk.size,0,"disk must be clean before virtual credit");
  committed++;
  return {status:"COMMITTED"};
 };
 const result=f.attempt();
 assert.equal(result.status,"DELIVERED");
 assert.equal(result.stacks,1);
 assert.equal(committed,1);
 assert.deepEqual(events,["readback","remove","flush","readback",
  "global-readback","depot-commit"]);
 assert.equal(sourceOnDisk.size,0);
});

test("P0: crash with unflushed native cargo leaves only PREPARED, never COMMITTED",()=>{
 const disk=new Map([[333,true]]);
 const f=fixture({after:[],global:[],flushResult:{success:false}});
 const result=f.attempt();
 assert.equal(result.status,"NEEDS_REPAIR");
 assert.equal(f.stats().prepared,1);
 assert.equal(f.stats().committed,0);
 assert.equal(disk.has(333),true,
  "a cold restart may restore original cargo; depot must not credit it");
});
