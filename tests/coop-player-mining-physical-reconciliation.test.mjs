import test from "node:test";
import assert from "node:assert/strict";
import {createRequire} from "node:module";
const require=createRequire(import.meta.url);
const {createShiftOrders}=require("../integration/coopPlayerMiningShiftOrders.cjs");
const {createPhysicalCompletionOracle}=require("../integration/coopPlayerMiningPhysicalCompletion.cjs");
const SEP="\u001f",SYSTEM=30000144,FLEET=9101,CORP=8001,NPC=8002,
 OP="coop-mining-shift:"+"a".repeat(32),MINER=60002,HAULER=60003,
 CARGO=8102,ITEM=8123,STATION=60000011;
function fixture(){
 const base=1793030000000,session={characterID:123,corporationID:CORP},
 fleet={systemID:SYSTEM,fleetID:FLEET,ownerID:NPC,minerIDs:[MINER],haulerIDs:[HAULER],
  state:"mining",nextThinkAtMs:0},origin={x:102,y:203,z:304},
 record={systemID:SYSTEM,fleetID:FLEET,state:"mining",
  originAnchor:{position:{...origin}},lastHauledAtMs:0};
 const row={version:1,status:"FUNDED",operationID:OP,corporationID:CORP,
  employerCorpID:NPC,systemID:SYSTEM,fleetID:FLEET,minerIDs:[MINER],haulerIDs:[HAULER],
  directive:"MINE",commandState:"IDLE",commandSeq:0};
 const data=new Map([
  ["coopPlayerMiningFleet"+SEP+SYSTEM+":"+FLEET,{
   version:1,corporationID:CORP,employerCorpID:NPC,operationID:OP,
   systemID:SYSTEM,fleetID:FLEET}],
  ["coopPlayerMiningShift"+SEP+OP,row]
 ]);
 let writes=0,poisoned=false,delivery=null,now=base,completionEnabled=true;
 const orig={cargoID:CARGO,typeID:34,quantity:50,entityID:MINER,
  ownerID:NPC,transient:false,moduleID:0};
 const cargo=new Map([[MINER,[orig]],[HAULER,[]]]);
 let item={itemID:ITEM,ownerID:NPC,locationID:STATION,flagID:4,
  singleton:0,stacksize:50,quantity:50,typeID:34,
  customInfo:"coop-warehouse:v1:cargo:"+CARGO};
 const hulls=new Map([[MINER,{kind:"ship",itemID:MINER,nativeNpc:true,
  position:{...origin,x:origin.x+12000},transient:false}],[HAULER,{kind:"ship",itemID:HAULER,
  nativeNpc:true,position:{...origin,x:origin.x+12000},transient:false}]]);
 const scene={systemID:SYSTEM,getEntityByID:id=>hulls.get(id)||null};
 const landed=()=>{for(const ship of hulls.values())ship.position={...origin}};
 const oracle=createPhysicalCompletionOracle({
  store:{listNativeCargoForEntity:id=>cargo.get(id)},
  warehouseReceipt:()=>delivery,
  findWarehouseItem:()=>item
 });
 const db={read:(table,key)=>{
   assert.equal(table,"corporationRuntime");
   const row=data.get(key.slice(1).replace("/",SEP));
   return row?{success:true,data:structuredClone(row)}:
    {success:false,errorMsg:"ENTRY_NOT_FOUND"};
  },coopAtomicNativeRows:{
   mode:"SERVER_INTERNAL_FLAGGED",isPoisoned:()=>poisoned,
   transact(tables,fn){
    assert.deepEqual(tables,["corporationRuntime"]);
    const backup=structuredClone([...data]);
    try{return fn({get:(table,key)=>data.get(key)||null,
      put:(table,key,value)=>{data.set(key,structuredClone(value));writes++}})}
    catch(e){data.clear();for(const [key,val] of backup)data.set(key,val);throw e;}
   }}
 };
 const orders=createShiftOrders({gameStore:db,
  access:{isMember:()=>true,canIndustry:()=>true},
  getFleet:()=>fleet,verifyNativeFleet:()=>true,clock:()=>now,
  enabled:()=>true,completionEnabled:()=>completionEnabled,
  captureHaul:()=>oracle.captureHaul({fleet}),
  captureRetreat:()=>oracle.captureRetreat({fleetRecord:record,scene,fleet}),
  verifyCompletion:({row,fleet})=>oracle.verify({
   row,fleet,fleetRecord:record,scene})});
 const native={deactivate:()=>true,startHaul:()=>{
   record.state=fleet.state="hauling";return true},
   retreat:()=>{record.state=fleet.state="retreating";return 2},
   canResume:()=>true,hasOriginalMinerCargo:()=>cargo.get(MINER).length>0};
 const assign=(command,seq=0)=>orders.assign({session,corporationID:CORP,
  systemID:SYSTEM,fleetID:FLEET,operationID:OP,command,expectedSeq:seq});
 const dispatch=()=>orders.dispatch({fleet,native});
 const current=()=>data.get("coopPlayerMiningShift"+SEP+OP);
 const completedHaul=()=>{
  cargo.get(MINER).length=0;
  record.state=fleet.state="mining";
  record.lastHauledAtMs=now+50;
  delivery={version:1,phase:"COMMITTED",cargoID:CARGO,
   typeID:34,quantity:50,itemID:ITEM,corporationID:NPC,
   systemID:SYSTEM,fleetID:FLEET,stationID:STATION,
   haulerID:HAULER,at:now+25,updatedAt:now+40};
 };
 return {orders,session,record,fleet,origin,scene,cargo,native,assign,dispatch,
  current,writes:()=>writes,completedHaul,landed,
  setDelivery:x=>delivery=x,setItem:x=>item=x,
  enable:v=>completionEnabled=v,poison:v=>poisoned=v,hulls,
  clock:v=>now=v};
}
test("E1 captures real source cargo in ISSUING before first HAUL warp",()=>{
 const x=fixture();assert.equal(x.assign("HAUL").status,"ORDER_QUEUED");
 assert.equal(x.dispatch().status,"NATIVE_ORDER_REQUESTED");
 const r=x.current();
 assert.deepEqual(r.originalCargo,[{cargoID:CARGO,typeID:34,quantity:50,minerID:MINER}]);
 assert.equal(r.commandState,"NATIVE_REQUESTED");
});
test("HAUL requires physical original warehouse delivery not a passed timer",()=>{
 const x=fixture();x.assign("HAUL");x.dispatch();
 x.record.state=x.fleet.state="mining";
 x.record.lastHauledAtMs=x.current().issuedAt+1000;
 assert.equal(x.dispatch().status,"NATIVE_ORDER_PREVIOUSLY_REQUESTED");
 assert.equal(x.current().commandState,"NATIVE_REQUESTED");
});
test("fully delivered original HAUL commits one native NATIVE_COMPLETED proof",()=>{
 const x=fixture();x.assign("HAUL");x.dispatch();x.completedHaul();
 assert.equal(x.dispatch().status,"NATIVE_COMPLETED");
 assert.equal(x.current().commandState,"NATIVE_COMPLETED");
 assert.equal(x.current().completionProof.kind,"ORIGINAL_WAREHOUSE_DELIVERY");
 const count=x.writes();
 assert.equal(x.dispatch().status,"NATIVE_COMPLETION_PREVIOUSLY_PROVEN");
 assert.equal(x.writes(),count);
});
test("after original committed warehouse receipt, manager may safely requeue mining",()=>{
 const x=fixture();x.assign("HAUL");x.dispatch();x.completedHaul();x.dispatch();
 assert.equal(x.assign("MINE",1).status,"ORDER_QUEUED");
 assert.equal(x.current().commandSeq,2);
});
test("original warehouse item missing or transferred before reconciliation never clears cargo fence",()=>{
 const x=fixture();x.assign("HAUL");x.dispatch();x.completedHaul();
 x.setItem(null);assert.equal(x.dispatch().status,"NATIVE_ORDER_PREVIOUSLY_REQUESTED");
 assert.equal(x.assign("MINE",1).reason,"MINING_SHIFT_PREVIOUS_NATIVE_ORDER_ACTIVE");
});
test("source cargo changes before issuing => HAUL is not called or durably issued",()=>{
 const x=fixture();x.assign("HAUL");x.cargo.get(MINER).length=0;
 assert.equal(x.dispatch().status,"WAITING_FOR_ORIGINAL_MINER_CARGO");
 assert.equal(x.current().commandState,"PENDING");
 assert.equal(x.record.state,"mining");
});
test("RETREAT stores the exact native origin before issuing a warp",()=>{
 const x=fixture();x.assign("RETREAT");
 assert.equal(x.dispatch().status,"NATIVE_ORDER_REQUESTED");
 assert.deepEqual(x.current().retreatAnchor,x.origin);
 assert.deepEqual(x.current().retreatDepartureShipIDs,[MINER,HAULER]);
});
test("RETREAT landing cannot be proved while even one original hull remains in warp",()=>{
 const x=fixture();x.assign("RETREAT");x.dispatch();
 x.landed();x.hulls.get(HAULER).pendingWarp={target:"origin"};
 assert.equal(x.dispatch().status,"NATIVE_ORDER_PREVIOUSLY_REQUESTED");
 assert.equal(x.current().commandState,"NATIVE_REQUESTED");
});
test("retreated fleet original real hulls at origin commit completion once",()=>{
 const x=fixture();x.assign("RETREAT");x.dispatch();
 assert.equal(x.dispatch().status,"NATIVE_ORDER_PREVIOUSLY_REQUESTED");
 x.landed();assert.equal(x.dispatch().status,"NATIVE_COMPLETED");
 assert.equal(x.current().completionProof.kind,"ORIGINAL_FLEET_WARP_ARRIVED");
 const count=x.writes();
 assert.equal(x.dispatch().status,"NATIVE_COMPLETION_PREVIOUSLY_PROVEN");
 assert.equal(x.writes(),count);
});
test("after retreat proof original native fleet can receive MINE when safe",()=>{
 const x=fixture();x.assign("RETREAT");x.dispatch();x.landed();x.dispatch();
 assert.equal(x.assign("MINE",1).status,"ORDER_QUEUED");
 assert.equal(x.dispatch().status,"NATIVE_ORDER_REQUESTED");
});
test("DISPATCH_UNKNOWN stays blocked even if all original NPCs appear at origin",()=>{
 const x=fixture();x.assign("RETREAT");x.dispatch();
 x.current().commandState="DISPATCH_UNKNOWN";
 assert.equal(x.dispatch().reason,"MINING_SHIFT_NATIVE_OUTCOME_UNKNOWN");
 assert.equal(x.assign("MINE",1).reason,"MINING_SHIFT_PENDING_NATIVE_OUTCOME");
});
test("native warehouse transaction poison blocks a completion write",()=>{
 const x=fixture();x.assign("HAUL");x.dispatch();x.completedHaul();x.poison(true);
 assert.equal(x.dispatch().reason,"NATIVE_ATOMIC_STORE_POISONED");
 assert.equal(x.current().commandState,"NATIVE_REQUESTED");
});
test("completion feature OFF preserves old Stage B native requested semantics",()=>{
 const x=fixture();x.enable(false);x.assign("HAUL");x.dispatch();
 assert.equal(x.current().originalCargo,undefined);
 x.completedHaul();assert.equal(x.dispatch().status,"NATIVE_ORDER_PREVIOUSLY_REQUESTED");
});

test("warp never starts if all original ships are already within the destination radius",()=>{
 const x=fixture();x.landed();x.assign("RETREAT");
 assert.equal(x.dispatch().reason,"MINING_SHIFT_RETREAT_ORIGIN_NOT_ATTESTED");
 assert.equal(x.current().commandState,"PENDING");
});
