"use strict";
// FW-009B physical observation seam. Missing/incomplete scene enumeration
// is UNKNOWN, never "zero defenders". It cannot create an objective or
// determine which actor dealt lethal structure damage.
const POS=x=>Number.isSafeInteger(x)&&x>0;
const VEC=x=>x&&["x","y","z"].every(k=>Number.isFinite(x[k]));
const RANGE=20000;
// Confirmed against the pinned SolarSystemScene: dynamicEntities is Map,
// staticEntities is Array. A scene missing either collection is NOT
// complete, and any active player ship missing from that map is unsafe.
function listPinnedSceneShips(scene){
 if(!(scene?.dynamicEntities instanceof Map)||
  !Array.isArray(scene.staticEntities)||
  typeof scene.getEntityByID!=="function")
  return {complete:false,ships:[]};
 const ships=[...scene.dynamicEntities.values(),...scene.staticEntities]
  .filter(e=>e?.kind==="ship");
 const ids=new Set();
 for(const ship of ships){
  if(!POS(ship?.itemID)||ids.has(ship.itemID)||
   scene.getEntityByID(ship.itemID)!==ship)
   return {complete:false,ships:[]};
  ids.add(ship.itemID);
 }
 const sessions=scene.sessions;
 if(sessions&&typeof sessions.values==="function"){
  for(const session of sessions.values()){
   const shipID=Number(session?._space?.shipID);
   if(POS(shipID)&&!ids.has(shipID))
    return {complete:false,ships:[]};
  }
 }
 return {complete:true,ships};
}

function createNativeStructureControlWitness({sceneForSystem,
 listAllPhysicalShips,getNativeEntity,getController,
 getFactionForCorporation,rangeM=RANGE}={}){
 if([sceneForSystem,listAllPhysicalShips,getNativeEntity,getController,
  getFactionForCorporation].some(fn=>typeof fn!=="function")||
  !Number.isSafeInteger(rangeM)||rangeM<5000||rangeM>50000)
  throw Error("FW_STRUCTURE_CONTROL_NATIVE_AUTHORITIES_REQUIRED");
 function observe({systemID,position,warID,campaignID,
  attackerFactionID,defenderFactionID,fleetState}={}){
  const unknown=reason=>({status:"NATIVE_CONTROL_UNKNOWN",reason});
  if(!POS(systemID)||!VEC(position)||!POS(attackerFactionID)||
   !POS(defenderFactionID)||attackerFactionID===defenderFactionID||
   typeof warID!=="string"||typeof campaignID!=="string"||
   !fleetState?.ships)return unknown("INVALID_OBJECTIVE");
  let scene,all;
  try{
   scene=sceneForSystem(systemID);
   all=scene&&listAllPhysicalShips(scene);
  }catch{return unknown("PHYSICAL_SCENE_UNAVAILABLE")}
  if(scene?.systemID!==systemID||typeof scene.getEntityByID!=="function"||
   all?.complete!==true||!Array.isArray(all.ships)||all.ships.length>4096)
   return unknown("INCOMPLETE_SCENE_ENUMERATION");
  const seen=new Set();let attackerCount=0,defenderCount=0;
  for(const ship of all.ships){
   const id=ship?.itemID;
   if(!POS(id)||seen.has(id)||!VEC(ship.position)||
    ship.kind!=="ship"||scene.getEntityByID(id)!==ship)
    return unknown("UNVERIFIED_PHYSICAL_ENTITY");
   seen.add(id);
   const d=Math.hypot(ship.position.x-position.x,
    ship.position.y-position.y,ship.position.z-position.z);
   if(!Number.isFinite(d))return unknown("INVALID_DISTANCE");
   if(d>rangeM)continue;
   // Unknown or player ships in a siege radius are contested until
   // proper militia-character identity/consent witnesses exist.
   if(ship.nativeNpc!==true||ship.session?.characterID){
    defenderCount++;continue;
   }
   const assignment=fleetState.ships[String(id)];
   if(!assignment||assignment.systemID!==systemID||
    assignment.entityID!==id||assignment.campaignID!==campaignID||
    assignment.warID!==warID||!POS(assignment.corporationID)||
    !POS(assignment.factionID)){
    defenderCount++;continue;
   }
   let native,controller,faction;
   try{
    native=getNativeEntity(id);controller=getController(id);
    faction=getFactionForCorporation(assignment.corporationID);
   }catch{return unknown("NATIVE_CORPORATION_OR_CONTROLLER_UNAVAILABLE")}
   if(native?.entityID!==id||native.systemID!==systemID||
    native.corporationID!==assignment.corporationID||
    controller?.entityID!==id||controller.systemID!==systemID||
    faction!==assignment.factionID||
    ship.corporationID!==assignment.corporationID||
    ship.pendingWarp||ship.warpState||ship.isWarping)
    return unknown("NATIVE_SHIP_OR_ORDER_DRIFT");
   if(faction===attackerFactionID)attackerCount++;
   else defenderCount++;
  }
  return {status:attackerCount>0&&defenderCount===0?
   "UNCONTESTED_NATIVE_ATTACKER":"CONTESTED_NATIVE_OBJECTIVE",
   systemID,attackerFactionID,defenderFactionID,
   attackerCount,defenderCount,physicalProof:true};
 }
 return Object.freeze({observe});
}
module.exports={createNativeStructureControlWitness,listPinnedSceneShips};
