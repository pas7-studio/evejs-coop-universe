"use strict";
// Read-only evidence from the actual shared EveJS solar-system scene.
// "Same system" and "reciprocal visibility" are separate observations.
function positive(v){const n=Number(v);return Number.isSafeInteger(n)&&n>0?n:null;}
function snapshot(scene){
 if(!scene?.sessions||typeof scene.sessions.values!=="function")return {status:"NO_SCENE",pilots:[]};
 const pilots=[...scene.sessions.values()].filter(s=>s?.characterID&&s?._space?.shipID).map(s=>({
  characterID:positive(s.characterID),
  shipID:positive(s._space.shipID),
  shipExists:Boolean(scene.getEntityByID?.(positive(s._space.shipID))),
  visibleEntityIDs:s._space.visibleDynamicEntityIDs instanceof Set?s._space.visibleDynamicEntityIDs:null
 })).filter(p=>p.characterID&&p.shipID);
 const byIdentity=new Map(pilots.map(p=>[p.characterID,p]));
 const rows=[...byIdentity.values()].map(p=>({
  characterID:p.characterID,shipID:p.shipID,shipExists:p.shipExists,
  // null means no authoritative visibility set; do not fabricate a PASS.
  visiblePeerIDs:[...byIdentity.values()].filter(other=>other.characterID!==p.characterID&&p.visibleEntityIDs?.has(other.shipID)).map(other=>other.characterID),
  visibilityKnown:p.visibleEntityIDs instanceof Set
 }));
 const shared=rows.length>=2&&rows.every(p=>p.shipExists);
 const mutual=rows.length===2&&rows.every(p=>p.visiblePeerIDs.length===1);
 return {status:shared?"TWO_PILOTS_IN_SCENE":rows.length===1?"ONE_PILOT":"NOT_READY",pilots:rows,mutualVisibility:mutual};
}
function observe(session,ship,reason="presence"){
 try{
  const scene=require("./runtime").getSceneForSession(session);
  const state=snapshot(scene);
  require("./coopRuntimeProbe").observe("coop-shared-scene",session,ship,{reason,...state});
  return state;
 }catch(error){console.warn("[CoopDuoPresence]",error.message);return {status:"ERROR"};}
}
module.exports={snapshot,observe};
