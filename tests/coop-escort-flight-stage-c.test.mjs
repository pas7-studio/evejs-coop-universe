import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import {createRequire} from "node:module";
const require=createRequire(import.meta.url);
const {createEscortFlightGate}=require("../integration/coopEscortFlightGate.cjs");
const {createEscortContractSettlement}=require("../integration/coopEscortContractSettlement.cjs");
const {createStationArrival}=require("../integration/coopNativeStationArrival.cjs");
const {createManifest}=require("../integration/coopNativeHaulManifest.cjs");
const envKeys=["EVEJS_COOP_ESCORT_ROUTE_GATE","EVEJS_COOP_NATIVE_HAUL_MANIFEST","EVEJS_COOP_ESCORT_CONTRACTS"];
const old=Object.fromEntries(envKeys.map(k=>[k,process.env[k]]));
for(const k of envKeys)process.env[k]="1";
function fixture(opts={}){
 const root=fs.mkdtempSync(path.join(os.tmpdir(),"escort-stage-c-"));
 const systemID=30000144,fleetID=77,haulerID=901,stationID=600001,
  corporationID=1000035,contractID="escort-stage-c-001",startAt=1000000;
 let now=startAt,reserves=0,payments=0,warps=0,deposits=0,escrow=null,paid=null;
 const station={stationID,corporationID,solarSystemID:systemID};
 const point={itemID:stationID,kind:"station",position:{x:10000,y:0,z:0},radius:500};
 const ship={itemID:haulerID,kind:"ship",nativeNpc:true,transient:false,mode:"STOP",
  position:{x:0,y:0,z:0},radius:100};
 const scene={systemID,staticEntities:[point],getEntityByID:id=>id===haulerID?ship:null};
 const fleet={systemID,fleetID,haulerEntityIDs:[haulerID]};
 const cargo=new Map([501,502].map((id,i)=>[id,{cargoID:id,entityID:haulerID,
  coopHaulFleetID:fleetID,coopHaulFromMinerID:800,typeID:34+i,
  quantity:7+i,moduleID:0,transient:false}]));
 const stock=new Map();
 const store={listNativeCargoForEntity:()=>[...cargo.values()],
  buildNativeCargoItems:()=>[...cargo.values()]};
 const items={findWarehouseItem:({cargoID})=>stock.get(cargoID)||null};
 const native=id=>id===haulerID?{entityID:haulerID,systemID,transient:false}:null;
 const manifest=createManifest({root,store,items,getNativeEntity:native});
 const nativeFunds={
  capabilities:()=>({nativeDurable:true,atomicDualCredit:true,durableIdempotency:true}),
  verifyReservation:c=>escrow?.contractID===c.contractID?escrow:{status:"NOT_FOUND"},
  reserveAtomic:c=>{reserves++;if(opts.ambiguousReserve)throw Error("LOST_ACK");
   escrow={status:"RESERVED",contractID:c.contractID,corporationID:c.corporationID,
    amountISK:c.amountISK,escrowKey:c.contractID,nativeDurable:true};return escrow;},
  verifySettlement:()=>paid||{status:"NOT_FOUND"},
  settleAtomic:c=>{payments++;paid={status:"SETTLED",contractID:c.contractID,
   corporationID:c.corporationID,amountISK:c.amountISK,escrowKey:c.contractID,
   escrowConsumed:true,nativeDurable:true,credits:c.credits};return paid;}
 };
 const offer=trip=>({status:opts.denyOffer?"DENIED":"AUTHORIZED_NATIVE_ESCORT_BOOKING",
  contractID,manifestKey:trip.manifestKey,systemID:trip.systemID,fleetID:trip.fleetID,
  haulerID:trip.haulerID,stationID:trip.stationID,
  corporationID:trip.corporationID,characters:[701,702],amountISK:20000});
 const newFlight=()=>createEscortFlightGate({root,clock:()=>now,authorizeBooking:offer,
  readManifest:manifest.read,verifyManifest:manifest.verify,nativeFunds});
 const flight=newFlight();
 const warehouse={deposit:args=>{
  deposits++;const row=cargo.get(args.cargoID);
  if(!row)return {status:"SOURCE_NOT_FOUND"};
  if(opts.failDeposit)return {status:"STORE_WRITE_FAILED"};
  cargo.delete(row.cargoID);
  if(!opts.missingReceipt){
   const itemID=row.cargoID+1000;
   stock.set(row.cargoID,{itemID,typeID:row.typeID,quantity:row.quantity,
    ownerID:corporationID,locationID:stationID,
    customInfo:"coop-warehouse:v1:cargo:"+row.cargoID});
   fs.mkdirSync(path.join(root,"receipts"),{recursive:true});
   fs.writeFileSync(path.join(root,"receipts",String(row.cargoID)+".json"),JSON.stringify({
    version:1,phase:"COMMITTED",cargoID:row.cargoID,haulerID,
    systemID,fleetID,stationID,corporationID,typeID:row.typeID,
    quantity:row.quantity,itemID}));
  }
  return {status:"COMMITTED"};
 }};
 const gateway=opts.missingGate?null:opts.failTerminal?{
  fundBeforeWarp:x=>flight.fundBeforeWarp(x),
  recordDelivered:()=>({status:"SIMULATED_TERMINAL_WRITE_FAILURE"})}:flight;
 const stationDirector=createStationArrival({getStations:()=>[station],
  getStation:id=>id===stationID?station:null,
  getCorporation:id=>id===corporationID?{corporationID:id}:null,
  isNpcCorporation:id=>id===corporationID,getNativeEntity:native,
  getScene:()=>scene,store,items,flush:()=>({success:true}),
  warpToPoint:()=>{warps++;return {success:true}},
  warehouse,manifest,escortGate:gateway,root,clock:()=>now});
 const manifestKey=String(systemID)+"-"+fleetID+"-"+startAt;
 const contract=()=>({contractID,manifestKey,systemID,fleetID,haulerID,
  stationID,corporationID,amountISK:20000,characters:[701,702],
  pirateID:202,incidentKey:String(systemID)+":202:"+haulerID,fleetDuoID:33});
 const laterSettlement=()=>createEscortContractSettlement({
  root,clock:()=>now,nativeFunds,readManifest:manifest.read,
  verifyManifest:manifest.verify,authorizeOffer:c=>({status:"AUTHORIZED_NATIVE_ESCORT",...c}),
  readIncidents:()=>({status:"READY",incidents:[{key:contract().incidentKey,
   systemID,pirateID:202,targetID:haulerID,targetRole:"hauler",
   duoFleetID:33,characters:[701,702],status:"PIRATE_WRECK_CONFIRMED",
   closed:true,nativeWreckID:9901}]}),
  readOutcomes:()=>({status:"READY",outcomes:[{key:contract().incidentKey,
   haulerNativeWreckID:0,verifiedWarehouseStacks:[...stock.entries()].map(([cargoID,s])=>({
    cargoID,itemID:s.itemID,quantity:s.quantity,typeID:s.typeID,
    stationID,ownerID:corporationID}))}]}),
  readNativeDelivery:c=>newFlight().readNativeDelivery(c),
  readPrefunded:c=>newFlight().readFunded(c)});
 const start=()=>stationDirector.start(scene,fleet,startAt);
 const tick=t=>{now=t;return stationDirector.tick(scene,fleet,now)};
 const arrive=()=>{ship.position={...point.position};tick(1003000);return tick(1006000)};
 return {root,fleet,ship,start,tick,arrive,manifestKey,contract,flight,newFlight,laterSettlement,
  reserves:()=>reserves,warps:()=>warps,payments:()=>payments,deposits:()=>deposits,
  loseEscrow:()=>escrow=null,close:()=>fs.rmSync(root,{recursive:true,force:true})};
}
function run(fn,opts){const f=fixture(opts);try{fn(f)}finally{f.close()}}
test("escrow is durable before first physical native warp",()=>run(f=>{
 assert.equal(f.start().status,"EN_ROUTE");
 assert.equal(f.reserves(),1);assert.equal(f.warps(),1);
 assert.equal(f.newFlight().read(f.manifestKey).phase,"FUNDED");
}));
test("invalid trusted booking blocks warp and debit",()=>run(f=>{
 assert.equal(f.start().status,"ESCORT_FLIGHT_BOOKING_NOT_AUTHORIZED");
 assert.equal(f.reserves(),0);assert.equal(f.warps(),0);
},{denyOffer:true}));
test("no real flight gate blocks first native warp",()=>run(f=>{
 assert.equal(f.start().status,"ESCORT_ROUTE_GATE_UNAVAILABLE");
 assert.equal(f.warps(),0);
},{missingGate:true}));
test("unknown reserve result is not replayed after restart",()=>run(f=>{
 assert.match(f.start().status,/RESERVATION_UNCERTAIN/);
 assert.equal(f.reserves(),1);assert.equal(f.warps(),0);
 assert.equal(f.newFlight().read(f.manifestKey).phase,"FUNDING_PREPARED");
 assert.notEqual(f.start().status,"EN_ROUTE");
 assert.equal(f.reserves(),1);
},{ambiguousReserve:true}));
test("station proximity, dwell and all receipts produce durable DELIVERED",()=>run(f=>{
 f.start();
 assert.equal(f.tick(1002000).status,"AWAITING_PHYSICAL_ARRIVAL");
 assert.equal(f.arrive().status,"DELIVERED");
 assert.equal(f.newFlight().read(f.manifestKey).phase,"DELIVERED");
 assert.equal(f.newFlight().readNativeDelivery(f.contract()).status,"DELIVERED");
 assert.equal(f.deposits(),2);
}));
test("missing one warehouse COMMITTED receipt blocks delivery",()=>run(f=>{
 f.start();assert.notEqual(f.arrive().status,"DELIVERED");
 assert.equal(f.newFlight().read(f.manifestKey).phase,"FUNDED");
},{missingReceipt:true}));
test("terminal write failure blocks success and preserves active route",()=>run(f=>{
 f.start();assert.match(f.arrive().status,/ESCORT_SIMULATED_TERMINAL_WRITE_FAILURE/);
 assert.ok(f.fleet.coopStationArrival);
},{failTerminal:true}));
test("lost native hauler never receives a terminal delivery event",()=>run(f=>{
 f.start();f.ship.nativeNpc=false;
 assert.equal(f.tick(1003000).status,"HAULER_LOST_OR_NOT_DURABLE");
 assert.equal(f.newFlight().read(f.manifestKey).phase,"FUNDED");
}));
test("restart before delivery never upgrades FUNDED to DELIVERED",()=>run(f=>{
 f.start();
 assert.notEqual(f.newFlight().readNativeDelivery(f.contract()).status,"DELIVERED");
}));
test("corrupt delivery journal is not interpreted as a valid terminal witness",()=>run(f=>{
 f.start();f.arrive();
 fs.appendFileSync(path.join(f.root,"escort-flight-gate",f.manifestKey+".jsonl"),"{broken");
 assert.equal(f.newFlight().read(f.manifestKey).status,"FLIGHT_JOURNAL_CORRUPT");
}));
test("post-raid bind uses prefunded escrow and pays both only once",()=>run(f=>{
 f.start();f.arrive();
 const c=f.contract(),settlement=f.laterSettlement();
 assert.equal(settlement.create(c).status,"OFFERED");
 assert.equal(settlement.attachPrefunded(c.contractID).status,"FUNDED");
 assert.equal(f.reserves(),1);
 assert.equal(settlement.proof(c).status,"NATIVE_ESCORT_EVIDENCE_VERIFIED");
 assert.equal(settlement.settle(c.contractID).status,"SETTLED");
 assert.equal(f.payments(),1);
 assert.equal(settlement.settle(c.contractID).status,"CONTRACT_SETTLEMENT_NOT_REPLAYABLE");
}));
test("prefunded but undelivered contract cannot pay",()=>run(f=>{
 f.start();const c=f.contract(),settlement=f.laterSettlement();
 assert.equal(settlement.create(c).status,"OFFERED");
 assert.equal(settlement.attachPrefunded(c.contractID).status,"FUNDED");
 assert.notEqual(settlement.settle(c.contractID).status,"SETTLED");
 assert.equal(f.payments(),0);
}));
test("losing native escrow before arrival blocks delivery",()=>run(f=>{
 f.start();f.loseEscrow();
 assert.match(f.arrive().status,/ESCORT_FLIGHT_ESCROW_NO_LONGER_RESERVED/);
}));
test("old route remains unchanged when escort gate flag is OFF",()=>{
 const previous=process.env.EVEJS_COOP_ESCORT_ROUTE_GATE;
 process.env.EVEJS_COOP_ESCORT_ROUTE_GATE="0";
 try{run(f=>{assert.equal(f.start().status,"EN_ROUTE");
  assert.equal(f.reserves(),0);assert.equal(f.warps(),1);
  assert.equal(f.arrive().status,"DELIVERED");})}
 finally{process.env.EVEJS_COOP_ESCORT_ROUTE_GATE=previous}
});
process.on("exit",()=>{for(const [k,v] of Object.entries(old)){
 if(v===undefined)delete process.env[k];else process.env[k]=v;
}});
