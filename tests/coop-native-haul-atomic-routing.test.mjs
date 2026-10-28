import test from "node:test";
import {withEnv} from "./_support/env.mjs";
import assert from "node:assert/strict";
import fs from "node:fs";
import {createRequire} from "node:module";
const require=createRequire(import.meta.url);
const source=fs.readFileSync(new URL("../integration/coopNativeHaulCargo.cjs",import.meta.url),"utf8");
function fixture(t,mode="COMMITTED"){
 const flags=["EVEJS_COOP_NATIVE_MINING_FLEET_DURABLE","EVEJS_COOP_NATIVE_HAUL_TRANSFER_ATOMIC",
  "EVEJS_COOP_NATIVE_HAUL_CARGO","EVEJS_COOP_NPC_STATION_DELIVERY",
  "EVEJS_COOP_NATIVE_MINING_CYCLE_ATOMIC","EVEJS_COOP_NATIVE_HAUL_TRANSFER_GUARD"];
 withEnv(t,flags.map(k=>[k,"1"]));
 const container={exports:{}};
 // The module loads three co-op helpers at load time (cargo promotion, telemetry
 // and flag reading). Audit every *other* dependency strictly, but give those
 // three faithful stubs so the test keeps looking at behaviour, not require paths.
 const stubs={
  // The durable-write helper and the flag reader are real: the legacy branch must
  // actually write through the fixture's store. Only telemetry is stubbed, so the
  // event still reaches the fixture's probe.
  "./coopDurableCargoWrite":require("../integration/coopDurableCargoWrite.cjs"),
  "./coopFlags":require("../integration/coopFlags.cjs"),
  "./coopObserve":{observe:(probe,event)=>{try{probe?.observe?.(event);return true}catch{return false}}},
 };
 const resolve=id=>{
  const name=id.replace(/\.c?js$/,"");
  if(stubs[name])return stubs[name];
  throw Error("Unexpected live dependency: "+id);
 };
 new Function("module","exports","require","process",source)(container,container.exports,
  resolve,process);
 const ore={cargoID:980200000102,entityID:9001,ownerID:1234,
  typeID:34,categoryID:25,quantity:13,moduleID:0,transient:false};
 let cargo={...ore};
 const miner={itemID:9001,kind:"ship",ownerID:1234,nativeNpc:true,transient:false,
  position:{x:0,y:0,z:0},radius:50,
  nativeCargoItems:[{itemID:ore.cargoID,volume:0.1,quantity:13,typeID:34}]};
 const hauler={itemID:9002,kind:"ship",typeID:17480,ownerID:1234,nativeNpc:true,
  transient:false,position:{x:500,y:0,z:0},radius:50,nativeCargoItems:[]};
 const scene={systemID:30000142,getEntityByID:id=>id===9002?hauler:id===9001?miner:null};
 const fleet={fleetID:30000142*32+1,systemID:30000142,
  startupKey:"30000142:1",minerEntityIDs:[9001],haulerEntityIDs:[9002]};
 const ops=[];
 let lastMax=null;
 const store={
  listNativeCargoForEntity:id=>Number(cargo.entityID)===id?[cargo]:[],
  listNativeCargo:()=>[cargo],
  getNativeEntity:id=>id===9001||id===9002?
    {entityID:id,ownerID:1234,systemID:30000142,transient:false}:null,
  upsertNativeCargo(next){cargo={...cargo,...next};ops.push("LEGACY_WRITE");return{success:true}},
  buildNativeCargoItems:id=>id===9002?[]:[],
 };
 const probe={observe:event=>ops.push(event)};
 const atomicMover={transfer(args){ops.push("ATOMIC");
   lastMax=args.maxQuantity===undefined?null:args.maxQuantity;
   assert.equal(args.cargoID,cargo.cargoID);
   assert.equal(args.hauler.itemID,hauler.itemID);
   if(mode!=="COMMITTED")return{status:mode,reason:mode};
   // A partial request moves only that many units and keeps the rest on the miner,
   // exactly like the real single-transaction split. The caller's source object is
   // never mutated: the mover writes copies.
   const wanted=args.maxQuantity===undefined||args.maxQuantity===null?
     Number(cargo.quantity):Number(args.maxQuantity);
   const partial=wanted<Number(cargo.quantity);
   if(partial){
    const newID=cargo.cargoID+7;
    cargo={...cargo,quantity:Number(cargo.quantity)-wanted};
    miner.nativeCargoItems=[{itemID:cargo.cargoID,typeID:34,quantity:cargo.quantity}];
    hauler.nativeCargoItems=[...hauler.nativeCargoItems,
     {itemID:newID,typeID:34,quantity:wanted}];
    return{status:"COMMITTED",quantity:wanted,volumeM3:wanted*0.1,cargoID:newID,
     sourceCargoID:cargo.cargoID,partial:true};
   }
   cargo={...cargo,entityID:hauler.itemID};
   miner.nativeCargoItems=[];
   hauler.nativeCargoItems=[{itemID:cargo.cargoID,typeID:34,quantity:wanted}];
   return{status:"COMMITTED",quantity:wanted,volumeM3:wanted*0.1,cargoID:cargo.cargoID};
 }};
 const opts={store,probe,atomicMover,depot:{},
  database:{setTransientPath:()=>{},flushTableSync:()=>({success:true})},
  resolveItemByTypeID:id=>id===34?
    {typeID:34,categoryID:25,volume:0.1}:
    id===17480?{typeID:17480,capacity:1000}:null};
 return{call:()=>container.exports.transferCargo(scene,fleet,miner,opts),
  ops,miner,hauler,fleet,get ore(){return cargo},
  getLastMax:()=>lastMax,opts};
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
test("a hauler that cannot hold the whole stack takes only what physically fits",t=>{
 // Measured live: 8 000-18 000 m3 of ore on a miner, and no industrial hull in the
 // mining pools holds more than 5 500 m3. Refusing forever is what left 93 mined
 // cycles sitting in the belt, so the hauler takes a full hold and the rest stays.
 const f=fixture(t);f.opts.resolveCargoCapacityM3=()=>1;
 assert.equal(f.call(),0.9);
 assert.equal(f.getLastMax(),9,"only 9 of 13 units fit a 1 m3 hold");
 assert.equal(f.ops.includes("ATOMIC"),true);
 assert.equal(f.ore.entityID,9001,"the unmoved remainder never leaves the miner");
 assert.equal(f.ore.quantity,4);
 assert.equal(f.hauler.nativeCargoItems[0].quantity,9);
});
test("a hauler with no room for even one unit is skipped instead of balancing the books",t=>{
 const f=fixture(t);f.opts.resolveCargoCapacityM3=()=>0.05;
 assert.equal(f.call(),0);
 assert.equal(f.ops.includes("ATOMIC"),false);
 assert.equal(f.ore.entityID,9001);
 assert.equal(f.ore.quantity,13);
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
