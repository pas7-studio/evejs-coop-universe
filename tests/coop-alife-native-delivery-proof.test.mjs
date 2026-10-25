import test from "node:test";
import assert from "node:assert/strict";
import {createRequire} from "node:module";
const require=createRequire(import.meta.url);
const {verifyFullNativeDelivery}=require("../integration/coopAlifeNativeDeliveryEvidence.cjs");
const {auditNativeDeliveryEvents,parse}=require("../scripts/audit-alife-native-deliveries.cjs");
function fixture(){
 const trip={systemID:30000144,fleetID:77,stationID:60000011,corporationID:1000035,
  startedAt:100000,manifestID:"30000144-77-100000",haulers:{901:{arrivedAt:105000}},
  expectedCargoIDs:[501,502]};
 const proof={status:"FULL_NATIVE_CARGO_DELIVERY_VERIFIED",key:trip.manifestID,
  stationID:trip.stationID,haulerIDs:[901],cargoIDs:[501,502],stacks:2,quantity:120,
  convoySaved:false,paidReward:false};
 return {trip,proof};
}
test("full validated physical manifest becomes a read-only ALIFE settlement observation",()=>{
 const f=fixture(),r=verifyFullNativeDelivery(f.trip,f.proof);
 assert.equal(r.status,"NATIVE_FULL_MANIFEST_WITNESSED");
 assert.equal(r.proof,"WAREHOUSE_COMMITTED_AND_NATIVE_ITEMSTORE_VERIFIED");
 assert.equal(r.nativeMutation,false);
 assert.equal(r.iskCredited,false);
 assert.equal(r.paidReward,false);
 assert.equal(r.eventID,"alife-native-delivery:30000144-77-100000");
 assert.deepEqual(r.cargoIDs,[501,502]);
 assert.equal(r.quantity,120);
});
test("even empty native cargo never proves delivery without full committed manifest",()=>{
 const f=fixture();
 for(const status of ["MANIFEST_SOURCE_CARGO_STILL_PRESENT",
   "MANIFEST_WAREHOUSE_RECEIPT_MISSING","MANIFEST_NATIVE_ITEMSTORE_STOCK_CONFLICT",null]){
  const r=verifyFullNativeDelivery(f.trip,{...f.proof,status});
  assert.equal(r.status,"BLOCKED");
 }
});
test("cross-station, wrong fleet and stale manifest identities refuse evidence",()=>{
 const f=fixture();
 for(const change of [{key:"30000144-88-100000"},{stationID:60000012},
   {haulerIDs:[902]},{cargoIDs:[501,503]},{stacks:1},{quantity:0}]){
  assert.equal(verifyFullNativeDelivery(f.trip,{...f.proof,...change}).status,"BLOCKED");
 }
 f.trip.fleetID=99;
 assert.equal(verifyFullNativeDelivery(f.trip,f.proof).status,"BLOCKED");
});
test("duplicate cargo/hauler identities and any phantom payout refuse proof",()=>{
 const f=fixture();
 for(const change of [{cargoIDs:[501,501]},{haulerIDs:[901,901]},
   {paidReward:true},{convoySaved:true}]){
  assert.equal(verifyFullNativeDelivery(f.trip,{...f.proof,...change}).status,"BLOCKED");
 }
 f.trip.expectedCargoIDs=[501,501];
 assert.equal(verifyFullNativeDelivery(f.trip,f.proof).status,"BLOCKED");
});
test("malformed or absent prior trip cannot authorize a manufactured event",()=>{
 const f=fixture();
 for(const bad of [null,{}, {...f.trip,manifestID:"wrong"},
  {...f.trip,haulers:{"0":{}}},{...f.trip,expectedCargoIDs:[]}]){
  assert.equal(verifyFullNativeDelivery(bad,f.proof).status,"BLOCKED");
 }
});
test("read-only event auditor keeps missing proof distinct from success",()=>{
 const r=auditNativeDeliveryEvents([]);
 assert.equal(r.status,"NO_NATIVE_DELIVERY_EVENTS");
 assert.equal(r.uniqueTrips,0);
 assert.equal(r.provesNativeLedger,false);
 assert.equal(r.provesClientGameplay,false);
});
test("one logged fully witnessed route counts once even if telemetry is replayed",()=>{
 const f=fixture(),e={event:"alife-native-delivery-settled",
  ...verifyFullNativeDelivery(f.trip,f.proof)};
 const r=auditNativeDeliveryEvents([e,{...e}]);
 assert.equal(r.status,"NATIVE_SETTLEMENT_EVENTS_OBSERVED_NOT_LEDGER_AUDITED");
 assert.equal(r.uniqueTrips,1);
 assert.equal(r.duplicates,1);
 assert.equal(r.conflicts.length,0);
});
test("mismatched item quantities for the same manifest are an audit conflict",()=>{
 const f=fixture(),e={event:"alife-native-delivery-settled",
  ...verifyFullNativeDelivery(f.trip,f.proof)};
 const r=auditNativeDeliveryEvents([e,{...e,quantity:999}]);
 assert.equal(r.status,"NATIVE_DELIVERY_EVENT_REPAIR_REQUIRED");
 assert.equal(r.conflicts[0].reason,"TRIP_RECEIPT_CONFLICT");
});
test("same cargoID reported delivered on two separate trips is not silently credited twice",()=>{
 const f=fixture(),e={event:"alife-native-delivery-settled",
  ...verifyFullNativeDelivery(f.trip,f.proof)};
 const trip={...f.trip,startedAt:200000,manifestID:"30000144-77-200000"};
 const other=verifyFullNativeDelivery(trip,{...f.proof,key:trip.manifestID});
 const r=auditNativeDeliveryEvents([e,{event:"alife-native-delivery-settled",...other}]);
 assert.equal(r.status,"NATIVE_DELIVERY_EVENT_REPAIR_REQUIRED");
 assert.ok(r.conflicts.some(x=>x.reason==="CARGO_RECEIPT_REUSED_ACROSS_TRIPS"));
});
test("forge item owner, unbounded arrays and economic mutation claim fail closed",()=>{
 const f=fixture(),e={event:"alife-native-delivery-settled",
  ...verifyFullNativeDelivery(f.trip,f.proof)};
 for(const change of [{nativeMutation:true},{iskCredited:true},{paidReward:true},
  {stationID:123},{eventID:"fake"},{cargoIDs:[501,501]},{stacks:999}]){
  const r=auditNativeDeliveryEvents([{...e,...change}]);
  assert.equal(r.status,"NATIVE_DELIVERY_EVENT_REPAIR_REQUIRED");
  assert.equal(r.uniqueTrips,0);
 }
});
test("invalid event log line cannot bypass audit but unrelated messages may be ignored",()=>{
 const f=fixture(),e={event:"alife-native-delivery-settled",
  ...verifyFullNativeDelivery(f.trip,f.proof)};
 const rows=parse(JSON.stringify(e)+"\nnot json\n"+JSON.stringify({event:"chat"}));
 const r=auditNativeDeliveryEvents(rows);
 assert.equal(r.status,"NATIVE_DELIVERY_EVENT_REPAIR_REQUIRED");
 assert.equal(r.invalid,1);
 assert.equal(auditNativeDeliveryEvents(null).status,"INVALID_NATIVE_DELIVERY_AUDIT_INPUT");
});
