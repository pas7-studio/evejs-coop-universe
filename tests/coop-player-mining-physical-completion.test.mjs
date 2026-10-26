import test from "node:test";
import assert from "node:assert/strict";
import {createRequire} from "node:module";
const require=createRequire(import.meta.url);
const {createPhysicalCompletionOracle}=require("../integration/coopPlayerMiningPhysicalCompletion.cjs");
const SYS=30000144,FLEET=9100,NPC=9001,PLAYER=9002,MINER=8122,HAULER=8123,CARGO=2201,
 ITEM=93010,STATION=60001111,ISSUED=1793030000000;
function fixture(){
 const source={cargoID:CARGO,typeID:34,quantity:120,entityID:MINER,
  ownerID:NPC,transient:false,moduleID:0};
 const contents=new Map([[MINER,[source]],[HAULER,[]]]);
 const fleet={systemID:SYS,fleetID:FLEET,ownerID:NPC,minerIDs:[MINER],haulerIDs:[HAULER]};
 const origin={x:1000,y:2000,z:3000};
 const record={systemID:SYS,fleetID:FLEET,state:"hauling",
  originAnchor:{position:origin},lastHauledAtMs:0};
 const row={version:1,status:"FUNDED",operationID:"coop-mining-shift:"+"a".repeat(32),
  corporationID:PLAYER,employerCorpID:NPC,systemID:SYS,fleetID:FLEET,
  minerIDs:[MINER],haulerIDs:[HAULER],directive:"HAUL",commandSeq:4,
  commandState:"NATIVE_REQUESTED",issuedAt:ISSUED,nativeRequestedAt:ISSUED+10,
  originalCargo:[{cargoID:CARGO,typeID:34,quantity:120,minerID:MINER}]};
 let committed={version:1,phase:"COMMITTED",cargoID:CARGO,itemID:ITEM,
  typeID:34,quantity:120,corporationID:NPC,systemID:SYS,fleetID:FLEET,
  stationID:STATION,haulerID:HAULER,at:ISSUED+4000,updatedAt:ISSUED+4100};
 let warehouseItem={itemID:ITEM,typeID:34,quantity:120,stacksize:120,
  locationID:STATION,ownerID:NPC,flagID:4,singleton:0,
  customInfo:"coop-warehouse:v1:cargo:"+CARGO};
 const ships=new Map();
 for(const id of [MINER,HAULER])ships.set(id,{kind:"ship",itemID:id,
  nativeNpc:true,transient:false,position:{...origin,x:origin.x+12000},
  mode:"STOP",isWarping:false,pendingWarp:null,warpState:null});
 const scene={systemID:SYS,getEntityByID:id=>ships.get(id)||null};
 const oracle=createPhysicalCompletionOracle({
  store:{listNativeCargoForEntity:id=>contents.get(id)},
  warehouseReceipt:id=>id===CARGO?committed:null,
  findWarehouseItem:()=>warehouseItem});
 const delivered=()=>{
  contents.get(MINER).length=0;
  record.state="mining";record.lastHauledAtMs=ISSUED+1000;
 };
 const landed=()=>{for(const ship of ships.values())ship.position={...origin}};
 return {oracle,fleet,record,row,ships,scene,origin,contents,
  delivered,landed,receipt:()=>committed,item:()=>warehouseItem,
  setReceipt:x=>committed=x,setItem:x=>warehouseItem=x,
  proof:()=>oracle.verify({row,fleet,fleetRecord:record,scene})};
}
test("source original miner cargo IDs are captured before real native HAUL",()=>{
 const x=fixture();const snap=x.oracle.captureHaul({fleet:x.fleet});
 assert.deepEqual(snap,[{cargoID:CARGO,typeID:34,quantity:120,minerID:MINER}]);
});
test("duplicated original cargoID across miners prevents issuing unverified haul",()=>{
 const x=fixture();x.fleet.minerIDs.push(MINER+1);
 x.contents.set(MINER+1,[{...x.contents.get(MINER)[0],entityID:MINER+1}]);
 assert.equal(x.oracle.captureHaul({fleet:x.fleet}),null);
});
test("no source cargo means no physical evidence and no mine-to-hauler action",()=>{
 const x=fixture();x.contents.get(MINER).length=0;
 assert.equal(x.oracle.captureHaul({fleet:x.fleet}),null);
});
test("virtual stock lastHauled timestamp alone never proves station warehouse delivery",()=>{
 const x=fixture();x.delivered();x.setReceipt(null);
 assert.equal(x.proof(),null);
});
test("a real committed warehouse receipt plus same item and absent cargo proves HAUL completion",()=>{
 const x=fixture();x.delivered();
 const proof=x.proof();
 assert.equal(proof.kind,"ORIGINAL_WAREHOUSE_DELIVERY");
 assert.equal(proof.commandSeq,4);assert.equal(proof.originalCargo[0].itemID,ITEM);
});
test("cargo still on miner or hauler disqualifies the durable warehouse receipt",()=>{
 for(const where of [MINER,HAULER]){
  const x=fixture();x.delivered();
  x.contents.get(where).push({...x.row.originalCargo[0],cargoID:CARGO});
  assert.equal(x.proof(),null);
 }
});
test("uncommitted or stale warehouse receipt cannot end the HAUL",()=>{
 for(const change of [r=>r.phase="PREPARED",r=>r.at=ISSUED-1,
  r=>r.itemID=ITEM+1,r=>r.quantity=119,r=>r.corporationID=PLAYER,
  r=>r.fleetID=FLEET+1,r=>r.haulerID=9876]){
  const x=fixture();x.delivered();change(x.receipt());
  assert.equal(x.proof(),null);
 }
});
test("missing, moved or cloned original stock item cannot count as delivered",()=>{
 for(const change of [i=>i.locationID=STATION+1,i=>i.itemID=ITEM+1,
  i=>i.ownerID=PLAYER,i=>i.quantity=119,i=>i.customInfo="NOT_ORIGINAL"]){
  const x=fixture();x.delivered();change(x.item());
  assert.equal(x.proof(),null);
 }
});
test("stock native still hauling or premature timestamp never claims delivered",()=>{
 const x=fixture();assert.equal(x.proof(),null);
 x.delivered();x.record.state="haulereturn";assert.equal(x.proof(),null);
 x.record.state="mining";x.record.lastHauledAtMs=ISSUED-1;
 assert.equal(x.proof(),null);
});
test("original retreat target is captured from physical fleet origin, not client input",()=>{
 const x=fixture();
 assert.deepEqual(x.oracle.captureRetreat({fleetRecord:x.record,scene:x.scene,fleet:x.fleet}),
  {origin:x.origin,departureShipIDs:[MINER,HAULER]});
});
test("RETREAT requires all original NPC hulls physically landed at the original anchor",()=>{
 const x=fixture();x.row.directive="RETREAT";
 x.row.retreatAnchor={...x.origin};x.row.retreatDepartureShipIDs=[MINER,HAULER];
 x.record.state="retreating";
 assert.equal(x.proof(),null);x.landed();
 const proof=x.proof();
 assert.equal(proof.kind,"ORIGINAL_FLEET_WARP_ARRIVED");
 assert.deepEqual(proof.shipIDs,[MINER,HAULER]);
});
test("warp only requested, one ship still warping => RETREAT never completed",()=>{
 const x=fixture();x.row.directive="RETREAT";x.row.retreatAnchor={...x.origin};x.record.state="retreating";
 x.landed();x.ships.get(HAULER).isWarping=true;assert.equal(x.proof(),null);
 x.ships.get(HAULER).isWarping=false;x.ships.get(HAULER).pendingWarp={};
 assert.equal(x.proof(),null);
});
test("original NPC ship outside physical arrival radius cannot satisfy retreat",()=>{
 const x=fixture();x.row.directive="RETREAT";x.row.retreatAnchor={...x.origin};
 x.record.state="retreating";x.landed();x.ships.get(HAULER).position.x+=3000;
 assert.equal(x.proof(),null);
});
test("forged origin target, wrong fleet identity or missing hull blocks retreat",()=>{
 for(const mutate of [x=>x.row.retreatAnchor.x+=1,
  x=>x.row.fleetID+=1,x=>x.ships.delete(MINER),
  x=>x.record.state="mining",x=>x.ships.get(MINER).nativeNpc=false]){
  const x=fixture();x.row.directive="RETREAT";
  x.row.retreatAnchor={...x.origin};x.row.retreatDepartureShipIDs=[MINER,HAULER];x.record.state="retreating";
  x.landed();mutate(x);assert.equal(x.proof(),null);
 }
});
test("DISPATCH_UNKNOWN can never be reconciled just because ships are at origin",()=>{
 const x=fixture();x.row.directive="RETREAT";x.row.retreatAnchor={...x.origin};
 x.record.state="retreating";x.row.commandState="DISPATCH_UNKNOWN";
 assert.equal(x.proof(),null);
});

test("already-at-origin native hulls cannot manufacture a retreat departure witness",()=>{
 const x=fixture();x.landed();
 assert.equal(x.oracle.captureRetreat({fleetRecord:x.record,scene:x.scene,fleet:x.fleet}),null);
});
test("original retreat completion cannot be faked with missing departure IDs",()=>{
 const x=fixture();x.landed();x.row.directive="RETREAT";
 x.row.retreatAnchor={...x.origin};x.row.retreatDepartureShipIDs=[];
 x.record.state="retreating";assert.equal(x.proof(),null);
});
