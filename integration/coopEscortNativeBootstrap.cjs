"use strict";
// Operator opt-in native source wiring. Nothing runs or writes on require().
const {createPricedOffers,installServerAuthority}=require("./coopEscortPricedOffers");
const {createManifest}=require("./coopNativeHaulManifest");
const {createOutcomes}=require("./coopConvoyOutcomeProof");
const {createOperations}=require("./coopConvoyOperations");
const {inSpaceParty}=require("./coopNativeFleetParty");
const pos=x=>Number.isSafeInteger(x)&&x>0;
const same=(a,b)=>Array.isArray(a)&&Array.isArray(b)&&a.length===b.length&&
 a.every((x,i)=>x===b[i]);
function createPinnedOfferAuthority({quoteRoot,manifestRoot,amountISK,
 io,clock=()=>Date.now(),board,npcStore,items,corporations,
 corporationWallet,sessions,spaceRuntime,fleetRuntime}={}){
 if(!require("node:path").isAbsolute(quoteRoot||"")||
  !require("node:path").isAbsolute(manifestRoot||"")||
  !pos(amountISK)||amountISK>1000000000||amountISK%2!==0||
  !board||typeof board.readEvent!=="function"||
  !npcStore||typeof npcStore.getNativeEntity!=="function"||
  typeof npcStore.listNativeCargoForEntity!=="function"||
  !items||typeof items.findWarehouseItem!=="function"||
  typeof corporations?.isNpcCorporationID!=="function"||
  typeof corporationWallet?.getCorporationWalletBalance!=="function"||
  typeof sessions?.getSessions!=="function"||
  typeof spaceRuntime?.getSceneForSession!=="function"||
  typeof fleetRuntime?.getFleetForCharacter!=="function")
  throw Error("PINNED_NATIVE_ESCORT_QUOTE_AUTHORITIES_REQUIRED");
 const manifest=createManifest({root:manifestRoot,io,
  store:npcStore,items,getNativeEntity:npcStore.getNativeEntity,clock});
 const paid=createPricedOffers({root:quoteRoot,io,clock,
  readEvent:board.readEvent,
  readManifest:manifest.read,
  readDuoVolunteers:eventID=>require("./coopEscortVolunteers").readVerifiedNativePair(eventID),
  authorizeNativeQuote:({event,route})=>{
   const e=event?.event;
   if(event?.status!=="READY"||e?.stage!=="PREPARING"||
    e.systemID!==route.systemID||e.entityID!==route.haulerID||
    e.stationID!==route.stationID||
    corporations.isNpcCorporationID(route.corporationID)!==true)
    return {status:"DENIED_NATIVE_ESCORT_QUOTE"};
   const ship=npcStore.getNativeEntity(route.haulerID);
   const cargo=npcStore.listNativeCargoForEntity(route.haulerID);
   if(!ship||ship.transient===true||ship.entityID!==route.haulerID||
    ship.systemID!==route.systemID||!Array.isArray(cargo)||
    !same(cargo.map(x=>x.cargoID).sort((a,b)=>a-b),route.cargoIDs)||
    cargo.some(x=>x.transient===true||x.coopHaulFleetID!==route.fleetID||
     x.entityID!==route.haulerID||!pos(x.quantity)))
    return {status:"DENIED_NATIVE_ESCORT_CARGO"};
   const balance=corporationWallet.getCorporationWalletBalance(route.corporationID,1000);
   if(!Number.isFinite(balance)||balance<amountISK)
    return {status:"NATIVE_NPC_CORPORATION_INSUFFICIENT_FUNDS"};
   return {status:"AUTHORIZED_NATIVE_CORPORATION_ESCORT_QUOTE",
    eventID:e.id,
    contractID:"escort-"+route.systemID+"-"+route.fleetID+"-"+route.cargoIDs[0],
    systemID:route.systemID,fleetID:route.fleetID,
    stationID:route.stationID,corporationID:route.corporationID,
    haulerID:route.haulerID,cargoIDs:route.cargoIDs.slice(),
    amountISK,nativeCorporationBalanceVerified:true};
  },
  verifyLiveAcceptingPilot:({session,quote,volunteers})=>{
   if(!pos(session?.characterID)||session?.socket?.destroyed===true||
    session?._space?.initialStateSent!==true||
    session._space.systemID!==quote.systemID||
    !pos(session._space.shipID)||!Array.isArray(volunteers?.pilots))
    return {status:"NATIVE_ACCEPT_SESSION_INVALID"};
   const online=sessions.getSessions();
   if(!Array.isArray(online)||online.filter(x=>x===session).length!==1||
    online.filter(x=>x?.characterID===session.characterID).length!==1)
    return {status:"NATIVE_ACCEPT_SESSION_DUPLICATE"};
   const pilots=volunteers.pilots.map(x=>online.filter(s=>
    s?.characterID===x.characterID&&s?.socket?.destroyed!==true&&
    s?._space?.initialStateSent===true&&s._space.systemID===quote.systemID&&
    s._space.shipID===x.shipID));
   if(pilots.length!==2||pilots.some(p=>p.length!==1))
    return {status:"NATIVE_ACCEPT_PEER_NOT_PRESENT"};
   const native=inSpaceParty({leaderSession:pilots[0][0],
    peerSession:pilots[1][0],fleetRuntime,spaceRuntime});
   if(!native.ok||native.fleetID!==volunteers.fleetID||
    native.systemID!==quote.systemID)
    return {status:"NATIVE_ACCEPT_NATIVE_FLEET_UNVERIFIED"};
   const scene=spaceRuntime.getSceneForSession(session);
   const target=scene?.getEntityByID?.(quote.haulerID);
   if(target?.kind!=="ship"||target.nativeNpc!==true||
    target.itemID!==quote.haulerID||target.transient===true)
    return {status:"NATIVE_ACCEPT_HAULER_MISSING"};
   return {status:"VERIFIED_NATIVE_ESCORT_ACCEPTOR",
    characterID:session.characterID,shipID:session._space.shipID,
    fleetID:native.fleetID,systemID:native.systemID};
  }});
 return paid;
}
function verifiedHaulerLoss({readOutcomes,contract}){
 if(typeof readOutcomes!=="function"||!contract)
  return {status:"NATIVE_FAILURE_UNAVAILABLE"};
 let o;try{o=readOutcomes()}catch{return {status:"NATIVE_FAILURE_UNAVAILABLE"}}
 const rows=o?.outcomes?.filter(x=>x.key===contract.incidentKey&&
  x.systemID===contract.systemID&&x.pirateID===contract.pirateID&&
  x.targetID===contract.haulerID&&
  x.status==="HAULER_NATIVE_LOSS_VERIFIED"&&
  pos(x.haulerNativeWreckID)&&
  Array.isArray(x.verifiedWarehouseStacks)&&
  x.verifiedWarehouseStacks.length===0);
 if(o?.status!=="READY"||rows?.length!==1)
  return {status:"NATIVE_FAILURE_NOT_VERIFIED"};
 const row=rows[0];
 return {status:"DURABLE_NATIVE_CONVOY_TERMINAL_FAILURE",
  contractID:contract.contractID,manifestKey:contract.manifestKey,
  corporationID:contract.corporationID,reason:"NATIVE_HAULER_WRECK",
  failureWitnessID:row.haulerNativeWreckID,nativeDurable:true,
  deliveryImpossible:true,noPriorPayout:true};
}
let lastState=null;
function installNativeEscorts(){
 if(process.env.EVEJS_COOP_ESCORT_RUNTIME_MOUNT!=="1"||
  process.env.EVEJS_COOP_ESCORT_PAID_ACCEPT!=="1"||
  process.env.EVEJS_COOP_ESCORT_CONTRACTS!=="1"||
  process.env.EVEJS_COOP_ESCORT_ROUTE_GATE!=="1")
  return {status:"DISABLED"};
 if(lastState)return lastState;
 const price=Number(process.env.EVEJS_COOP_ESCORT_REWARD_ISK);
 if(!pos(price)||price%2!==0||price>1000000000)
  return {status:"ESCORT_REWARD_POLICY_NOT_CONFIGURED"};
 const quoteRoot=process.env.EVEJS_DATA_ROOT||"/var/lib/evejs";
 const manifestRoot=process.env.EVEJS_COOP_NPC_WAREHOUSE_DIR||
  "/var/lib/evejs/coop-native-warehouse";
 try{
  const board=require("./coopWorldOpportunityBoard");
  const npcStore=require("./npc/nativeNpcStore");
  const items=require("../services/inventory/itemStore");
  const corporations=require("../services/corporation/corporationState");
  const sessions=require("../services/chat/sessionRegistry");
  const spaceRuntime=require("./runtime");
  const fleetRuntime=require("../services/fleets/fleetRuntime");
  const corpWallet=require("../services/corporation/corpWalletState");
  const offer=createPinnedOfferAuthority({quoteRoot,manifestRoot,
   amountISK:price,board:{readEvent:board.readNativeEvent},
   npcStore,items,corporations,corporationWallet:corpWallet,
   sessions,spaceRuntime,fleetRuntime});
  const accepted=require("./coopEscortPricedOffers").installServerAuthority(offer);
  if(accepted.status!=="PRICED_ESCORT_NATIVE_AUTHORITY_INSTALLED")
   return {status:accepted.status};
  const incidents=()=>createOperations().snapshot();
  const outcomes=()=>createOutcomes({incidents}).snapshot();
  const mount=require("./coopEscortNativeMount").installPinnedNative({
   root:manifestRoot,
   readAuthorizedOffer:route=>require("./coopEscortPricedOffers").approvedForManifest(route),
   readPilotConsent:route=>require("./coopEscortPricedOffers").consentForManifest(route),
   readNativeFailure:contract=>verifiedHaulerLoss({readOutcomes:outcomes,contract})
  });
  lastState=mount;return mount;
 }catch{return {status:"ESCORT_NATIVE_BOOTSTRAP_UNAVAILABLE"}}
}
module.exports={createPinnedOfferAuthority,verifiedHaulerLoss,installNativeEscorts};
