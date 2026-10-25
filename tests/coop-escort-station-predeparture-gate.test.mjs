import test from "node:test";
import assert from "node:assert/strict";
import {createRequire} from "node:module";
const require=createRequire(import.meta.url);
const {createStationArrival}=require("../integration/coopNativeStationArrival.cjs");
const prior=Object.fromEntries([
 "EVEJS_COOP_NATIVE_HAUL_MANIFEST","EVEJS_COOP_ESCORT_ROUTE_GATE",
 "EVEJS_COOP_OPPORTUNITY_BOARD","EVEJS_COOP_EVENT_VOLUNTEERS",
 "EVEJS_COOP_ESCORT_PAID_ACCEPT","EVEJS_COOP_ESCORT_REFUNDS","EVEJS_COOP_ESCORT_WARP_FENCE"
].map(k=>[k,process.env[k]]));
for(const k of Object.keys(prior))process.env[k]="1";
const previousPeace=process.env.EVEJS_COOP_ESCORT_PEACEFUL_PAYOUT;
const previousWitness=process.env.EVEJS_COOP_ESCORT_DEPARTURE_WITNESS;
process.env.EVEJS_COOP_ESCORT_PEACEFUL_PAYOUT="0";
process.env.EVEJS_COOP_ESCORT_DEPARTURE_WITNESS="0";
function fixture({volunteer=false,warpOK=true,gate=true,noticeClosureUnknown=false,
 sourceDispatched=false,ackDurable=true,witnessValid=true}={}){
 const counters={funding:0,warp:0,manifest:0,closures:0,witness:0};
 const target={stationID:60001,corporationID:10001,solarSystemID:30000144};
 const ship={itemID:901,kind:"ship",nativeNpc:true,transient:false,
  position:{x:0,y:0,z:0},radius:100,mode:"STOP"};
 let shipAlive=true,lossProven=false;
 const scene={systemID:30000144,
  staticEntities:[{itemID:60001,kind:"station",position:{x:100000,y:0,z:0},radius:200}],
  getEntityByID:id=>id===901&&shipAlive?ship:null};
 const fleet={fleetID:77,systemID:30000144,haulerEntityIDs:[901]};
 const cargo=[{cargoID:5501,entityID:901,coopHaulFleetID:77,
  coopHaulFromMinerID:503,typeID:34,quantity:7,transient:false}];
 let pairApproved=volunteer,paidApproved=volunteer,warpAccepted=warpOK;
 const board=require("../integration/coopWorldOpportunityBoard.cjs");
 const duo=require("../integration/coopEscortVolunteers.cjs");
 const oldPrepare=board.noteNativeConvoyPreparing;
 const oldDeparted=board.noteNativePreparingDeparted;
 const oldReceipt=duo.readVerifiedNativePair;
 const priced=require("../integration/coopEscortPricedOffers.cjs");
 const oldQuote=priced.offerFromNative,oldAccepted=priced.readNativeAccepted;
 priced.offerFromNative=()=>({status:"NATIVE_QUOTE_READY"});
 priced.readNativeAccepted=()=>paidApproved?{
  status:"DURABLE_TWO_PILOT_PAID_ACCEPTANCE",
  eventID:"convoy-30000144-77-5501",fleetID:33,
  quote:{systemID:30000144,fleetID:77,stationID:60001,
   corporationID:10001,haulerID:901},
  characters:[701,702],amountISK:20000
 }:{status:"NOT_FOUND"};

 board.noteNativeConvoyPreparing=()=>({status:"NATIVE_PREPARING_EVENT_READY",
  id:"convoy-30000144-77-5501"});
 board.noteNativePreparingDeparted=()=>{
  counters.closures++;
  return {status:noticeClosureUnknown&&counters.closures===1?
   "PREPARING_DEPARTURE_WRITE_UNCERTAIN":"NATIVE_PREPARING_EVENT_CLOSED"};
 };
 duo.readVerifiedNativePair=()=>pairApproved?{
  status:"VERIFIED_NATIVE_DUO_VOLUNTEER",eventID:"convoy-30000144-77-5501",
  systemID:30000144,entityID:901,fleetID:33,pilots:[{characterID:701,shipID:1701},
   {characterID:702,shipID:1702}]}:{status:"NOT_FOUND"};
 const director=createStationArrival({getStations:()=>[target],
  getStation:()=>target,getCorporation:()=>({corporationID:10001}),
  isNpcCorporation:()=>true,
  getNativeEntity:()=>({entityID:901,systemID:30000144,transient:false}),
  getScene:()=>scene,store:{listNativeCargoForEntity:()=>cargo},items:{},
  flush:()=>({success:true}),
  warpToPoint:()=>{counters.warp++;return {success:warpAccepted}},
  root:"/tmp/eve",clock:()=>1000000,
  warpFence:{
   inspectSource:()=>({status:sourceDispatched?"WARP_SOURCE_ALREADY_DISPATCHED":"WARP_SOURCE_CLEAR"}),
   prepare:()=>({status:"DURABLE_WARP_PREPARED"}),
   confirm:()=>({status:ackDurable?"DURABLE_WARP_ACK_CONFIRMED":
    "WARP_ACK_JOURNAL_UNCERTAIN_REPAIR_REQUIRED"})
  },
  warehouse:{deposit:()=>({status:"COMMITTED"})},
  manifest:{prepare:()=>{counters.manifest++;return {status:"MANIFEST_DURABLY_PREPARED",
   key:"30000144-77-1000000",cargoIDs:[5501]}}},
  escortGate:gate?{
   recordEscortDeparture:()=>{counters.witness++;return {status:witnessValid?
    "DURABLE_NATIVE_ESCORT_DEPARTURE_WITNESS":
    "DEPARTURE_PLAYER_NOT_ON_CONVOY_GRID"}},
   fundBeforeWarp:()=>{counters.funding++;return {status:"FUNDED_BEFORE_WARP",
    manifestKey:"30000144-77-1000000",contractID:"escort-test-01"}},
   recordDelivered:()=>({status:"DURABLE_NATIVE_DELIVERY_RECORDED"}),
   refundNativeWreck:()=>lossProven?{status:"REFUNDED",contractID:"escort-test-01",amountISK:20000}:
    {status:"NATIVE_REFUND_HAULER_LOSS_NOT_PROVEN"}}:null,
  probe:{observe:()=>{}}});
 const close=()=>{
  board.noteNativeConvoyPreparing=oldPrepare;
  board.noteNativePreparingDeparted=oldDeparted;
  duo.readVerifiedNativePair=oldReceipt;
  priced.offerFromNative=oldQuote;
  priced.readNativeAccepted=oldAccepted;
 };
 return {director,scene,fleet,counters,volunteer:()=>pairApproved=true,
  approve:()=>{pairApproved=true;paidApproved=true},
  blockWarp:()=>warpAccepted=false,destroyHauler:()=>shipAlive=false,
  proveLoss:()=>lossProven=true,close};
}
function run(fn,opts){const f=fixture(opts);try{fn(f)}finally{f.close()}}
test("real hauler stays before warp until two volunteers provide durable consent",()=>run(f=>{
 assert.equal(f.director.start(f.scene,f.fleet,1000000).status,
  "ESCORT_AWAITING_TWO_NATIVE_VOLUNTEERS");
 assert.equal(f.counters.funding,0);
 assert.equal(f.counters.manifest,0);
 assert.equal(f.counters.warp,0);
 assert.equal(f.fleet.coopEscortPredepartureEventID,"convoy-30000144-77-5501");
}));
test("volunteer is NOT priced contract acceptance or an ISK spending instruction",()=>run(f=>{
 f.volunteer();
 assert.equal(f.director.start(f.scene,f.fleet,1000000).status,
  "ESCORT_AWAITING_TWO_PAID_ACCEPTANCES");
 assert.equal(f.counters.funding,0);
 assert.equal(f.counters.manifest,0);
 assert.equal(f.counters.warp,0);
}));
test("only after explicit duo approval can native escrow and physical warp proceed",()=>run(f=>{
 f.director.start(f.scene,f.fleet,1000000);
 f.approve();
 assert.equal(f.director.start(f.scene,f.fleet,1000000).status,"EN_ROUTE");
 assert.equal(f.counters.funding,1);
 assert.equal(f.counters.warp,1);
 assert.equal(f.fleet.coopEscortPredepartureEventID,undefined);
}));
test("missing notice fsync ACK retries informational closure, not ISK or warp",()=>run(f=>{
 f.approve();
 const started=f.director.start(f.scene,f.fleet,1000000);
 assert.equal(started.status,"EN_ROUTE");
 assert.equal(started.predepartureNoticeStatus,"PREPARING_DEPARTURE_WRITE_UNCERTAIN");
 assert.equal(f.fleet.coopEscortPredepartureEventID,"convoy-30000144-77-5501");
 assert.equal(f.director.tick(f.scene,f.fleet,1001000).status,
  "AWAITING_PHYSICAL_ARRIVAL");
 assert.equal(f.fleet.coopEscortPredepartureEventID,undefined);
 assert.equal(f.counters.closures,2);
 assert.equal(f.counters.funding,1);
 assert.equal(f.counters.warp,1);
},{noticeClosureUnknown:true}));
test("unconfirmed native warp ACK fences funding retries and operator repair",()=>run(f=>{
 f.approve();f.blockWarp();
 assert.equal(f.director.start(f.scene,f.fleet,1000000).status,"WARP_COMMAND_FAILED");
 assert.equal(f.fleet.coopEscortWarpOutcomeUncertain,true);
 assert.equal(f.director.start(f.scene,f.fleet,1001000).status,
  "ESCORT_WARP_OUTCOME_NEEDS_OPERATOR_REPAIR");
 assert.equal(f.counters.funding,1);
 assert.equal(f.counters.warp,1);
}));
test("mere disappearance of a native NPC hauler is NOT enough to refund ISK",()=>run(f=>{
 f.approve();assert.equal(f.director.start(f.scene,f.fleet,1000000).status,"EN_ROUTE");
 f.destroyHauler();
 assert.equal(f.director.tick(f.scene,f.fleet,1001000).status,"HAULER_LOST_OR_NOT_DURABLE");
 assert.ok(f.fleet.coopStationArrival);
 assert.equal(f.counters.funding,1);
}));
test("genuine durable hauler-loss refund terminates route with ZERO player ISK earned",()=>run(f=>{
 f.approve();assert.equal(f.director.start(f.scene,f.fleet,1000000).status,"EN_ROUTE");
 f.destroyHauler();f.proveLoss();
 const result=f.director.tick(f.scene,f.fleet,1001000);
 assert.equal(result.status,"ESCORT_NATIVE_HAULER_LOSS_REFUNDED");
 assert.equal(result.terminal,true);
 assert.equal(result.amountISK,20000);
 assert.equal(result.earnedPlayerISK,0);
 assert.equal(f.fleet.coopStationArrival,undefined);
 assert.equal(f.counters.funding,1);assert.equal(f.counters.warp,1);
}));
test("a prior persisted physical warp fence forbids a second paid flight",()=>run(f=>{
 f.approve();
 assert.equal(f.director.start(f.scene,f.fleet,1000000).status,
  "ESCORT_WARP_SOURCE_ALREADY_DISPATCHED");
 assert.equal(f.counters.funding,0);
 assert.equal(f.counters.warp,0);
},{sourceDispatched:true}));
test("unknown durable ACK does not declare successful paid NPC departure",()=>run(f=>{
 f.approve();
 assert.equal(f.director.start(f.scene,f.fleet,1000000).status,
  "ESCORT_WARP_ACK_JOURNAL_UNCERTAIN_REPAIR_REQUIRED");
 assert.equal(f.fleet.coopEscortWarpOutcomeUncertain,true);
 assert.equal(f.director.tick(f.scene,f.fleet,1001000).status,
  "ESCORT_WARP_OUTCOME_NEEDS_OPERATOR_REPAIR");
 assert.equal(f.counters.funding,1);
 assert.equal(f.counters.warp,1);
},{ackDurable:false}));
test("paid peaceful escort requires native departure witness flag before any ISK debit",()=>{
 process.env.EVEJS_COOP_ESCORT_PEACEFUL_PAYOUT="1";
 process.env.EVEJS_COOP_ESCORT_DEPARTURE_WITNESS="0";
 try{run(f=>{
  f.approve();
  assert.equal(f.director.start(f.scene,f.fleet,1000000).status,
   "ESCORT_DURABLE_DEPARTURE_WITNESS_REQUIRED");
  assert.equal(f.counters.funding,0);assert.equal(f.counters.warp,0);
 })}finally{process.env.EVEJS_COOP_ESCORT_PEACEFUL_PAYOUT="0"}
});
test("source pilot camping elsewhere blocks peaceful escort BEFORE corporate reservation",()=>{
 process.env.EVEJS_COOP_ESCORT_PEACEFUL_PAYOUT="1";
 process.env.EVEJS_COOP_ESCORT_DEPARTURE_WITNESS="1";
 try{run(f=>{
  f.approve();
  assert.equal(f.director.start(f.scene,f.fleet,1000000).status,
   "ESCORT_DEPARTURE_PLAYER_NOT_ON_CONVOY_GRID");
  assert.equal(f.counters.witness,1);
  assert.equal(f.counters.funding,0);
  assert.equal(f.counters.warp,0);
 },{witnessValid:false})}finally{
  process.env.EVEJS_COOP_ESCORT_PEACEFUL_PAYOUT="0";
  process.env.EVEJS_COOP_ESCORT_DEPARTURE_WITNESS="0";
 }
});
test("valid native departure witness is required before paid peaceful warp",()=>{
 process.env.EVEJS_COOP_ESCORT_PEACEFUL_PAYOUT="1";
 process.env.EVEJS_COOP_ESCORT_DEPARTURE_WITNESS="1";
 try{run(f=>{
  f.approve();
  assert.equal(f.director.start(f.scene,f.fleet,1000000).status,"EN_ROUTE");
  assert.equal(f.counters.witness,1);
  assert.equal(f.counters.funding,1);
  assert.equal(f.counters.warp,1);
 })}finally{
  process.env.EVEJS_COOP_ESCORT_PEACEFUL_PAYOUT="0";
  process.env.EVEJS_COOP_ESCORT_DEPARTURE_WITNESS="0";
 }
});
test("paid escort cannot start unless durable warp fence is explicitly enabled",()=>{
 process.env.EVEJS_COOP_ESCORT_WARP_FENCE="0";
 try{run(f=>{
  assert.equal(f.director.start(f.scene,f.fleet,1000000).status,
   "ESCORT_DURABLE_WARP_FENCE_REQUIRED");
  assert.equal(f.counters.funding,0);assert.equal(f.counters.warp,0)
 },{volunteer:true})}
 finally{process.env.EVEJS_COOP_ESCORT_WARP_FENCE="1"}
});
test("no native wallet gate blocks route independent of voluntary consent",()=>run(f=>{
 assert.equal(f.director.start(f.scene,f.fleet,1000000).status,
  "ESCORT_ROUTE_GATE_UNAVAILABLE");
 assert.equal(f.counters.warp,0);
},{volunteer:true,gate:false}));
test("missing event board cannot bypass PAID EVE player acceptance",()=>{
 process.env.EVEJS_COOP_OPPORTUNITY_BOARD="0";
 try{run(f=>{assert.equal(f.director.start(f.scene,f.fleet,1000000).status,
   "ESCORT_DISCOVERY_AND_PAID_CONSENT_REQUIRED");
  assert.equal(f.counters.funding,0);assert.equal(f.counters.warp,0)},
  {volunteer:false})}
 finally{process.env.EVEJS_COOP_OPPORTUNITY_BOARD="1"}
});
process.on("exit",()=>{for(const [k,v] of Object.entries(prior))
 if(v===undefined)delete process.env[k];else process.env[k]=v;
 if(previousPeace===undefined)delete process.env.EVEJS_COOP_ESCORT_PEACEFUL_PAYOUT;
 else process.env.EVEJS_COOP_ESCORT_PEACEFUL_PAYOUT=previousPeace;
 if(previousWitness===undefined)delete process.env.EVEJS_COOP_ESCORT_DEPARTURE_WITNESS;
 else process.env.EVEJS_COOP_ESCORT_DEPARTURE_WITNESS=previousWitness;
});
