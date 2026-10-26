"use strict";
// FW-007A: stage already-funded physical warships at REAL reciprocal gates.
// Reuses the existing NPC gate director and shared WAR arbiter. There is NO
// native cross-system transfer: custody is never inferred from gate arrival.
const {createGateTravel}=require("./coopNpcGateTravel"+
 (__filename.endsWith(".js")?"":".cjs"));
const pos=x=>Number.isSafeInteger(x)&&x>0;
const gate=env=>env.EVEJS_COOP_FACTION_WAR==="1"&&
 env.EVEJS_COOP_FACTION_WAR_FLEETS==="1"&&
 env.EVEJS_COOP_WAR_TREASURY==="1"&&
 env.EVEJS_COOP_FACTION_WAR_GATE_APPROACH==="1"&&
 env.EVEJS_COOP_NATIVE_ATOMIC_ROWS==="1"&&
 (env.EVEJS_COOP_ALIFE==="1"||env.EVEJS_COOP_NPC_ORDER_ARBITER==="1");
function createWarGateStaging({readWar,readFleet,readTreasury,
 sceneForSystem,getGate,warpToEntity,getController,bridge,
 isTactical=()=>false,isAmmoRetreat=()=>false,
 clock=()=>Date.now(),env=process.env,maxOrders=1}={}){
 if([readWar,readFleet,readTreasury,sceneForSystem,getGate,
  warpToEntity,getController,isTactical,isAmmoRetreat,clock]
  .some(x=>typeof x!=="function")||typeof bridge?.issue!=="function"||
  !Number.isSafeInteger(maxOrders)||maxOrders<1||maxOrders>3)
  throw Error("WAR_NATIVE_GATE_AUTHORITIES_REQUIRED");
 const travel=createGateTravel({getGate,clock,maxShipsPerTick:maxOrders,
  warp:(id,gateID,options)=>{
   let controller;
   try{controller=getController(id)}catch{
    return {success:false,errorMsg:"WAR_GATE_CONTROLLER_UNAVAILABLE"}}
   const systemID=controller?.systemID;
   if(!pos(systemID)||isTactical(id)||isAmmoRetreat(systemID,id))
    return {success:false,errorMsg:"WAR_GATE_SHIP_UNAVAILABLE"};
   return bridge.issue({entityID:id,systemID,owner:"WAR",
    action:"warp-to-gate",execute:()=>warpToEntity(id,gateID,options)});
  },
  // Native transfer is intentionally absent: warship systemID cannot be
  // changed without an atomic update to TWO native durable registries.
  transfer:null});
 function tick({systemIDs=[]}={}){
  if(!gate(env))return {status:"DISABLED",orders:[],observations:[]};
  if(!Array.isArray(systemIDs)||systemIDs.length>20||
   systemIDs.some(x=>!pos(x)))return {status:"INVALID_SYSTEMS",orders:[],observations:[]};
  let war,fleet,treasury;
  try{war=readWar();fleet=readFleet();treasury=readTreasury()}
  catch{return {status:"NATIVE_STATE_UNAVAILABLE",orders:[],observations:[]}}
  if(war?.version!==1||fleet?.version!==1||treasury?.version!==1||
   !war.campaigns||!war.wars||!fleet.ships||!treasury.reservations)
   return {status:"WAR_NATIVE_STATE_INVALID",orders:[],observations:[]};
  const accepted=new Set(systemIDs),orders=[],observations=[];
  // Funding alone is not supply. A campaign must ALREADY have passed the
  // independent native supply/route verification in FW-001 START_CAMPAIGN.
  for(const campaign of Object.values(war.campaigns)
   .filter(c=>c?.state==="PREPARING"&&pos(c.sourceSystemID)&&
    pos(c.targetSystemID)&&accepted.has(c.sourceSystemID))
   .sort((a,b)=>a.campaignID.localeCompare(b.campaignID)).slice(0,12)){
   if(orders.length>=maxOrders)break;
   const w=war.wars[campaign.warID],reserve=treasury.reservations[campaign.supplyReservationID];
   if(w?.state!=="ACTIVE"||!pos(w.attackerFactionID)||
    reserve?.status!=="HELD"||reserve.warID!==campaign.warID||
    reserve.campaignID!==campaign.campaignID||
    reserve.factionID!==w.attackerFactionID||!pos(reserve.cents))
    continue;
   let scene;
   try{scene=sceneForSystem(campaign.sourceSystemID)}catch{continue}
   if(scene?.systemID!==campaign.sourceSystemID)continue;
   const assignments=Object.values(fleet.ships).filter(s=>
    s?.campaignID===campaign.campaignID&&s.warID===campaign.warID&&
    s.factionID===w.attackerFactionID&&
    s.systemID===campaign.sourceSystemID&&pos(s.entityID)&&
    typeof s.pilotID==="string"&&/^coop-pilot-[0-9]{3,}$/.test(s.pilotID))
    .slice(0,8).map(s=>({...s,role:"patrol"}));
   if(!assignments.length)continue;
   const blocked=new Set();
   for(const a of assignments)try{
    if(isTactical(a.entityID)||isAmmoRetreat(a.systemID,a.entityID))
     blocked.add(a.entityID)
   }catch{blocked.add(a.entityID)}
   const output=travel.tick({
    systemID:campaign.sourceSystemID,scene,assignments,
    route:[campaign.sourceSystemID,campaign.targetSystemID],
    getController,blockedIDs:blocked
   });
   // A gate-warp result does not change native ship location, fleet
   // registry, cargo, SDE faction, war objective or player's wallet.
   for(const o of output.orders){
    if(orders.length>=maxOrders)break;
    if(o.action==="NATIVE_WARP_TO_REAL_GATE")
     orders.push({...o,campaignID:campaign.campaignID,
      phase:"STAGING_ONLY_NOT_TRANSFER"});
   }
   for(const o of output.observations.slice(0,8))
    observations.push({...o,campaignID:campaign.campaignID,
     phase:"AWAITING_NATIVE_WAR_FLEET_TRANSFER"});
  }
  return {status:"OBSERVED",orders,observations:observations.slice(0,16)};
 }
 return Object.freeze({tick,activeIDs:travel.activeIDs});
}
module.exports={createWarGateStaging,gate};
