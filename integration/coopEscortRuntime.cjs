"use strict";
// Single service to compose Stage A+B+C under real native authorities.
// Requires actual GameStore SQLite bridge; never auto-installs an unsafe provider.
const {createEscortNativeFunds}=require("./coopEscortNativeFunds");
const {createEscortFlightGate}=require("./coopEscortFlightGate");
const {createEscortContractSettlement}=require("./coopEscortContractSettlement");
const pos=n=>Number.isSafeInteger(n)&&n>0;
const equal=(a,b)=>Array.isArray(a)&&Array.isArray(b)&&a.length===b.length&&
 a.every((x,i)=>x===b[i]);
const blocked=status=>({status});
function createEscortRuntime({root,io,clock=()=>Date.now(),atomicRows,isNpcCorporation,
 authorizeBooking,verifyNativeDuo,authorizeOffer,readManifest,verifyManifest,
 readIncidents,readOutcomes,readNativeFailure}={}){
 if([isNpcCorporation,authorizeBooking,verifyNativeDuo,authorizeOffer,
  readManifest,verifyManifest,readIncidents,readOutcomes,readNativeFailure].some(f=>typeof f!=="function")||
  !atomicRows||typeof atomicRows.transact!=="function"||
  atomicRows.mode!=="SERVER_INTERNAL_FLAGGED"||
  typeof atomicRows.isPoisoned!=="function"||atomicRows.isPoisoned()!==false)
  throw Error("ESCORT_RUNTIME_NATIVE_AUTHORITIES_REQUIRED");
 const flags=["EVEJS_COOP_ESCORT_CONTRACTS","EVEJS_COOP_ESCORT_ROUTE_GATE",
  "EVEJS_COOP_NATIVE_ATOMIC_ROWS","EVEJS_COOP_NATIVE_ESCORT_WALLET"];
 const ready=()=>flags.every(k=>process.env[k]==="1")&&atomicRows.isPoisoned()===false;
 const funds=createEscortNativeFunds({atomicRows,isNpcCorporation,clock,
  verifyNativeFailure:readNativeFailure});
 const booking=route=>{
  if(!ready())return blocked("DENIED_NATIVE_RUNTIME_DISABLED");
  let offer,duo;
  try{offer=authorizeBooking(route);
   duo=verifyNativeDuo({systemID:route.systemID,
    stationID:route.stationID,corporationID:route.corporationID,
    cargoIDs:route.cargoIDs,characters:offer?.characters,
    fleetID:offer?.playerFleetID})}
  catch{return blocked("DENIED_NATIVE_DUO_UNAVAILABLE")}
  if(offer?.status!=="AUTHORIZED_NATIVE_ESCORT_BOOKING"||
   duo?.status!=="VERIFIED_NATIVE_DUO_FLEET"||
   !pos(duo.fleetID)||duo.fleetID!==offer.playerFleetID||
   !Array.isArray(duo.characters)||duo.characters.length!==2||
   !duo.characters.every(pos)||duo.characters[0]>=duo.characters[1]||
   !equal(duo.characters,offer.characters))
   return blocked("DENIED_NATIVE_DUO_NOT_AUTHORIZED");
  return offer;
 };
 const flight=createEscortFlightGate({root,io,clock,authorizeBooking:booking,
  readManifest,verifyManifest,nativeFunds:funds});
 const contracts=createEscortContractSettlement({root,io,clock,
  authorizeOffer:c=>{
   if(!ready())return blocked("DENIED_NATIVE_RUNTIME_DISABLED");
   // An already-funded immutable native trip, not a newly generated offer.
   const proof=flight.readFunded(c);
   if(proof.status!=="NATIVE_PREFUNDED_BOOKING_VERIFIED")
    return blocked("DENIED_UNFUNDED_NATIVE_ROUTE");
   return authorizeOffer(c);
  },
  readManifest,verifyManifest,readIncidents,readOutcomes,
  readNativeDelivery:c=>flight.readNativeDelivery(c),
  readNativeFailure,nativeFunds:funds,
  readPrefunded:c=>flight.readFunded(c)});
 function fundBeforeWarp(route){
  return ready()?flight.fundBeforeWarp(route):blocked("DISABLED");
 }
 function recordDelivery(args){
  return ready()?flight.recordDelivered(args):blocked("DISABLED");
 }
 function finishAfterRaid(candidate){
  if(!ready())return blocked("DISABLED");
  if(!candidate||typeof candidate.contractID!=="string")
   return blocked("CONTRACT_ID_INVALID");
  let state=contracts.read(candidate.contractID);
  if(state.status==="CONTRACT_NOT_FOUND"){
   const result=contracts.create(candidate);
   if(result.status!=="OFFERED")return result;
   state=contracts.read(candidate.contractID);
  }
  if(state.status!=="READY")return state;
  if(state.phase==="OFFERED"){
   const funded=contracts.attachPrefunded(candidate.contractID);
   if(funded.status!=="FUNDED")return funded;
   state=contracts.read(candidate.contractID);
  }
  if(state.phase!=="FUNDED")return blocked("CONTRACT_NOT_SETTLEABLE");
  // Stage A independently rechecks durable real pirate/wreck, complete cargo,
  // real participant fleet and native escrow in one atomic dual-credit commit.
  return contracts.settle(candidate.contractID);
 }
 function refundProvenLoss(contractID){
  if(!ready()||process.env.EVEJS_COOP_ESCORT_REFUNDS!=="1")
   return blocked("DISABLED");
  return contracts.refund(contractID);
 }
 return Object.freeze({fundBeforeWarp,recordDelivery,finishAfterRaid,
  refundProvenLoss,readFlight:flight.read,readContract:contracts.read,
  inspectRefundRecovery:contracts.inspectRefundRecovery,
  proof:contracts.proof,nativeFunds:funds,flightGate:flight,contractEngine:contracts});
}
module.exports={createEscortRuntime};
