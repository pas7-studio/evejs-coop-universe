"use strict";
// Native order guard: exact named pilot+physical hull+controller proof.
// Deliberately no hardcoded EveJS access or global singleton in this module.
const pos = x => Number.isSafeInteger(Number(x)) && Number(x)>0 ? Number(x) : null;
const named = x => typeof x === "string" && /^coop-pilot-[0-9]{3,}$/.test(x);
function createOrderBridge({arbiter, assignments, sceneForSystem, getController}={}) {
 if(!arbiter?.issue || !arbiter?.blocksForSystem || !arbiter?.blocked ||
    [assignments,sceneForSystem,getController].some(x=>typeof x!=="function"))
   throw Error("NATIVE_ORDER_BRIDGE_DEPENDENCIES");
 function uniqueAssignment(entityID,requestedSystemID=null) {
  if(!pos(entityID))return null;
  let raw;
  try{raw=assignments();}catch(_error){return null;}
  if(!Array.isArray(raw))return null;
  const all=raw.filter(x=>named(x?.pilotID)&&pos(x?.entityID)&&pos(x?.systemID));
  // Disagreeing registry and bridge links, or a single pilot linked to two
  // native ships, are ambiguous: do not issue an order.
  const matching=all.filter(x=>Number(x.entityID)===Number(entityID));
  if(!matching.length)return null;
  const signatures=new Set(matching.map(x=>x.pilotID+":"+x.systemID+":"+x.entityID));
  if(signatures.size!==1)return null;
  const link=matching[0];
  if(requestedSystemID!=null && Number(requestedSystemID)!==Number(link.systemID))return null;
  if(all.some(x=>x.pilotID===link.pilotID&&
    (Number(x.entityID)!==Number(link.entityID)||Number(x.systemID)!==Number(link.systemID))))return null;
  return {pilotID:link.pilotID,entityID:Number(link.entityID),systemID:Number(link.systemID)};
 }
 function verify(link,owner){
  const scene=sceneForSystem(link.systemID);
  if(Number(scene?.systemID)!==link.systemID)return false;
  const entity=scene?.getEntityByID?.(link.entityID);
  if(entity?.kind!=="ship"||entity.nativeNpc!==true||entity.session?.characterID)return false;
  const controller=getController(link.entityID);
  if(["PATROL","CIVILIAN","GATE"].includes(owner)&&
    (Number(controller?.currentTargetID)>0 || controller?.manualOrder?.type==="attack"))
   return false;
  return Number(controller?.entityID)===link.entityID &&
   Number(controller?.systemID)===link.systemID &&
   uniqueAssignment(link.entityID,link.systemID)?.pilotID===link.pilotID;
 }
 function issue({entityID,systemID,owner,action,execute,holdMs}={}){
  const link=uniqueAssignment(entityID,systemID);
  if(!link)return {success:false,errorMsg:"COOP_NPC_ORDER_IDENTITY_UNVERIFIED"};
  return arbiter.issue({...link,owner,action,execute,holdMs,verify:()=>verify(link,owner)});
 }
 function blocked({entityID,systemID,owner}={}){
  const link=uniqueAssignment(entityID,systemID);
  return !link||arbiter.blocked({...link,owner});
 }
 function blocksForSystem(systemID,owner){return arbiter.blocksForSystem(systemID,owner);}
 function snapshot(){return arbiter.snapshot();}
 return {issue,blocked,blocksForSystem,snapshot};
}
module.exports={createOrderBridge};
