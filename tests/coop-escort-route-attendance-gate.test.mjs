import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import vm from "node:vm";
import {createRequire} from "node:module";
const require=createRequire(import.meta.url);
const src=fs.readFileSync(new URL("../integration/coopEscortRuntime.cjs",import.meta.url),"utf8");
const FLAGS=["EVEJS_COOP_ESCORT_CONTRACTS","EVEJS_COOP_ESCORT_ROUTE_GATE",
 "EVEJS_COOP_NATIVE_ATOMIC_ROWS","EVEJS_COOP_NATIVE_ESCORT_WALLET",
 "EVEJS_COOP_ESCORT_PEACEFUL_PAYOUT","EVEJS_COOP_ESCORT_DEPARTURE_WITNESS",
 "EVEJS_COOP_ESCORT_ROUTE_WITNESS","EVEJS_COOP_ESCORT_NATIVE_WARP_RECOVERY"];
const old=Object.fromEntries(FLAGS.map(k=>[k,process.env[k]]));
for(const k of FLAGS)process.env[k]="1";
process.env.EVEJS_COOP_ESCORT_ROUTE_WITNESS="0";
process.env.EVEJS_COOP_ESCORT_NATIVE_WARP_RECOVERY="0";
const route={manifestKey:"30000144-77-123",systemID:30000144,
 fleetID:77,stationID:60000001,corporationID:1000152,haulerIDs:[901],
 cargoIDs:[123]};
const offer={status:"AUTHORIZED_NATIVE_ESCORT_BOOKING",manifestKey:route.manifestKey,
 contractID:"escort-30000144-77-123",systemID:route.systemID,fleetID:77,
 stationID:60000001,corporationID:1000152,haulerID:901,
 playerFleetID:44,characters:[701,702],amountISK:600000};
function fixture({authorized=true,validDuo=true}={}){
 const state={recorded:false,reserves:0,preflight:0,delivery:0,routeSamples:0,routeValid:false,flightPhase:"FUNDED",readStatus:null,reserved:true};
 let verifyService=()=>({status:"NOT_WIRED"});
 const requires={
  "./coopEscortNativeFunds":{createEscortNativeFunds:()=>({})},
  "./coopEscortFlightGate":{createEscortFlightGate:()=>({
   fundBeforeWarp:()=>{state.reserves++;return {status:"FUNDED_BEFORE_WARP"}},
   recordDelivered:()=>({status:"DURABLE_NATIVE_DELIVERY_RECORDED"}),
   read:()=>({status:"READY",phase:state.flightPhase,booking:offer}),
   readFunded:()=>({status:state.reserved?"NATIVE_PREFUNDED_BOOKING_VERIFIED":
    "FLIGHT_NATIVE_RESERVATION_NOT_VERIFIED"}),
   readNativeDelivery:()=>({status:"NOT_DELIVERED"}),
   readNativeDeliveryForAudit:()=>({status:"NOT_DELIVERED"}),
   listDelivered:()=>({status:"READY",manifestKeys:[]})})},
  "./coopEscortContractSettlement":{createEscortContractSettlement:()=>({
   read:()=>({status:"CONTRACT_NOT_FOUND"}),
   create:()=>({status:"OFFERED"}),
   attachPrefunded:()=>({status:"FUNDED"}),
   settle:()=>({status:"SETTLED"}),
   refund:()=>({status:"REFUNDED"})})},
  "./coopEscortPeacefulSettlement":{createPeacefulEscortSettlement:x=>{
   verifyService=x.verifyService;
   return {settle:()=>({status:"NO_PAYOUT_EXECUTED"})}}},
  "./coopEscortDepartureWitness":{createDepartureWitness:()=>({
   record:()=>{state.recorded=true;return {status:"DURABLE_NATIVE_ESCORT_DEPARTURE_WITNESS"}},
   read:()=>state.recorded?{status:"VERIFIED_NATIVE_ESCORT_DEPARTURE",
    manifestKey:route.manifestKey,contractID:offer.contractID,
    at:10000,characters:[701,702],shipIDs:[7001,7002],origin:{x:0,y:0,z:0}}:
    {status:"DEPARTURE_NOT_RECORDED"},
   readDurable:()=>state.readStatus?{status:state.readStatus}:
    state.recorded?{status:"VERIFIED_NATIVE_ESCORT_DEPARTURE",
     manifestKey:route.manifestKey,contractID:offer.contractID,
     at:10000,characters:[701,702],shipIDs:[7001,7002],origin:{x:0,y:0,z:0}}:
     {status:"DEPARTURE_NOT_RECORDED"}})},
  "./coopEscortRouteWitness":{createRouteWitness:()=>({
   sample:()=>{state.routeSamples++;return {status:"NATIVE_ROUTE_CHECKPOINT_DURABLY_RECORDED",stage:1}},
   verify:()=>({status:state.routeValid?"VERIFIED_NATIVE_ESCORT_ROUTE_SERVICE":
    "ROUTE_CHECKPOINT_NOT_FOUND"})})},
  "./coopEscortTerminalAttendance":{createEscortTerminalAttendance:()=>({
   record:()=>({status:"TERMINAL_ATTENDANCE_NOT_FOUND"}),
   readDurable:()=>({status:"TERMINAL_ATTENDANCE_NOT_FOUND"})})}
 };
 const mod={exports:{}};
 vm.runInNewContext(src,{require:name=>{
  if(!requires[name])throw Error("UNEXPECTED_IMPORT "+name);
  return requires[name]},module:mod,process});
 const runtime=mod.exports.createEscortRuntime({
  root:"/tmp/coop-test",clock:()=>100000,
  atomicRows:{transact:()=>({}),mode:"SERVER_INTERNAL_FLAGGED",isPoisoned:()=>false},
  isNpcCorporation:()=>true,readManifest:()=>({status:"READY"}),
  verifyManifest:()=>({status:"READY"}),
  authorizeBooking:()=>authorized?offer:{status:"DENIED"},
  verifyNativeDuo:()=>validDuo?
   {status:"VERIFIED_NATIVE_DUO_FLEET",fleetID:44,characters:[701,702]}:
   {status:"NOT_NATIVE_FLEET"},
  authorizeOffer:()=>({status:"AUTHORIZED_NATIVE_ESCORT"}),
  readIncidents:()=>({status:"READY",incidents:[]}),
  readOutcomes:()=>({status:"READY",outcomes:[]}),
  readNativeFailure:()=>({status:"UNKNOWN"})
 });
 const sessions=new Map([[1,{characterID:701,socket:{destroyed:false},
  _space:{initialStateSent:true,systemID:route.systemID,shipID:7001}}],
 [2,{characterID:702,socket:{destroyed:false},
  _space:{initialStateSent:true,systemID:route.systemID,shipID:7002}}]]);
 const ships=new Map([[901,{kind:"ship",nativeNpc:true,itemID:901,position:{x:0,y:0,z:0}}],
 [7001,{kind:"ship",nativeNpc:false,itemID:7001,position:{x:100,y:0,z:0}}],
 [7002,{kind:"ship",nativeNpc:false,itemID:7002,position:{x:200,y:0,z:0}}]]);
 const scene={systemID:route.systemID,sessions,getEntityByID:id=>ships.get(id)};
 return {state,runtime,scene,ships,verifyService:()=>verifyService(offer,scene)};
}
test("native funding cannot be invoked without real durable two-pilot departure",()=>{
 const f=fixture();
 assert.equal(f.runtime.fundBeforeWarp(route).status,"ESCORT_DEPARTURE_NOT_RECORDED");
 assert.equal(f.state.reserves,0);
});
test("recording authentic departure precedes original wallet reserve",()=>{
 const f=fixture();
 assert.equal(f.runtime.recordEscortDeparture(route,f.scene).status,
  "DURABLE_NATIVE_ESCORT_DEPARTURE_WITNESS");
 assert.equal(f.runtime.fundBeforeWarp(route).status,"FUNDED_BEFORE_WARP");
 assert.equal(f.state.reserves,1);
});
test("no signed quote means no source witness and no native escrow",()=>{
 const f=fixture({authorized:false});
 assert.equal(f.runtime.recordEscortDeparture(route,f.scene).status,
  "DEPARTURE_BOOKING_NOT_AUTHORIZED");
 assert.equal(f.runtime.fundBeforeWarp(route).status,
  "ESCORT_DEPARTURE_BOOKING_NOT_AUTHORIZED");
 assert.equal(f.state.reserves,0);
});
test("invalid two-player real fleet prevents any money even if original authorizes job",()=>{
 const f=fixture({validDuo:false});
 assert.equal(f.runtime.recordEscortDeparture(route,f.scene).status,
  "DEPARTURE_BOOKING_NOT_AUTHORIZED");
 assert.equal(f.runtime.fundBeforeWarp(route).status,
  "ESCORT_DEPARTURE_BOOKING_NOT_AUTHORIZED");
 assert.equal(f.state.reserves,0);
});
test("disabled witness flag blocks peaceful wallet funding even if original offer verified",()=>{
 const f=fixture();
 process.env.EVEJS_COOP_ESCORT_DEPARTURE_WITNESS="0";
 try{
  assert.equal(f.runtime.fundBeforeWarp(route).status,
   "ESCORT_DURABLE_DEPARTURE_WITNESS_REQUIRED");
  assert.equal(f.state.reserves,0);
 }finally{process.env.EVEJS_COOP_ESCORT_DEPARTURE_WITNESS="1"}
});
test("when peaceful payout OFF, original pirate-raid branch does not require witness",()=>{
 const f=fixture();
 process.env.EVEJS_COOP_ESCORT_PEACEFUL_PAYOUT="0";
 try{
  assert.equal(f.runtime.fundBeforeWarp(route).status,"FUNDED_BEFORE_WARP");
  assert.equal(f.state.reserves,1);
 }finally{process.env.EVEJS_COOP_ESCORT_PEACEFUL_PAYOUT="1"}
});
test("station camping alone cannot prove service to peaceful payout",()=>{
 const f=fixture();
 assert.equal(f.verifyService().status,"NO_NATIVE_ESCORT_SERVICE");
 assert.equal(f.state.reserves,0);
});
test("at authentic destination, original predeparture receipt + two native ships proves service",()=>{
 const f=fixture();f.runtime.recordEscortDeparture(route,f.scene);
 assert.equal(f.verifyService().status,"VERIFIED_NATIVE_ESCORT_SERVICE");
 assert.deepEqual(f.verifyService().characters,[701,702]);
});
test("real departure alone is insufficient if a player abandons final convoy",()=>{
 const f=fixture();f.runtime.recordEscortDeparture(route,f.scene);
 f.ships.get(7002).position={x:400000,y:0,z:0};
 assert.equal(f.verifyService().status,"NO_NATIVE_ESCORT_SERVICE");
});
test("strict Stage I flag makes midroute evidence mandatory for peaceful payout",()=>{
 const f=fixture();f.runtime.recordEscortDeparture(route,f.scene);
 process.env.EVEJS_COOP_ESCORT_ROUTE_WITNESS="1";
 try{assert.equal(f.verifyService().status,"NO_NATIVE_ESCORT_SERVICE");
 assert.equal(f.state.routeSamples,0)}
 finally{process.env.EVEJS_COOP_ESCORT_ROUTE_WITNESS="0"}
});
test("two real native midroute checkpoints can enable the terminal peaceful service gate",()=>{
 const f=fixture();f.runtime.recordEscortDeparture(route,f.scene);
 process.env.EVEJS_COOP_ESCORT_ROUTE_WITNESS="1";
 try{assert.equal(f.runtime.recordEscortRouteSample(route.manifestKey,f.scene,
  {stationID:route.stationID,corporationID:route.corporationID}).status,
   "NATIVE_ROUTE_CHECKPOINT_DURABLY_RECORDED");
 assert.equal(f.state.routeSamples,1);
 f.state.routeValid=true;
 assert.equal(f.verifyService().status,"VERIFIED_NATIVE_ESCORT_SERVICE")}
 finally{process.env.EVEJS_COOP_ESCORT_ROUTE_WITNESS="0"}
});
test("direct route sampling with Stage I disabled cannot write fake participation",()=>{
 const f=fixture();
 assert.equal(f.runtime.recordEscortRouteSample(route.manifestKey,f.scene,
  {stationID:route.stationID}).status,"DISABLED");
 assert.equal(f.state.routeSamples,0);
});
test("read-only restart authority rejects absent source evidence without changing wallet",()=>{
 const f=fixture();
 process.env.EVEJS_COOP_ESCORT_NATIVE_WARP_RECOVERY="1";
 process.env.EVEJS_COOP_ESCORT_ROUTE_WITNESS="1";
 try{
  assert.equal(f.runtime.readDurableEscortDeparture(route.manifestKey).status,
   "ESCORT_RECOVERY_DEPARTURE_NOT_RECORDED");
  assert.equal(f.state.reserves,0);
 }finally{
  process.env.EVEJS_COOP_ESCORT_NATIVE_WARP_RECOVERY="0";
  process.env.EVEJS_COOP_ESCORT_ROUTE_WITNESS="0";
 }
});
test("original proven source can be reread for recovery without a second corporate debit",()=>{
 const f=fixture();f.runtime.recordEscortDeparture(route,f.scene);
 process.env.EVEJS_COOP_ESCORT_NATIVE_WARP_RECOVERY="1";
 process.env.EVEJS_COOP_ESCORT_ROUTE_WITNESS="1";
 try{
  assert.equal(f.runtime.readDurableEscortDeparture(route.manifestKey).status,
   "VERIFIED_NATIVE_ESCORT_DEPARTURE");
  assert.equal(f.state.reserves,0);
  f.state.readStatus="DEPARTURE_REPLAY_FSYNC_UNCERTAIN_NEEDS_REPAIR";
  assert.equal(f.runtime.readDurableEscortDeparture(route.manifestKey).status,
   "ESCORT_RECOVERY_DEPARTURE_REPLAY_FSYNC_UNCERTAIN_NEEDS_REPAIR");
  assert.equal(f.state.reserves,0);
 }finally{
  process.env.EVEJS_COOP_ESCORT_NATIVE_WARP_RECOVERY="0";
  process.env.EVEJS_COOP_ESCORT_ROUTE_WITNESS="0";
 }
});
test("delivered or expired financial flight cannot be resumed for transit samples",()=>{
 const f=fixture();f.runtime.recordEscortDeparture(route,f.scene);
 process.env.EVEJS_COOP_ESCORT_NATIVE_WARP_RECOVERY="1";
 process.env.EVEJS_COOP_ESCORT_ROUTE_WITNESS="1";
 try{
  f.state.flightPhase="DELIVERED";
  assert.equal(f.runtime.readDurableEscortDeparture(route.manifestKey).status,
   "ESCORT_RECOVERY_ACTIVE_FUNDED_FLIGHT_NOT_VERIFIED");
  assert.equal(f.state.reserves,0);
 }finally{
  process.env.EVEJS_COOP_ESCORT_NATIVE_WARP_RECOVERY="0";
  process.env.EVEJS_COOP_ESCORT_ROUTE_WITNESS="0";
 }
});
test("refunded or spent native wallet never qualifies for midroute proof even if file says FUNDED",()=>{
 const f=fixture();f.runtime.recordEscortDeparture(route,f.scene);
 f.state.reserved=false;
 process.env.EVEJS_COOP_ESCORT_ROUTE_WITNESS="1";
 try{
  assert.equal(f.runtime.recordEscortRouteSample(route.manifestKey,f.scene,
   {stationID:route.stationID}).status,"ROUTE_NATIVE_RESERVATION_NOT_VERIFIED");
  assert.equal(f.state.routeSamples,0);
  assert.equal(f.state.reserves,0);
 }finally{process.env.EVEJS_COOP_ESCORT_ROUTE_WITNESS="0"}
});
test("recovery requires independently RESERVED real wallet and never recreates it",()=>{
 const f=fixture();f.runtime.recordEscortDeparture(route,f.scene);
 f.state.reserved=false;
 process.env.EVEJS_COOP_ESCORT_NATIVE_WARP_RECOVERY="1";
 process.env.EVEJS_COOP_ESCORT_ROUTE_WITNESS="1";
 try{
  assert.equal(f.runtime.readDurableEscortDeparture(route.manifestKey).status,
   "ESCORT_RECOVERY_NATIVE_RESERVATION_NOT_VERIFIED");
  assert.equal(f.state.reserves,0);
 }finally{
  process.env.EVEJS_COOP_ESCORT_NATIVE_WARP_RECOVERY="0";
  process.env.EVEJS_COOP_ESCORT_ROUTE_WITNESS="0";
 }
});
process.on("exit",()=>{for(const [k,v] of Object.entries(old))
 if(v===undefined)delete process.env[k];else process.env[k]=v});
