import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import vm from "node:vm";
import {createRequire} from "node:module";
const require=createRequire(import.meta.url);
const source=fs.readFileSync(new URL("../integration/coopEscortRuntime.cjs",import.meta.url),"utf8");
const {createPeacefulEscortSettlement}=require("../integration/coopEscortPeacefulSettlement.cjs");
const FLAGS=["EVEJS_COOP_ESCORT_CONTRACTS","EVEJS_COOP_ESCORT_ROUTE_GATE",
 "EVEJS_COOP_NATIVE_ATOMIC_ROWS","EVEJS_COOP_NATIVE_ESCORT_WALLET",
 "EVEJS_COOP_ESCORT_PEACEFUL_PAYOUT","EVEJS_COOP_ESCORT_DEPARTURE_WITNESS",
 "EVEJS_COOP_ESCORT_ROUTE_WITNESS","EVEJS_COOP_ESCORT_PEACEFUL_REPLAY"];
const prev=Object.fromEntries(FLAGS.map(k=>[k,process.env[k]]));
for(const k of FLAGS)process.env[k]="1";
const key="30000144-77-123",contractID="escort-30000144-77-123";
const booking=()=>({manifestKey:key,contractID,systemID:30000144,
 fleetID:77,haulerID:901,stationID:6001001,corporationID:1000001,
 playerFleetID:44,amountISK:600000,characters:[701,702]});
const stock=()=>({status:"FULL_NATIVE_CARGO_DELIVERY_VERIFIED",key,
 stationID:6001001,haulerIDs:[901],cargoIDs:[5501,5502],stacks:2,quantity:50});
function fixture({terminal=true,route=true,departure=true,reserved=true,
  walletPaid=false,unknownAck=false,delivery=true,listKeys=[key]}={}){
 const b=booking(),full=stock();
 const f={status:"READY",phase:delivery?"DELIVERED":"FUNDED",booking:b,
  delivery:delivery?{status:"DELIVERED",terminal:true,
   nativeFullManifestProof:full}:undefined};
 let money=walletPaid?"PAID":reserved?"RESERVED":"REFUNDED";
 let debit=0,terminalWrites=0,samples=0,scan=0;
 const funds={
  capabilities:()=>({nativeDurable:true,atomicDualCredit:true,durableIdempotency:true}),
  verifyReservation:()=>({status:money==="RESERVED"?"RESERVED":"NOT_RESERVED",
   nativeDurable:true,escrowKey:contractID,contractID,corporationID:1000001,
   amountISK:600000}),
  verifySettlement:()=>money==="PAID"?{status:"SETTLED",contractID,
   nativeDurable:true,escrowConsumed:true,corporationID:1000001,amountISK:600000,
   credits:[{characterID:701,amountISK:300000},{characterID:702,amountISK:300000}]}:
   {status:"NOT_SETTLED"},
  settleAtomic:()=>{debit++;assert.equal(money,"RESERVED");money="PAID";
   if(unknownAck)throw Error("LOST_ACK");
   return {status:"SETTLED",contractID}}
 };
 const reqs={
  "./coopEscortNativeFunds":{createEscortNativeFunds:()=>funds},
  "./coopEscortFlightGate":{createEscortFlightGate:()=>({
   read:()=>f,readFunded:()=>({status:reserved?
    "NATIVE_PREFUNDED_BOOKING_VERIFIED":"FLIGHT_NATIVE_RESERVATION_NOT_VERIFIED"}),
   readNativeDelivery:()=>({status:"DELIVERED",terminal:true,
    nativeFullManifestProof:stock()}),
   listDelivered:()=>{scan++;return {status:"READY",manifestKeys:listKeys}},
   fundBeforeWarp:()=>{throw Error("NO_FUNDING_DURING_REPLAY")},
   recordDelivered:()=>({status:"DURABLE_NATIVE_DELIVERY_RECORDED"})})},
  "./coopEscortContractSettlement":{createEscortContractSettlement:()=>({
   read:()=>({status:"CONTRACT_NOT_FOUND"}),refund:()=>({status:"DISABLED"})})},
  "./coopEscortPeacefulSettlement":{createPeacefulEscortSettlement},
  "./coopEscortDepartureWitness":{createDepartureWitness:()=>({
   read:()=>departure?{status:"VERIFIED_NATIVE_ESCORT_DEPARTURE",
    at:1000000,manifestKey:key,contractID,characters:[701,702],
    shipIDs:[1701,1702],origin:{x:0,y:0,z:0}}:{status:"DEPARTURE_NOT_RECORDED"},
   readDurable:()=>departure?{status:"VERIFIED_NATIVE_ESCORT_DEPARTURE",
    at:1000000,manifestKey:key,contractID,characters:[701,702],
    shipIDs:[1701,1702],origin:{x:0,y:0,z:0}}:{status:"DEPARTURE_NOT_RECORDED"}})},
  "./coopEscortRouteWitness":{createRouteWitness:()=>({
   verify:()=>route?{status:"VERIFIED_NATIVE_ESCORT_ROUTE_SERVICE",
    manifestKey:key,contractID,characters:[701,702],
    firstAt:1001000,secondAt:1002000}:{status:"ROUTE_CHECKPOINT_NOT_FOUND"}})},
  "./coopEscortTerminalAttendance":{createEscortTerminalAttendance:()=>({
   readDurable:()=>terminal?{status:"VERIFIED_NATIVE_ESCORT_TERMINAL_ATTENDANCE"}:
    {status:"TERMINAL_ATTENDANCE_NOT_FOUND"},
   record:()=>{terminalWrites++;return {status:"VERIFIED_NATIVE_ESCORT_TERMINAL_ATTENDANCE"}})}
 };
 const mod={exports:{}};
 vm.runInNewContext(source,{require:k=>{
  if(!reqs[k])throw Error("UNKNOWN_ESCORT_RUNTIME_DEPENDENCY:"+k);
  return reqs[k]},module:mod,process});
 const runtime=mod.exports.createEscortRuntime({
  root:"/tmp/coop-peaceful-replay",clock:()=>1003000,
  atomicRows:{transact:()=>({}),mode:"SERVER_INTERNAL_FLAGGED",isPoisoned:()=>false},
  isNpcCorporation:()=>true,
  authorizeBooking:()=>({status:"AUTHORIZED_NATIVE_ESCORT_BOOKING"}),
  verifyNativeDuo:()=>({status:"VERIFIED_NATIVE_DUO_FLEET",fleetID:44,
   characters:[701,702]}),
  authorizeOffer:()=>({status:"AUTHORIZED_NATIVE_ESCORT"}),
  readManifest:()=>({status:"READY"}),
  verifyManifest:()=>stock(),
  readIncidents:()=>({status:"READY",incidents:[]}),
  readOutcomes:()=>({status:"READY",outcomes:[]}),
  readNativeFailure:()=>({status:"NOT_FOUND"})
 });
 return {runtime,flight:f,scans:()=>scan,wallet:()=>money,debits:()=>debit,
  recorded:()=>terminalWrites,stock:stock(),key};
}
test("offline peaceful replay credits exact two original players once from true warehouse+terminal journals",()=>{
 const f=fixture();
 const r=f.runtime.reconcilePeacefulDeliveries({maxTrips:5});
 assert.equal(r.status,"NATIVE_PEACEFUL_REPLAY_CHECKED");
 assert.equal(r.paid,1);assert.equal(r.blocked,0);
 assert.equal(f.debits(),1);assert.equal(f.wallet(),"PAID");
 assert.equal(f.runtime.reconcilePeacefulDeliveries({maxTrips:5}).alreadyPaid,1);
 assert.equal(f.debits(),1);
});
test("lost native atomic settlement ACK re-reads original wallet, never debits again",()=>{
 const f=fixture({unknownAck:true});
 assert.equal(f.runtime.reconcilePeacefulDeliveries().alreadyPaid,1);
 assert.equal(f.debits(),1);
 assert.equal(f.runtime.reconcilePeacefulDeliveries().alreadyPaid,1);
 assert.equal(f.debits(),1);
});
test("pre-paid original contract is audited, not paid a second time",()=>{
 const f=fixture({walletPaid:true});
 assert.equal(f.runtime.reconcilePeacefulDeliveries().alreadyPaid,1);
 assert.equal(f.debits(),0);
});
test("missing original two-pilot terminal evidence cannot credit either character",()=>{
 const f=fixture({terminal:false});
 const r=f.runtime.reconcilePeacefulDeliveries();
 assert.equal(r.pending,1);assert.equal(f.debits(),0);
});
test("missing original source or intermediate route blocks terminal replay",()=>{
 const x=fixture({departure:false}),y=fixture({route:false});
 assert.equal(x.runtime.reconcilePeacefulDeliveries().pending,1);
 assert.equal(y.runtime.reconcilePeacefulDeliveries().pending,1);
 assert.equal(x.debits(),0);assert.equal(y.debits(),0);
});
test("refunded or spent corporate escrow can never trigger peaceful credit",()=>{
 const f=fixture({reserved:false});
 assert.equal(f.runtime.reconcilePeacefulDeliveries().blocked,1);
 assert.equal(f.debits(),0);
});
test("not genuinely delivered original flight cannot be credited",()=>{
 const f=fixture({delivery:false});
 assert.equal(f.runtime.reconcilePeacefulDeliveries().blocked,1);
 assert.equal(f.debits(),0);
});
test("reconciliation reads only native fsynced flight scan, never supplied player contract",()=>{
 const f=fixture({listKeys:[]});
 const r=f.runtime.reconcilePeacefulDeliveries({maxTrips:5});
 assert.equal(r.paid,0);assert.equal(f.scans(),1);assert.equal(f.debits(),0);
});
test("original fully verified manifest is required before terminal proof record",()=>{
 const f=fixture({delivery:false});
 assert.equal(f.runtime.recordTerminalAttendance(key,null,f.stock).status,
  "TERMINAL_ATTENDANCE_ESCROW_NOT_RESERVED"===null?"NO":"TERMINAL_ATTENDANCE_FLIGHT_NOT_FUNDED");
 assert.equal(f.recorded(),0);
});
test("trust-bound terminal recorder runs only with original FUNDED manifest and live original escrow",()=>{
 const f=fixture();
 assert.equal(f.runtime.recordTerminalAttendance(key,null,f.stock).status,
  "TERMINAL_ATTENDANCE_FLIGHT_NOT_FUNDED");
 assert.equal(f.recorded(),0);
});
test("replay flag OFF denies all reconciling wallet writes",()=>{
 const f=fixture();
 process.env.EVEJS_COOP_ESCORT_PEACEFUL_REPLAY="0";
 try{assert.equal(f.runtime.reconcilePeacefulDeliveries().status,"DISABLED");
  assert.equal(f.debits(),0)}
 finally{process.env.EVEJS_COOP_ESCORT_PEACEFUL_REPLAY="1"}
});
test("invalid operator scan cap is rejected without opening any journal",()=>{
 const f=fixture();
 assert.equal(f.runtime.reconcilePeacefulDeliveries({maxTrips:1000}).status,
  "PEACEFUL_REPLAY_SCAN_OPTIONS_INVALID");
 assert.equal(f.scans(),0);
});
process.on("exit",()=>{for(const [k,v] of Object.entries(prev))
 if(v===undefined)delete process.env[k];else process.env[k]=v});
