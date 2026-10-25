import test from "node:test";
import assert from "node:assert/strict";
import {createRequire} from "node:module";
const require=createRequire(import.meta.url);
const {createStationArrival}=require("../integration/coopNativeStationArrival.cjs");
const FLAGS=["EVEJS_COOP_NATIVE_HAUL_MANIFEST","EVEJS_COOP_ESCORT_ROUTE_GATE",
 "EVEJS_COOP_ESCORT_WARP_FENCE","EVEJS_COOP_ESCORT_PEACEFUL_PAYOUT",
 "EVEJS_COOP_ESCORT_ROUTE_WITNESS","EVEJS_COOP_ESCORT_DEPARTURE_WITNESS",
 "EVEJS_COOP_ESCORT_NATIVE_WARP_OBSERVER",
 "EVEJS_COOP_ESCORT_NATIVE_WARP_RECOVERY"];
const saved=Object.fromEntries(FLAGS.map(k=>[k,process.env[k]]));
for(const key of FLAGS)process.env[key]="1";
const KEY="30000144-77-1000000",CONTRACT="escort-30000144-77-5501";
function fixture(){
 const station={stationID:60001,corporationID:10001,solarSystemID:30000144};
 const physicalStation={itemID:60001,kind:"station",position:{x:100000,y:0,z:0},radius:200};
 const ingress={startTimeMs:1000000,travelCompleteAtMs:1007000,
  lastUpdateAtMs:1001500,completeAtMs:1007250,
  origin:{x:0,y:0,z:0},targetPoint:{x:100750,y:0,z:0}};
 const npc={itemID:901,kind:"ship",nativeNpc:true,transient:false,
  mode:"WARP",position:{x:30000,y:0,z:0},sessionlessWarpIngress:ingress};
 const scene={systemID:30000144,sessions:new Map(),
  staticEntities:[physicalStation],getEntityByID:id=>id===901?npc:null};
 const booking={manifestKey:KEY,contractID:CONTRACT,
  systemID:30000144,fleetID:77,haulerID:901,stationID:60001,
  corporationID:10001,playerFleetID:33,amountISK:20000,
  characters:[701,702]};
 const entry={manifestKey:KEY,contractID:CONTRACT,systemID:30000144,
  fleetID:77,haulerID:901,stationID:60001,
  corporationID:10001,cargoIDs:[5501]};
 const cargo=[{cargoID:5501,entityID:901,coopHaulFleetID:77,
  coopHaulFromMinerID:503,moduleID:0,quantity:7,typeID:34,transient:false}];
 const state={station,physicalStation,ingress,npc,scene,booking,entry,cargo,
  native:{entityID:901,systemID:30000144,transient:false},
  source:{status:"WARP_SOURCE_ALREADY_DISPATCHED",manifestKey:KEY,
   phase:"WARP_ACK_CONFIRMED"},
  fence:{status:"READY",phase:"WARP_ACK_CONFIRMED",booking:entry},
  flight:{status:"READY",phase:"FUNDED",booking},
  departure:{status:"VERIFIED_NATIVE_ESCORT_DEPARTURE",
   manifestKey:KEY,contractID:CONTRACT,origin:{x:0,y:0,z:0},
   characters:[701,702],shipIDs:[1701,1702]},
  sampleResult:"ROUTE_NOT_AT_CHECKPOINT",
  counters:{sample:0,warp:0,fund:0,inspect:0,source:0,departure:0,read:0}};
 const gate={
  inspectSource:()=>{state.counters.source++;return state.source},
  inspect:()=>{state.counters.inspect++;return state.fence},
  prepare:()=>{throw Error("REPLAY MUST NEVER PREPARE NEW WARP")},
  confirm:()=>{throw Error("REPLAY MUST NEVER CONFIRM NEW WARP")}
 };
 const escort={
  readFlight:()=>{state.counters.read++;return state.flight},
  readDurableEscortDeparture:()=>{state.counters.departure++;return state.departure},
  recordEscortRouteSample:()=>{state.counters.sample++;
   return {status:state.sampleResult}},
  fundBeforeWarp:()=>{state.counters.fund++;throw Error("REPLAY MUST NEVER FUND")},
  recordDelivered:()=>({status:"NOT_ALLOWED"})
 };
 const director=createStationArrival({
  getStations:()=>[station],getStation:()=>station,getCorporation:()=>({corporationID:10001}),
  isNpcCorporation:()=>true,getNativeEntity:()=>state.native,getScene:()=>scene,
  store:{listNativeCargoForEntity:()=>state.cargo},items:{},warehouse:{deposit:()=>({status:"DISABLED"})},
  manifest:{prepare:()=>{throw Error("REPLAY MUST NEVER CREATE MANIFEST")}},
  flush:()=>{throw Error("REPLAY MUST NEVER FLUSH")},
  warpToPoint:()=>{state.counters.warp++;throw Error("REPLAY MUST NEVER WARP")},
  root:"/tmp/native-recovery-guard",clock:()=>1002000,
  warpFence:gate,escortGate:escort,probe:{observe:()=>{}}
 });
 return {...state,director,escort};
}
function recover(f,now=1002000){return f.director.noteNativeMotion(f.npc,now).status}
test("genuine current native NPC warp reattaches observer using confirmed durable originals",()=>{
 const f=fixture();
 assert.equal(recover(f),"ROUTE_NOT_AT_CHECKPOINT");
 assert.equal(f.counters.sample,1);
 assert.equal(f.counters.inspect,1);
 assert.equal(f.counters.read,1);
 assert.equal(f.counters.departure,1);
 assert.equal(f.counters.warp,0);assert.equal(f.counters.fund,0);
});
test("second real position tick uses reattached same ingress, never funds again",()=>{
 const f=fixture();recover(f);
 f.npc.position.x=70000;
 assert.equal(recover(f,1003100),"ROUTE_NOT_AT_CHECKPOINT");
 assert.equal(f.counters.source,1);
 assert.equal(f.counters.sample,2);
 assert.equal(f.counters.fund,0);assert.equal(f.counters.warp,0);
});
test("recovery flag default OFF does not inspect any durable finance row",()=>{
 const f=fixture();process.env.EVEJS_COOP_ESCORT_NATIVE_WARP_RECOVERY="0";
 try{assert.equal(recover(f),"ESCORT_NATIVE_MOTION_NOT_REGISTERED");
  assert.equal(f.counters.source,0);assert.equal(f.counters.read,0)}
 finally{process.env.EVEJS_COOP_ESCORT_NATIVE_WARP_RECOVERY="1"}
});
test("unsynced or only prepared native warp is NOT a confirmed departure",()=>{
 const f=fixture();f.source.phase="WARP_PREPARED";
 assert.equal(recover(f),"ESCORT_NATIVE_RECOVERY_WARP_NOT_CONFIRMED");
 assert.equal(f.counters.sample,0);assert.equal(f.counters.fund,0);
});
test("original warp fence identity cannot be replaced with another contract",()=>{
 const f=fixture();f.fence.booking={...f.entry,contractID:"escort-other"};
 assert.equal(recover(f),"ESCORT_NATIVE_RECOVERY_PROVENANCE_MISMATCH");
 assert.equal(f.counters.sample,0);
});
test("original native flight must be FUNDED, never DELIVERED or PREPARED",()=>{
 for(const phase of ["DELIVERED","FUNDING_PREPARED"]){
  const f=fixture();f.flight.phase=phase;
  assert.equal(recover(f),"ESCORT_NATIVE_RECOVERY_PROVENANCE_MISMATCH");
  assert.equal(f.counters.sample,0);
 }
});
test("changed source participants invalidate original departure provenance",()=>{
 const f=fixture();f.departure.characters=[701,703];
 assert.equal(recover(f),"ESCORT_NATIVE_RECOVERY_PROVENANCE_MISMATCH");
 assert.equal(f.counters.sample,0);
});
test("unavailable original departure fsync proof never enables sampling",()=>{
 const f=fixture();f.departure.status="DEPARTURE_REPLAY_FSYNC_UNCERTAIN_NEEDS_REPAIR";
 assert.equal(recover(f),"ESCORT_NATIVE_RECOVERY_PROVENANCE_MISMATCH");
 assert.equal(f.counters.sample,0);
});
test("unverified or substituted original cargo ID cannot select a different manifest",()=>{
 const f=fixture();f.fence.booking={...f.entry,cargoIDs:[8888]};
 assert.equal(recover(f),"ESCORT_NATIVE_RECOVERY_PROVENANCE_MISMATCH");
 assert.equal(f.counters.sample,0);
});
test("foreign cargo or mixed original mining fleets cannot fake a recovered job",()=>{
 const f=fixture();f.cargo.push({...f.cargo[0],cargoID:5502,coopHaulFleetID:88});
 assert.equal(recover(f),"ESCORT_NATIVE_RECOVERY_CARGO_FLEET_MISMATCH");
 assert.equal(f.counters.sample,0);
});
test("duplicate cargo IDs fail before any flight journal lookup",()=>{
 const f=fixture();f.cargo.push({...f.cargo[0]});
 assert.equal(recover(f),"ESCORT_NATIVE_RECOVERY_CARGO_DUPLICATE");
 assert.equal(f.counters.read,0);
});
test("reused or transient entity cannot reattach another NPC to old receipt",()=>{
 const f=fixture();f.native.transient=true;
 assert.equal(recover(f),"ESCORT_NATIVE_RECOVERY_HAULER_NOT_DURABLE");
 assert.equal(f.counters.sample,0);
});
test("scene entity reference must be EXACT original native NPC",()=>{
 const f=fixture();const duplicate={...f.npc};
 assert.equal(f.director.noteNativeMotion(duplicate,1002000).status,
  "ESCORT_NATIVE_RECOVERY_ENTITY_MISMATCH");
 assert.equal(f.counters.sample,0);
});
test("original source position and native ingress origin are indivisible",()=>{
 const f=fixture();f.ingress.origin.x=900;
 assert.equal(recover(f),"ESCORT_NATIVE_RECOVERY_PHYSICAL_WARP_MISMATCH");
 assert.equal(f.counters.sample,0);
});
test("real NPC warp target must be the same original native station",()=>{
 const f=fixture();f.ingress.targetPoint.x=99999;
 assert.equal(recover(f),"ESCORT_NATIVE_RECOVERY_PHYSICAL_WARP_MISMATCH");
 assert.equal(f.counters.sample,0);
});
test("recovered warp cannot silently switch ingresses later",()=>{
 const f=fixture();recover(f);
 f.npc.sessionlessWarpIngress={...f.ingress};
 assert.equal(recover(f,1003000),"ESCORT_NATIVE_RECOVERY_INGRESS_CHANGED");
 assert.equal(f.counters.sample,1);
});
test("recovered warp cannot silently change actual station or durable hauler",()=>{
 const f=fixture();recover(f);
 f.physicalStation.position.x+=10000;
 assert.equal(recover(f,1003000),"ESCORT_NATIVE_MOTION_STATION_CHANGED");
 assert.equal(f.counters.sample,1);
 const x=fixture();recover(x);x.native.transient=true;
 assert.equal(recover(x,1003000),"ESCORT_NATIVE_MOTION_ENTITY_NOT_CURRENT");
 assert.equal(x.counters.sample,1);
});
test("no observer after real ingress terminates or passes its original stop time",()=>{
 const f=fixture();
 assert.equal(recover(f,1008000),"ESCORT_NATIVE_RECOVERY_NOT_ACTIVE_INGRESS");
 assert.equal(f.counters.sample,0);
});
test("fake route evidence status cannot directly create escrow or warp",()=>{
 const f=fixture();f.sampleResult="VERIFIED_NATIVE_ESCORT_ROUTE_SERVICE";
 assert.equal(recover(f),"VERIFIED_NATIVE_ESCORT_ROUTE_SERVICE");
 assert.equal(f.counters.warp,0);
 assert.equal(f.counters.fund,0);
});
process.on("exit",()=>{for(const [k,v] of Object.entries(saved)){
 if(v===undefined)delete process.env[k];else process.env[k]=v;
}});
