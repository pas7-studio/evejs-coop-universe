import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
const source=fs.readFileSync(new URL("../integration/coopNativeHaulCargo.cjs",import.meta.url),"utf8");
function fixture(t,mode="COMMITTED"){
 const flags=["EVEJS_COOP_NATIVE_MINING_FLEET_DURABLE","EVEJS_COOP_NATIVE_HAUL_TRANSFER_ATOMIC",
  "EVEJS_COOP_NATIVE_HAUL_CARGO","EVEJS_COOP_NPC_STATION_DELIVERY",
  "EVEJS_COOP_NATIVE_MINING_CYCLE_ATOMIC","EVEJS_COOP_NATIVE_HAUL_TRANSFER_GUARD"];
 const prev=Object.fromEntries(flags.map(k=>[k,process.env[k]]));
 for(const k of flags)process.env[k]="1";
 t.after(()=>{for(const [k,v] of Object.entries(prev)){
  if(v===undefined)delete process.env[k];else process.env[k]=v;
 }});
 const container={exports:{}};
 new Function("module","exports","require","process",source)(container,container.exports,
  id=>{throw Error("Unexpected live dependency: "+id)},process);
 const ore={cargoID:980200000102,entityID:9001,ownerID:1234,
  typeID:34,categoryID:25,quantity:13,moduleID:0,transient:false};
 const miner={itemID:9001,kind:"ship",ownerID:1234,nativeNpc:true,transient:false,
  position:{x:0,y:0,z:0},radius:50,
  nativeCargoItems:[{itemID:ore.cargoID,volume:0.1,quantity:13,typeID:34}]};
 const hauler={itemID:9002,kind:"ship",typeID:17480,ownerID:1234,nativeNpc:true,
  transient:false,position:{x:500,y:0,z:0},radius:50,nativeCargoItems:[]};
 const scene={systemID:30000142,getEntityByID:id=>id===9002?hauler:id===9001?miner:null};
 const fleet={fleetID:30000142*32+1,systemID:30000142,
  startupKey:"30000142:1",minerEntityIDs:[9001],haulerEntityIDs:[9002]};
 const ops=[];
 const store={
  listNativeCargoForEntity:id=>Number(ore.entityID)===id?[ore]:[],
  listNativeCargo:()=>[ore],
  getNativeEntity:id=>id===9001||id===9002?
    {entityID:id,ownerID:1234,systemID:30000142,transient:false}:null,
  upsertNativeCargo(next){Object.assign(ore,next);ops.push("LEGACY_WRITE");return{success:true}},
  buildNativeCargoItems:id=>id===9002?[]:[],
 };
 const probe={observe:event=>ops.push(event)};
 const atomicMover={transfer(args){ops.push("ATOMIC");
   assert.equal(args.cargoID,ore.cargoID);
   assert.equal(args.hauler.itemID,hauler.itemID);
   if(mode!=="COMMITTED")return{status:mode,reason:mode};
   ore.entityID=hauler.itemID;
   miner.nativeCargoItems=[];
   hauler.nativeCargoItems=[{itemID:ore.cargoID,typeID:34,quantity:13}];
   return{status:"COMMITTED",quantity:13,volumeM3:1.3,cargoID:ore.cargoID};
 }};
 const opts={store,probe,atomicMover,depot:{},
  resolveItemByTypeID:id=>id===34?
    {typeID:34,categoryID:25,volume:0.1}:
    id===17480?{typeID:17480,capacity:1000}:null};
 return{call:()=>container.exports.transferCargo(scene,fleet,miner,opts),
  ops,miner,hauler,fleet,ore,opts};
}
test("strict persistent miner uses atomic writer only AFTER real physical range/capacity/ore checks",t=>{
 const f=fixture(t);assert.equal(f.call(),1.3);
 assert.deepEqual(f.ops.filter(x=>x==="ATOMIC"),["ATOMIC"]);
 assert.equal(f.ops.includes("LEGACY_WRITE"),false);
 assert.equal(f.ops.includes("living-hauler-loaded"),true);
 assert.equal(f.hauler.nativeCargoItems[0].itemID,f.ore.cargoID);
});
test("missing atomic flag blocks durable fleet before any legacy source upsert",t=>{
 const f=fixture(t);delete process.env.EVEJS_COOP_NATIVE_HAUL_TRANSFER_ATOMIC;
 assert.equal(f.call(),0);assert.equal(f.ops.includes("ATOMIC"),false);
 assert.equal(f.ops.includes("LEGACY_WRITE"),false);
 assert.equal(f.fleet.coopHaulNeedsOperatorRepair,"ALIFE10_ATOMIC_HAUL_REQUIRED");
 assert.equal(f.miner.coopMiningCargoNeedsOperatorRepair,"ALIFE10_ATOMIC_HAUL_REQUIRED");
});
test("unknown atomic outcome remains quarantined and is not retried through old native store",t=>{
 const f=fixture(t,"NEEDS_OPERATOR_REPAIR");
 assert.equal(f.call(),0);assert.equal(f.ops.includes("ATOMIC"),true);
 assert.equal(f.ops.includes("LEGACY_WRITE"),false);
 assert.equal(Boolean(f.miner.coopMiningCargoNeedsOperatorRepair),true);
});
test("out-of-range hauler cannot transfer cargo even when atomic writer is available",t=>{
 const f=fixture(t);f.hauler.position={x:100000,y:0,z:0};
 assert.equal(f.call(),0);
 assert.equal(f.ops.includes("ATOMIC"),false);
 assert.equal(f.ore.entityID,9001);
});
test("insufficient original hauler capacity blocks atomic transfer",t=>{
 const f=fixture(t);f.opts.resolveCargoCapacityM3=()=>1;
 assert.equal(f.call(),0);
 assert.equal(f.ops.includes("ATOMIC"),false);
 assert.equal(f.ore.entityID,9001);
});
test("unproven non-ore category cannot be shipped into original ore warehouse",t=>{
 const f=fixture(t);f.ore.categoryID=8;
 assert.equal(f.call(),0);
 assert.equal(f.ops.includes("ATOMIC"),false);
});
test("legacy transient NPC branch remains unchanged",t=>{
 const f=fixture(t);f.miner.transient=true;
 delete process.env.EVEJS_COOP_NATIVE_HAUL_TRANSFER_GUARD;
 assert.equal(f.call(),1.3);
 assert.equal(f.ops.includes("ATOMIC"),false);
 assert.equal(f.ops.includes("LEGACY_WRITE"),true);
});
