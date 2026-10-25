import test from "node:test";
import assert from "node:assert/strict";
import {createRequire} from "node:module";
const require=createRequire(import.meta.url);
const {createAtomicHaulMover,receiptKey}=require("../integration/coopNativeHaulTransferAtomic.cjs");
const systemID=30000142,slot=1,fleetID=systemID*32+slot,minerID=980000000001,haulerID=980000000002,cargoID=980200000001;
const clone=v=>structuredClone(v);
function fixture(t,options={}){
 const prev={};
 for(const k of ["EVEJS_COOP_NATIVE_HAUL_TRANSFER_ATOMIC","EVEJS_COOP_NATIVE_ATOMIC_ROWS",
 "EVEJS_COOP_NATIVE_MINING_FLEET_DURABLE","EVEJS_COOP_NATIVE_HAUL_CARGO",
 "EVEJS_COOP_NPC_STATION_DELIVERY"]){
  prev[k]=process.env[k];process.env[k]="1";
 }
 t.after(()=>{for(const [k,v] of Object.entries(prev)){
  if(v===undefined)delete process.env[k];else process.env[k]=v;
 }});
 const miner={kind:"ship",itemID:minerID,ownerID:1000035,nativeNpc:true,transient:false,
   nativeCargoItems:[{itemID:cargoID,quantity:25,typeID:34,volume:0.1}]};
 const hauler={kind:"ship",itemID:haulerID,ownerID:1000035,nativeNpc:true,transient:false,nativeCargoItems:[]};
 const scene={systemID,getEntityByID:id=>id===minerID?miner:id===haulerID?hauler:null};
 const fleet={systemID,fleetID,startupKey:systemID+":"+slot,
  minerEntityIDs:[minerID],haulerEntityIDs:[haulerID]};
 const marker=role=>"coop-mining-"+systemID+"-"+slot+"-"+role;
 const actor=(id,role)=>({entityID:id,ownerID:1000035,systemID,transient:false,operatorKind:marker(role)});
 const controller=(id,role)=>({entityID:id,systemID,transient:false,operatorKind:marker(role)});
 const nativeEntities=new Map([[minerID,actor(minerID,"miner")],[haulerID,actor(haulerID,"hauler")]]);
 const controllers=new Map([[minerID,controller(minerID,"miner")],[haulerID,controller(haulerID,"hauler")]]);
 const ore={cargoID,typeID:34,quantity:25,entityID:minerID,ownerID:1000035,moduleID:0,
   transient:false,itemName:"Tritanium"};
 let rows=new Map([["cargo",{[String(cargoID)]:clone(ore)}]]);
 let commitMode="ok",txCalls=0;
 const authority={
  transact(tables,fn){
   txCalls++;
   assert.deepEqual(tables,["npcCargo"]);
   const writable=new Map([...rows].map(([key,value])=>[key,clone(value)]));
   const tx={
    get(table,key){assert.equal(table,"npcCargo");return clone(writable.get(key)??null)},
    put(table,key,value){assert.equal(table,"npcCargo");writable.set(key,clone(value));}
   };
   if(commitMode==="source-stale"){
    const root=writable.get("cargo");root[String(cargoID)].quantity++;
   }
   const result=fn(tx);
   if(commitMode==="reject")throw Error("SIMULATED_BEGIN_OR_ROLLBACK");
   rows=writable;
   if(commitMode==="unknown")throw Error("SIMULATED_COMMIT_ACK_LOST");
   return result;
  }
 };
 const store={
  getNativeEntity:id=>nativeEntities.get(id)||null,
  getNativeController:id=>controllers.get(id)||null,
  listNativeCargoForEntity:id=>Object.values(rows.get("cargo")||{}).filter(v=>v.entityID===id).map(clone),
  buildNativeCargoItems:id=>store.listNativeCargoForEntity(id).map(v=>({
   itemID:v.cargoID,typeID:v.typeID,ownerID:v.ownerID,locationID:v.entityID,quantity:v.quantity})),
 };
 const mover=createAtomicHaulMover({gameStore:{coopAtomicNativeRows:authority},nativeStore:store,
  resolveType:id=>({typeID:id,volume:0.1}),clock:()=>456789});
 const transfer=()=>mover.transfer({scene,fleet,miner,hauler,cargoID});
 return {miner,hauler,scene,fleet,store,nativeEntities,controllers,transfer,rows:()=>rows,
  getOre:()=>clone(rows.get("cargo")[String(cargoID)]),receipt:()=>rows.get(receiptKey(cargoID)),
  setMode:mode=>commitMode=mode,txCalls:()=>txCalls};
}
test("one SQLite commit keeps original cargoID and writes immutable same-commit receipt",t=>{
 const f=fixture(t),result=f.transfer();
 assert.equal(result.status,"COMMITTED");
 assert.equal(result.cargoID,cargoID);
 assert.equal(result.quantity,25);
 assert.equal(result.volumeM3,2.5);
 assert.equal(f.txCalls(),1);
 assert.equal(Object.keys(f.rows().get("cargo")).length,1);
 assert.equal(f.getOre().entityID,haulerID);
 assert.equal(f.getOre().coopHaulOriginalOwnerID,1000035);
 assert.equal(f.getOre().coopHaulFromMinerID,minerID);
 assert.equal(f.getOre().coopHaulFleetID,fleetID);
 assert.equal(f.receipt().status,"COMMITTED");
 assert.equal(f.receipt().cargoID,cargoID);
 assert.equal(f.receipt().afterHash,result.receipt.afterHash);
 assert.equal(f.store.listNativeCargoForEntity(minerID).length,0);
 assert.equal(f.hauler.nativeCargoItems[0].itemID,cargoID);
 assert.equal(f.miner.nativeCargoItems.length,0);
});
test("failed transaction rolls back ore location and never reports success",t=>{
 const f=fixture(t);f.setMode("reject");
 const r=f.transfer();
 assert.equal(r.status,"NEEDS_OPERATOR_REPAIR");
 assert.equal(f.getOre().entityID,minerID);
 assert.equal(f.receipt(),undefined);
 assert.equal(f.miner.nativeCargoItems.length,1);
 assert.equal(f.hauler.nativeCargoItems.length,0);
});
test("lost COMMIT ACK never repeats transfer, even if SQLite moved cargo",t=>{
 const f=fixture(t);f.setMode("unknown");
 assert.equal(f.transfer().status,"NEEDS_OPERATOR_REPAIR");
 assert.equal(f.getOre().entityID,haulerID);
 assert.equal(f.receipt().status,"COMMITTED");
 assert.equal(f.transfer().status,"NEEDS_OPERATOR_REPAIR");
 assert.equal(f.txCalls(),1);
});
test("another writer modifying quantity between preflight and BEGIN causes rollback",t=>{
 const f=fixture(t);f.setMode("source-stale");
 assert.equal(f.transfer().status,"NEEDS_OPERATOR_REPAIR");
 assert.equal(f.getOre().entityID,minerID);
 assert.equal(f.getOre().quantity,25);
 assert.equal(f.receipt(),undefined);
});
test("spoofed source owner rejected before touching SQLite",t=>{
 const f=fixture(t);f.rows().get("cargo")[String(cargoID)].ownerID=999999;
 assert.equal(f.transfer().status,"NEEDS_OPERATOR_REPAIR");
 assert.equal(f.txCalls(),0);
});
test("non-persistent native controller is refused",t=>{
 const f=fixture(t);f.controllers.get(minerID).transient=true;
 assert.equal(f.transfer().status,"NEEDS_OPERATOR_REPAIR");
 assert.equal(f.txCalls(),0);
});
test("invalid or substituted fleetID cannot claim original cargo",t=>{
 const f=fixture(t);f.fleet.fleetID++;
 assert.equal(f.transfer().status,"NEEDS_OPERATOR_REPAIR");
 assert.equal(f.txCalls(),0);
});
test("missing strict flag never uses legacy or atomic source",t=>{
 const f=fixture(t);delete process.env.EVEJS_COOP_NATIVE_HAUL_TRANSFER_ATOMIC;
 assert.equal(f.transfer().status,"BLOCKED_FLAGS");
 assert.equal(f.txCalls(),0);
 assert.equal(f.getOre().entityID,minerID);
});
test("cargo already marked with different fleet cannot be reparented",t=>{
 const f=fixture(t);f.rows().get("cargo")[String(cargoID)].coopHaulFleetID=1234;
 assert.equal(f.transfer().status,"NEEDS_OPERATOR_REPAIR");
 assert.equal(f.txCalls(),0);
});
test("same cargo already has a transfer receipt: no overwrite or second commit",t=>{
 const f=fixture(t);
 f.rows().set(receiptKey(cargoID),{status:"COMMITTED",cargoID});
 assert.equal(f.transfer().status,"NEEDS_OPERATOR_REPAIR");
 assert.equal(f.getOre().entityID,minerID);
 assert.equal(f.receipt().status,"COMMITTED");
});
test("damaged native ship scene identity blocks cargo transaction",t=>{
 const f=fixture(t);f.miner.nativeNpc=false;
 assert.equal(f.transfer().status,"NEEDS_OPERATOR_REPAIR");
 assert.equal(f.txCalls(),0);
});
test("real cargo moves under same ID even if its metadata has unusual extra fields",t=>{
 const f=fixture(t);f.rows().get("cargo")[String(cargoID)].sourceTag="original-mining";
 const result=f.transfer();assert.equal(result.status,"COMMITTED");
 assert.equal(f.getOre().sourceTag,"original-mining");
});

test("postcommit in-memory cargo builder fails closed without another debit or phantom scene mutation",t=>{
 const f=fixture(t);
 f.store.buildNativeCargoItems=()=>{throw Error("SIMULATED_AFTER_COMMIT_RECONCILE_FAILURE")};
 const result=f.transfer();
 assert.equal(result.status,"NEEDS_OPERATOR_REPAIR");
 assert.equal(f.getOre().entityID,haulerID);
 assert.equal(f.receipt().status,"COMMITTED");
 assert.equal(f.miner.nativeCargoItems.length,1);
 assert.equal(f.hauler.nativeCargoItems.length,0);
 assert.equal(f.transfer().status,"NEEDS_OPERATOR_REPAIR");
 assert.equal(f.txCalls(),1);
});
