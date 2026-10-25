"use strict";
// Single service to compose Stage A+B+C under real native authorities.
// Requires actual GameStore SQLite bridge; never auto-installs an unsafe provider.
const {createEscortNativeFunds}=require("./coopEscortNativeFunds");
const {createEscortFlightGate}=require("./coopEscortFlightGate");
const {createEscortContractSettlement}=require("./coopEscortContractSettlement");
const {createPeacefulEscortSettlement}=require("./coopEscortPeacefulSettlement");
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
    fleetID:offer?.playerFleetID,manifestKey:route.manifestKey,
    haulerID:route.haulerIDs?.[0],contractID:offer?.contractID})}
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
 const peaceful=createPeacefulEscortSettlement({readFlight:flight.read,
  readNativeDelivery:flight.readNativeDelivery,nativeFunds:funds,
  verifyService:(b,scene)=>{
   const deny=()=>({status:"NO_NATIVE_ESCORT_SERVICE"});
   if(scene?.systemID!==b.systemID||
    typeof scene.getEntityByID!=="function"||
    typeof scene.sessions?.values!=="function")return deny();
   let duo;try{duo=verifyNativeDuo({
    systemID:b.systemID,stationID:b.stationID,corporationID:b.corporationID,
    fleetID:b.playerFleetID,manifestKey:b.manifestKey,
    contractID:b.contractID,haulerID:b.haulerID,characters:b.characters.slice()});
   }catch{return deny()}
   if(duo?.status!=="VERIFIED_NATIVE_DUO_FLEET"||
    duo.fleetID!==b.playerFleetID||!equal(duo.characters,b.characters))return deny();
   const hauler=scene.getEntityByID(b.haulerID);
   const validPosition=p=>p&&["x","y","z"].every(k=>Number.isFinite(p[k]));
   if(hauler?.kind!=="ship"||hauler.nativeNpc!==true||
    hauler.itemID!==b.haulerID||!validPosition(hauler.position))return deny();
   for(const characterID of b.characters){
    const sessions=[...scene.sessions.values()].filter(x=>
     x?.characterID===characterID&&x?.socket?.destroyed!==true&&
     x?._space?.initialStateSent===true&&
     x._space.systemID===b.systemID&&pos(x._space.shipID));
    if(sessions.length!==1)return deny();
    const player=scene.getEntityByID(sessions[0]._space.shipID);
    if(player?.kind!=="ship"||player.nativeNpc===true||
     player.itemID!==sessions[0]._space.shipID||!validPosition(player.position)||
     Math.hypot(player.position.x-hauler.position.x,
      player.position.y-hauler.position.y,
      player.position.z-hauler.position.z)>150000)return deny();
   }
   return {status:"VERIFIED_NATIVE_ESCORT_SERVICE",characters:b.characters.slice(),
    fleetID:b.playerFleetID,haulerID:b.haulerID,systemID:b.systemID};
  }});
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
  readNativeDelivery:c=>{
   const active=flight.readNativeDelivery(c);
   if(active?.status==="DELIVERED")return active;
   // Audit alone can read a paid trip; never use paid receipt as a
   // substitute for RESERVED before first warp or before payout.
   let receipt;try{receipt=funds.verifySettlement(c)}catch{}
   if(receipt?.status==="SETTLED"&&receipt.nativeDurable===true)
    return flight.readNativeDeliveryForAudit(c);
   return active;
  },
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

 // A destroyed hauler may NEVER reach Stage A's successful-delivery path.
 // Reconstruct that contract exclusively from the original immutable
 // prewarp booking plus the independently journalled native hauler wreck.
 // No trusted wreck -> no Stage A creation, and absolutely no refund.
 function refundWreckedFlight(manifestKey){
  if(!ready()||process.env.EVEJS_COOP_ESCORT_REFUNDS!=="1")
   return blocked("DISABLED");
  if(typeof manifestKey!=="string"||!/^\d+-\d+-\d+$/.test(manifestKey))
   return blocked("NATIVE_REFUND_MANIFEST_KEY_INVALID");
  let state;try{state=flight.read(manifestKey)}
  catch{return blocked("NATIVE_REFUND_FLIGHT_JOURNAL_UNAVAILABLE")}
  if(state?.status!=="READY"||state.phase!=="FUNDED")
   return blocked("NATIVE_REFUND_FLIGHT_NOT_FUNDED_OR_ALREADY_DELIVERED");
  const b=state.booking;
  if(!pos(b?.playerFleetID)||!pos(b?.haulerID)||
   !Array.isArray(b.characters)||b.characters.length!==2)
   return blocked("NATIVE_REFUND_ORIGINAL_DUO_NOT_RECORDED");
  let outcomes;try{outcomes=readOutcomes()}
  catch{return blocked("NATIVE_REFUND_OUTCOME_SOURCE_UNAVAILABLE")}
  if(outcomes?.status!=="READY"||!Array.isArray(outcomes.outcomes))
   return blocked("NATIVE_REFUND_OUTCOME_JOURNAL_UNVERIFIED");
  const eligible=outcomes.outcomes.filter(x=>
   x.systemID===b.systemID&&x.targetID===b.haulerID&&
   pos(x.pirateID)&&x.status==="HAULER_NATIVE_LOSS_VERIFIED"&&
   pos(x.haulerNativeWreckID)&&
   Array.isArray(x.verifiedWarehouseStacks)&&
   x.verifiedWarehouseStacks.length===0&&
   x.key===String(b.systemID)+":"+x.pirateID+":"+b.haulerID);
  if(eligible.length!==1)return blocked(eligible.length?
   "NATIVE_REFUND_AMBIGUOUS_HAULER_LOSS":"NATIVE_REFUND_HAULER_LOSS_NOT_PROVEN");
  const o=eligible[0];
  const c={contractID:b.contractID,manifestKey:b.manifestKey,
   systemID:b.systemID,fleetID:b.fleetID,haulerID:b.haulerID,
   stationID:b.stationID,corporationID:b.corporationID,
   pirateID:o.pirateID,incidentKey:o.key,fleetDuoID:b.playerFleetID,
   characters:b.characters.slice(),amountISK:b.amountISK};
  let loss;try{loss=readNativeFailure(c)}
  catch{return blocked("NATIVE_REFUND_IRREVERSIBLE_LOSS_UNAVAILABLE")}
  if(loss?.status!=="DURABLE_NATIVE_CONVOY_TERMINAL_FAILURE"||
   loss.contractID!==c.contractID||loss.manifestKey!==c.manifestKey||
   loss.corporationID!==c.corporationID||
   loss.failureWitnessID!==o.haulerNativeWreckID||
   loss.reason!=="NATIVE_HAULER_WRECK"||
   loss.nativeDurable!==true||
   loss.deliveryImpossible!==true||loss.noPriorPayout!==true)
   return blocked("NATIVE_REFUND_IRREVERSIBLE_LOSS_NOT_VERIFIED");
  let contract=contracts.read(c.contractID);
  if(contract.status==="CONTRACT_NOT_FOUND"){
   const created=contracts.create(c);
   if(created.status!=="OFFERED")return created;
   contract=contracts.read(c.contractID);
  }
  if(contract.status!=="READY")return contract;
  if(contract.phase==="OFFERED"){
   const ack=contracts.attachPrefunded(c.contractID);
   if(ack.status!=="FUNDED")return ack;
   contract=contracts.read(c.contractID);
  }
  if(contract.phase!=="FUNDED")
   return blocked("NATIVE_REFUND_CONTRACT_NOT_REPLAYABLE");
  return contracts.refund(c.contractID);
 }
 function settlePeacefulFlight(manifestKey,scene){
  if(!ready())return blocked("DISABLED");
  return peaceful.settle(manifestKey,scene);
 }
 function refundProvenLoss(contractID){
  if(!ready()||process.env.EVEJS_COOP_ESCORT_REFUNDS!=="1")
   return blocked("DISABLED");
  return contracts.refund(contractID);
 }
 return Object.freeze({fundBeforeWarp,recordDelivery,finishAfterRaid,settlePeacefulFlight,
  refundProvenLoss,refundWreckedFlight,readFlight:flight.read,readContract:contracts.read,
  inspectRefundRecovery:contracts.inspectRefundRecovery,
  proof:contracts.proof,nativeFunds:funds,flightGate:flight,contractEngine:contracts});
}
module.exports={createEscortRuntime};
