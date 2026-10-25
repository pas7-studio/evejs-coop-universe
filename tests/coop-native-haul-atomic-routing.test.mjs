import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
const source=fs.readFileSync(new URL("../integration/coopNativeHaulCargo.cjs",import.meta.url),"utf8");
function fixture(t,mode="COMMITTED"){
 const flags=["EVEJS_COOP_NATIVE_MINING_FLEET_DURABLE","EVEJS_COOP_NATIVE_HAUL_TRANSFER_ATOMIC"];
 const previous=Object.fromEntries(flags.map(k=>[k,process.env[k]]));
 for(const k of flags)process.env[k]="1";
 t.after(()=>{for(const [k,v] of Object.entries(previous)){
  if(v===undefined)delete process.env[k];else process.env[k]=v;
 }});
 const container={exports:{}};
 new Function("module","exports","require","process",source)(container,container.exports,
  id=>{throw Error("Unexpected live dependency: "+id)},process);
 const ore={cargoID:980200000102,entityID:9001,ownerID:1234,
  typeID:34,quantity:13,moduleID:0,transient:false};
 const miner={itemID:9001,kind:"ship",transient:false,nativeCargoItems:[{itemID:ore.cargoID,volume:0.1}]};
 const hauler={itemID:9002,kind:"ship",transient:false,ownerID:1234,nativeCargoItems:[]};
 const scene={getEntityByID:id=>id===9002?hauler:id===9001?miner:null};
 const fleet={fleetID:30000142*32+1,systemID:30000142,
  startupKey:"30000142:1",haulerEntityIDs:[9002]};
 const ops=[];
 const store={
  listNativeCargoForEntity:id=>Number(ore.entityID)===id?[ore]:[],
  upsertNativeCargo(next){Object.assign(ore,next);ops.push("LEGACY_WRITE");return{success:true}},
  buildNativeCargoItems(){return[]},
 };
 const probe={observe:event=>ops.push(event)};
 const atomicMover={transfer(args){ops.push("ATOMIC");
   assert.equal(args.cargoID,ore.cargoID);
   if(mode!=="COMMITTED")return{status:mode,reason:mode};
   return{status:"COMMITTED",quantity:13,volumeM3:1.3,cargoID:ore.cargoID};
 }};
 return {call:()=>container.exports.transferCargo(scene,fleet,miner,{store,probe,atomicMover}),
  ops,miner,hauler,fleet};
}
test("strict persistent fleet calls original native atomic transfer, never old upsert",t=>{
 const f=fixture(t);assert.equal(f.call(),1.3);
 assert.deepEqual(f.ops.filter(x=>x==="ATOMIC"),["ATOMIC"]);
 assert.equal(f.ops.includes("LEGACY_WRITE"),false);
 assert.equal(f.ops.includes("living-hauler-loaded"),true);
});
test("missing atomic flag blocks persistent fleet BEFORE any non-atomic upsert",t=>{
 const f=fixture(t);delete process.env.EVEJS_COOP_NATIVE_HAUL_TRANSFER_ATOMIC;
 assert.equal(f.call(),0);
 assert.equal(f.ops.includes("ATOMIC"),false);
 assert.equal(f.ops.includes("LEGACY_WRITE"),false);
 assert.equal(f.fleet.coopHaulCargoNeedsOperatorRepair,"ALIFE10_ATOMIC_TRANSFER_FLAG_REQUIRED");
});
test("uncertain atomic result never falls back to legacy GameStore writes",t=>{
 const f=fixture(t,"NEEDS_OPERATOR_REPAIR");
 assert.equal(f.call(),0);
 assert.equal(f.ops.includes("ATOMIC"),true);
 assert.equal(f.ops.includes("LEGACY_WRITE"),false);
 assert.equal(f.ops.includes("living-hauler-atomic-cargo-blocked"),true);
});
test("native transient miner remains on existing historical transfer path",t=>{
 const f=fixture(t);f.miner.transient=true;
 assert.equal(f.call(),1.3);
 assert.equal(f.ops.includes("ATOMIC"),false);
 assert.equal(f.ops.includes("LEGACY_WRITE"),true);
});
