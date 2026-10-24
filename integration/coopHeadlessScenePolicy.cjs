"use strict";
// Headless EveJS readiness policy. A loaded native scene without NPCs must
// still be visited by later 30-second world ticks and periodic reconciliation.
// This never fabricates belts, native controllers or successful NPC movement.
const id=value=>{
 const n=Number(value);return Number.isSafeInteger(n)&&n>0?n:null;
};
function shouldTrackNativeScene({systemID,scene,realWaypointCount}={}){
 return Boolean(id(systemID)&&id(scene?.systemID)===id(systemID)&&
  typeof scene?.getEntityByID==="function"&&
  Array.isArray(scene?.staticEntities)&&
  Number.isSafeInteger(realWaypointCount)&&realWaypointCount>0);
}
function nativeMiningStartupPolicy({systemID,sdeBelts=0,sceneBelts=0,
 environment=process.env}={}){
 const system=id(systemID);
 if(!system)return {status:"INVALID_SYSTEM",configuredForSystem:false};
 const enabled=environment.EVEJS_MINING_NPC_STARTUP_ENABLED;
 const configured=enabled==="1"||String(enabled).toLowerCase()==="true";
 const raw=String(environment.EVEJS_MINING_NPC_STARTUP_SYSTEM_IDS||"").trim();
 const systems=raw?raw.split(",").map(x=>id(x.trim())).filter(Boolean):[];
 const included=systems.length===0||systems.includes(system);
 const cfg={configuredForSystem:configured&&included,
  startupEnabled:configured,
  startupSystemIncluded:included,
  startupSystemSelection:raw?"EXPLICIT":"DEFAULT"};
 if(!configured)return {...cfg,status:"NATIVE_MINING_STARTUP_DISABLED"};
 if(!included)return {...cfg,status:"NATIVE_MINING_STARTUP_EXCLUDES_SYSTEM"};
 if(!Number.isInteger(sdeBelts)||sdeBelts<0)
  return {...cfg,status:"INVALID_SDE_BELT_COUNT"};
 if(sdeBelts===0)return {...cfg,status:"SYSTEM_HAS_NO_SDE_BELTS"};
 if(!Number.isInteger(sceneBelts)||sceneBelts<1)
  return {...cfg,status:"SYSTEM_SDE_BELTS_NOT_IN_SCENE"};
 return {...cfg,status:"MINING_STARTUP_ELIGIBLE"};
}
module.exports={shouldTrackNativeScene,nativeMiningStartupPolicy};
