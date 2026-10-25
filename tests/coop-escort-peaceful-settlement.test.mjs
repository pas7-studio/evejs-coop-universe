import test from "node:test";
import assert from "node:assert/strict";
import {createRequire} from "node:module";
const require=createRequire(import.meta.url);
const {createPeacefulEscortSettlement}=require("../integration/coopEscortPeacefulSettlement.cjs");
const contractID="escort-30000144-77-123",manifestKey="30000144-77-123";
const booking=()=>({
 contractID,manifestKey,systemID:30000144,fleetID:77,haulerID:901,
 stationID:6001001,corporationID:1000001,amountISK:600000,
 playerFleetID:44,characters:[701,702]});
const warehouse=()=>({status:"FULL_NATIVE_CARGO_DELIVERY_VERIFIED",
 key:manifestKey,stationID:6001001,haulerIDs:[901],cargoIDs:[123,124]});
const delivery=()=>({status:"DELIVERED",terminal:true,nativeFullManifestProof:warehouse()});
function fixture({flight,stock,reservation,already=false,unknownAck=false,wrongCaps=false,serviceAllowed=true}={}){
 const b=booking();
 const f=flight||{status:"READY",phase:"DELIVERED",booking:b,delivery:delivery()};
 const d=stock||delivery();
 let wallet=already?"SETTLED":"RESERVED",calls=0,credits=[];let held=600000;
 const funds={
  capabilities:()=>wrongCaps?{nativeDurable:false}:{nativeDurable:true,atomicDualCredit:true,durableIdempotency:true},
  verifyReservation:c=>reservation||{status:wallet==="RESERVED"?"RESERVED":"NOT_RESERVED",
   nativeDurable:true,contractID:c.contractID,corporationID:c.corporationID,
   escrowKey:c.contractID,amountISK:c.amountISK},
  verifySettlement:c=>wallet==="SETTLED"?{
   status:"SETTLED",nativeDurable:true,escrowConsumed:true,contractID:c.contractID,
   corporationID:c.corporationID,amountISK:c.amountISK,
   credits:[{characterID:701,amountISK:300000},{characterID:702,amountISK:300000}]
  }:{status:"NOT_SETTLED"},
  settleAtomic:req=>{
   calls++;assert.equal(wallet,"RESERVED");
   assert.equal(req.contractID,contractID);
   assert.deepEqual(req.credits,[{characterID:701,amountISK:300000},
    {characterID:702,amountISK:300000}]);
   wallet="SETTLED";held=0;credits=req.credits;
   if(unknownAck)throw Error("ACK_LOST");
   return {status:"SETTLED",contractID};
  }
 };
 const service=createPeacefulEscortSettlement({readFlight:()=>f,readNativeDelivery:()=>d,
  verifyService:b=>serviceAllowed?{status:"VERIFIED_NATIVE_ESCORT_SERVICE",
   characters:b.characters.slice(),fleetID:b.playerFleetID,haulerID:b.haulerID,
   systemID:b.systemID}:{status:"NO_NATIVE_ESCORT_SERVICE"},nativeFunds:funds});
 return {service,b,f,d,funds,calls:()=>calls,held:()=>held,credits:()=>credits};
}
const old=process.env.EVEJS_COOP_ESCORT_PEACEFUL_PAYOUT;
process.env.EVEJS_COOP_ESCORT_PEACEFUL_PAYOUT="1";
test("peaceful safe native delivery pays both registered pilots from ONE reservation",()=>{
 const f=fixture();
 assert.equal(f.service.settle(manifestKey).status,"NATIVE_PEACEFUL_ESCORT_PAID");
 assert.equal(f.calls(),1);
 assert.equal(f.held(),0);
 assert.deepEqual(f.credits().map(c=>c.amountISK),[300000,300000]);
});
test("zero pirate wreck/incident is needed for real successful delivery",()=>{
 const f=fixture();
 assert.equal(f.service.settle(manifestKey).status,"NATIVE_PEACEFUL_ESCORT_PAID");
});
test("replayed delivery never pays twice",()=>{
 const f=fixture();
 assert.equal(f.service.settle(manifestKey).status,"NATIVE_PEACEFUL_ESCORT_PAID");
 assert.equal(f.service.settle(manifestKey).status,"ALREADY_NATIVE_PAID");
 assert.equal(f.calls(),1);
});
test("native payout ACK lost is reconciled from durable SETTLED receipt",()=>{
 const f=fixture({unknownAck:true});
 assert.equal(f.service.settle(manifestKey).status,"ALREADY_NATIVE_PAID");
 assert.equal(f.service.settle(manifestKey).status,"ALREADY_NATIVE_PAID");
 assert.equal(f.calls(),1);
});
test("already paid independent receipt prevents duplicate payouts",()=>{
 const f=fixture({already:true});
 assert.equal(f.service.settle(manifestKey).status,"ALREADY_NATIVE_PAID");
 assert.equal(f.calls(),0);
});
test("never pay funded prewarp or undelivered manifest",()=>{
 const f=fixture({flight:{status:"READY",phase:"FUNDED",booking:booking(),delivery:null}});
 assert.equal(f.service.settle(manifestKey).status,"NATIVE_TERMINAL_DELIVERY_UNVERIFIED");
 assert.equal(f.calls(),0);
});
test("empty, missing or forged warehouse item evidence blocks",()=>{
 const d=delivery();d.nativeFullManifestProof.cargoIDs=[];
 const f=fixture({stock:d});
 assert.equal(f.service.settle(manifestKey).status,"NATIVE_FULL_WAREHOUSE_DELIVERY_UNVERIFIED");
 assert.equal(f.calls(),0);
});
test("warehouse wrong destination blocks",()=>{
 const d=delivery();d.nativeFullManifestProof.stationID++;
 const f=fixture({stock:d});
 assert.equal(f.service.settle(manifestKey).status,"NATIVE_FULL_WAREHOUSE_DELIVERY_UNVERIFIED");
});
test("changed cargo IDs after quote blocks",()=>{
 const d=delivery();d.nativeFullManifestProof.cargoIDs=[123,125];
 const f=fixture({stock:d});
 assert.equal(f.service.settle(manifestKey).status,"NATIVE_FULL_WAREHOUSE_DELIVERY_UNVERIFIED");
});
test("different native ship cannot complete source contract",()=>{
 const d=delivery();d.nativeFullManifestProof.haulerIDs=[999];
 const f=fixture({stock:d});
 assert.equal(f.service.settle(manifestKey).status,"NATIVE_FULL_WAREHOUSE_DELIVERY_UNVERIFIED");
});
test("wallet unreserved or refunded fails closed",()=>{
 const f=fixture({reservation:{status:"NOT_RESERVED"}});
 assert.equal(f.service.settle(manifestKey).status,"NATIVE_ESCROW_NOT_RESERVED");
 assert.equal(f.calls(),0);
});
test("native escort participation missing prevents payout",()=>{
 const f=fixture({serviceAllowed:false});
 assert.equal(f.service.settle(manifestKey).status,"NATIVE_ESCORT_SERVICE_NOT_VERIFIED");
 assert.equal(f.calls(),0);
});
test("atomic native GameStore capability is mandatory",()=>{
 const f=fixture({wrongCaps:true});
 assert.equal(f.service.settle(manifestKey).status,"NATIVE_FUNDS_NOT_ATOMIC");
 assert.equal(f.calls(),0);
});
test("changed or missing original pilot fleet fails before paying",()=>{
 const b=booking();delete b.playerFleetID;
 const f=fixture({flight:{status:"READY",phase:"DELIVERED",booking:b,delivery:delivery()}});
 assert.equal(f.service.settle(manifestKey).status,"NATIVE_ESCORT_BOOKING_UNTRUSTED");
 assert.equal(f.calls(),0);
});
test("invalid real manifest key cannot traverse paths",()=>{
 const f=fixture();
 assert.equal(f.service.settle("../var/lib/evejs").status,"NATIVE_MANIFEST_KEY_INVALID");
 assert.equal(f.calls(),0);
});
test("feature OFF never mutates native wallet",()=>{
 const f=fixture();process.env.EVEJS_COOP_ESCORT_PEACEFUL_PAYOUT="0";
 try{assert.equal(f.service.settle(manifestKey).status,"DISABLED");assert.equal(f.calls(),0)}
 finally{process.env.EVEJS_COOP_ESCORT_PEACEFUL_PAYOUT="1"}
});
test("wrong terminal receipt blocks",()=>{
 const d=delivery();d.terminal=false;
 const f=fixture({stock:d});
 assert.equal(f.service.settle(manifestKey).status,"NATIVE_FULL_WAREHOUSE_DELIVERY_UNVERIFIED");
});
test("corrupt or unavailable original flight is not payable",()=>{
 const f=fixture({flight:{status:"FLIGHT_JOURNAL_CORRUPT"}});
 assert.equal(f.service.settle(manifestKey).status,"NATIVE_TERMINAL_DELIVERY_UNVERIFIED");
});
test("last trusted source is native station, not a chat grant",async()=>{
 const fs=await import("node:fs");
 const station=fs.readFileSync(new URL("../integration/coopNativeStationArrival.cjs",import.meta.url),"utf8");
 const binding=fs.readFileSync(new URL("../integration/coopEscortNativeBinding.cjs",import.meta.url),"utf8");
 const runtime=fs.readFileSync(new URL("../integration/coopEscortRuntime.cjs",import.meta.url),"utf8");
 assert.match(station,/EVEJS_COOP_ESCORT_PEACEFUL_PAYOUT/);
 assert.match(station,/settlePeacefulDelivery\(trip\.manifestID,scene\)/);
 assert.match(binding,/settlePeacefulFlight\(manifestKey,scene\)/);
 assert.match(runtime,/createPeacefulEscortSettlement/);
});
process.on("exit",()=>{
 if(old===undefined)delete process.env.EVEJS_COOP_ESCORT_PEACEFUL_PAYOUT;
 else process.env.EVEJS_COOP_ESCORT_PEACEFUL_PAYOUT=old;
});
