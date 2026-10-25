"use strict";
// Genuine in-game rescue navigation for two paid escort pilots. The stock
// client/npc itemStore remains the sole authority for actual loot transfer.
const pos=x=>Number.isSafeInteger(x)&&x>0;
const finite=p=>p&&["x","y","z"].every(k=>Number.isFinite(p[k]));
function createRescueNavigation({readEvent,readFlight,readManifest,
 readOutcomes,getWreck,getWreckItems,getScene,warpPlayer,
 readVolunteer,clock=()=>Date.now()}={}){
 if([readEvent,readFlight,readManifest,readOutcomes,getWreck,getWreckItems,
  getScene,warpPlayer,readVolunteer,clock].some(x=>typeof x!=="function"))
  throw Error("ESCORT_RESCUE_AUTHORITIES_REQUIRED");
 const cooldown=new Map();
 function navigate(session,eventID){
  if(process.env.EVEJS_COOP_ESCORT_RESCUE_NAV!=="1")
   return {status:"DISABLED"};
  if(!/^convoy-\d+-\d+-\d+$/.test(String(eventID))||
   !pos(session?.characterID)||session?.socket?.destroyed===true||
   !pos(session?._space?.shipID)||session._space?.initialStateSent!==true)
   return {status:"RESCUE_NATIVE_PILOT_INVALID"};
  let event,vol,flight,manifest,outcomes,scene;
  try{
   event=readEvent(eventID);
   vol=readVolunteer(eventID);
   scene=getScene(session);
   flight=readFlight(event?.event?.linkedTripID);
   manifest=readManifest(event?.event?.linkedTripID);
   outcomes=readOutcomes();
  }catch{return {status:"RESCUE_NATIVE_SOURCE_UNAVAILABLE"}}
  const e=event?.event,b=flight?.booking,m=manifest?.record;
  if(event?.status!=="READY"||e?.type!=="CONVOY"||
   e.stage!=="PREPARING"||e.outcome!=="DEPARTED"||
   !/^(\d+)-(\d+)-(\d+)$/.test(String(e.linkedTripID))||
   flight?.status!=="READY"||flight.phase!=="FUNDED"||
   manifest?.status!=="READY"||m?.key!==e.linkedTripID||
   b?.manifestKey!==e.linkedTripID||
   b.systemID!==e.systemID||b.haulerID!==e.entityID||
   m.systemID!==b.systemID||m.fleetID!==b.fleetID||
   m.stationID!==b.stationID||m.corporationID!==b.corporationID||
   !pos(b.playerFleetID)||!Array.isArray(m.cargo)||!m.cargo.length||
   scene?.systemID!==b.systemID||session._space.systemID!==b.systemID||
   !Array.isArray(vol?.pilots)||vol.status!=="VERIFIED_NATIVE_DUO_VOLUNTEER"||
   vol.fleetID!==b.playerFleetID||!vol.pilots.some(p=>
     p.characterID===session.characterID&&p.shipID===session._space.shipID)||
   !b.characters.includes(session.characterID)||
   outcomes?.status!=="READY"||!Array.isArray(outcomes.outcomes))
   return {status:"RESCUE_CONTRACT_AND_DUO_NOT_VERIFIED"};
  // There can only be one authenticated native loss witness. Unknown or
  // partial loss must not result in a fabricated salvage opportunity.
  const losses=outcomes.outcomes.filter(x=>x.systemID===b.systemID&&
   x.targetID===b.haulerID&&x.status==="HAULER_NATIVE_LOSS_VERIFIED"&&
   pos(x.haulerNativeWreckID)&&!x.verifiedWarehouseStacks?.length);
  if(losses.length!==1)return {status:losses.length?
   "RESCUE_MULTIPLE_WRECKS_UNVERIFIED":"RESCUE_NO_VERIFIED_HAULER_WRECK"};
  const loss=losses[0];
  let wreck,items;try{
   wreck=getWreck(loss.haulerNativeWreckID);
   items=getWreckItems(loss.haulerNativeWreckID);
  }catch{return {status:"RESCUE_WRECK_STORE_UNAVAILABLE"}}
  const real=scene.getEntityByID?.(loss.haulerNativeWreckID);
  if(!wreck||wreck.systemID!==b.systemID||
   wreck.sourceEntityID!==b.haulerID||
   !finite(wreck.position)||
   real?.nativeNpcWreck!==true||
   real.itemID!==loss.haulerNativeWreckID||
   !finite(real.position)||!Array.isArray(items))
   return {status:"RESCUE_NATIVE_WRECK_NOT_PRESENT"};
  // Only cargo with an original physically traceable source ID is offered.
  // A same-type random wreck drop is NEVER claimed as escorted cargo.
  const surviving=items.filter(x=>pos(x.wreckItemID)&&
   x.wreckID===loss.haulerNativeWreckID&&
   m.cargo.some(c=>c.cargoID===x.sourceCargoID&&c.typeID===x.typeID&&
    pos(x.quantity)&&x.quantity<=c.quantity));
  if(!surviving.length)return {status:"RESCUE_NO_PROVEN_ORIGINAL_CARGO"};
  if(new Set(surviving.map(x=>x.sourceCargoID)).size!==surviving.length||
   new Set(surviving.map(x=>x.wreckItemID)).size!==surviving.length)
   return {status:"RESCUE_WRECK_CONTENTS_AMBIGUOUS"};
  const now=clock();
  const key=session.characterID+":"+eventID;
  if(!pos(now)||cooldown.has(key)&&now-cooldown.get(key)<60000)
   return {status:"RESCUE_NATIVE_WARP_COOLDOWN"};
  // Actual EVE warpToPoint uses the authenticated player session. The
  // resulting player's normal inventory/looting UI must perform the transfer.
  let result;try{
   result=warpPlayer(session,{...real.position},{
    minimumRange:2500,targetEntityID:loss.haulerNativeWreckID});
  }catch{return {status:"RESCUE_NATIVE_WARP_FAILED"}}
  if(result!==true&&result?.success!==true)
   return {status:"RESCUE_NATIVE_WARP_NOT_ACKNOWLEDGED"};
  cooldown.set(key,now);
  if(cooldown.size>256)cooldown.delete(cooldown.keys().next().value);
  return {status:"RESCUE_NATIVE_WARP_ACKNOWLEDGED",
   wreckID:loss.haulerNativeWreckID,sourceCargoIDs:surviving.map(x=>x.sourceCargoID),
   survivingQuantity:surviving.reduce((n,x)=>n+x.quantity,0),
   inventoryTransferVerified:false,rewardISK:0};
 }
 return {navigate};
}
let singleton;
function rescueInGame(session,eventID){
 if(process.env.EVEJS_COOP_ESCORT_RESCUE_NAV!=="1")
  return {status:"DISABLED"};
 try{
  if(!singleton){
   const board=require("./coopWorldOpportunityBoard");
   const store=require("./npc/nativeNpcStore");
   const runtime=require("./runtime");
   const root=process.env.EVEJS_COOP_NPC_WAREHOUSE_DIR||
    "/var/lib/evejs/coop-native-warehouse";
   const manifest=require("./coopNativeHaulManifest").createManifest({
    root,store,items:require("../services/inventory/itemStore"),
    getNativeEntity:store.getNativeEntity});
   singleton=createRescueNavigation({
    readEvent:id=>board.readNativeEvent(id),
    readFlight:key=>require("./coopEscortNativeBinding").routeGate().readFlight(key),
    readManifest:key=>manifest.read(key),
    readOutcomes:()=>require("./coopConvoyOutcomeProof").createOutcomes().snapshot(),
    getWreck:store.getNativeWreck,
    getWreckItems:store.listNativeWreckItemsForWreck,
    getScene:s=>runtime.getSceneForSession(s),
    warpPlayer:(s,point,opts)=>runtime.warpToPoint(s,point,opts),
    readVolunteer:id=>require("./coopEscortVolunteers").readVerifiedNativePair(id)
   });
  }
  return singleton.navigate(session,eventID);
 }catch{return {status:"RESCUE_NAVIGATION_SOURCE_UNAVAILABLE"}}
}
module.exports={createRescueNavigation,rescueInGame};
