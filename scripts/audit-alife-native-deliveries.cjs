"use strict";
// ALIFE-03: read-only observation audit, not an authorization to mint ore/ISK.
// Source of truth stays native committed warehouse + physical itemStore +
// full durable manifest verifier in coopNativeHaulManifest.
const fs=require("node:fs");
const positive=x=>Number.isSafeInteger(x)&&x>0;
function auditNativeDeliveryEvents(rows,{maxRows=100000}={}){
 const bad=reason=>({status:reason,uniqueTrips:0,duplicates:0,conflicts:[],invalid:0,events:0});
 if(!Array.isArray(rows)||rows.length>maxRows||!Number.isSafeInteger(maxRows)||
   maxRows<1||maxRows>500000)return bad("INVALID_NATIVE_DELIVERY_AUDIT_INPUT");
 const seen=new Map(),cargoOwners=new Map(),conflicts=[];let invalid=0,duplicates=0,events=0;
 for(const record of rows){
  if(record?.event!=="alife-native-delivery-settled")continue;
  events++;
  const tripID=record?.manifestID;
  const haulers=record?.haulerIDs,cargoIDs=record?.cargoIDs;
  const valid=positive(record.systemID)&&positive(record.fleetID)&&
   positive(record.stationID)&&positive(record.corporationID)&&
   typeof tripID==="string"&&/^\d+-\d+-\d+$/.test(tripID)&&
   tripID.startsWith(record.systemID+"-"+record.fleetID+"-")&&
   record.eventID==="alife-native-delivery:"+tripID&&
   record.status==="NATIVE_FULL_MANIFEST_WITNESSED"&&
   record.proof==="WAREHOUSE_COMMITTED_AND_NATIVE_ITEMSTORE_VERIFIED"&&
   record.nativeMutation===false&&record.iskCredited===false&&
   record.paidReward===false&&Array.isArray(haulers)&&haulers.length>0&&
   haulers.length<=32&&haulers.every(positive)&&
   new Set(haulers).size===haulers.length&&
   Array.isArray(cargoIDs)&&cargoIDs.length>0&&cargoIDs.length<=1000&&
   cargoIDs.every(positive)&&new Set(cargoIDs).size===cargoIDs.length&&
   record.stacks===cargoIDs.length&&positive(record.quantity);
  if(!valid){invalid++;continue;}
  const tuple=JSON.stringify([record.systemID,record.fleetID,
   record.stationID,record.corporationID,[...haulers].sort((a,b)=>a-b),
   [...cargoIDs].sort((a,b)=>a-b),record.stacks,record.quantity]);
  if(seen.has(tripID)){
   if(seen.get(tripID)!==tuple)conflicts.push({manifestID:tripID,reason:"TRIP_RECEIPT_CONFLICT"});
   else duplicates++;
   continue;
  }
  seen.set(tripID,tuple);
  for(const cargoID of cargoIDs){
   const first=cargoOwners.get(cargoID);
   if(first&&first!==tripID)conflicts.push({manifestID:tripID,cargoID,
    reason:"CARGO_RECEIPT_REUSED_ACROSS_TRIPS"});
   else cargoOwners.set(cargoID,tripID);
  }
 }
 return {status:invalid||conflicts.length?"NATIVE_DELIVERY_EVENT_REPAIR_REQUIRED":
  events===0?"NO_NATIVE_DELIVERY_EVENTS":
   "NATIVE_SETTLEMENT_EVENTS_OBSERVED_NOT_LEDGER_AUDITED",
  uniqueTrips:seen.size,duplicates,conflicts,invalid,events,
  // Only factual telemetry; real reconciliation requires warehouse files,
  // GameStore item IDs and physical original cargo checks.
  provesNativeLedger:false,provesClientGameplay:false};
}
function parse(raw){
 if(typeof raw!=="string"||raw.length>16*1024*1024)
  throw Error("NATIVE_DELIVERY_LOG_TOO_LARGE");
 return raw.split(/\r?\n/).filter(Boolean).map(line=>{
  try{return JSON.parse(line)}catch{return {event:"alife-native-delivery-settled",invalidLog:true}}
 });
}
if(require.main===module){
 const file=process.argv[2];
 if(!file||!fs.existsSync(file)){
  console.error("usage: node scripts/audit-alife-native-deliveries.cjs <copied-coop-events.jsonl>");
  process.exitCode=2;
 }else{
  try{
   const summary=auditNativeDeliveryEvents(parse(fs.readFileSync(file,"utf8")));
   console.log(JSON.stringify(summary,null,2));
   if(summary.status==="NATIVE_DELIVERY_EVENT_REPAIR_REQUIRED")process.exitCode=1;
  }catch(error){console.error("audit unavailable:",error.message);process.exitCode=2;}
 }
}
module.exports={auditNativeDeliveryEvents,parse};
