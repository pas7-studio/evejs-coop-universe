"use strict";
// Single default-OFF native L1 insertion. Never wraps or replaces stock
// offerMission(), Accept, mission selection, agent dialogue, or rewards.
const FILE="server/src/services/agent/agentMissionRuntime.js";
const ANCHOR="    const offerResult = offerMission(normalizedCharacterID, agentRecord);";
const HOOK='    if (process.env.EVEJS_COOP_MISSION_JOIN === "1") require("../../space/coopFleetMissionJoin").offer({characterID:normalizedCharacterID,agentRecord,fleetRuntime:require("../fleets/fleetRuntime"),sessions:sessionRegistry.getSessions(),getMissionRecord,getClientMissionRecord,offerSpecificMission,getDockedLocationID:require("../structure/structureLocation").getDockedLocationID,isMissionOfferAllowedForAgent,canUseAgent,getReplayUntilFileTime,resolveReplayRemainingTicks});';
const count=(s,v)=>s.split(v).length-1;
function patch(source,file,remove=false){
 if(file!==FILE)return source;
 let text=String(source);
 const eol=text.includes("\r\n")?"\r\n":"\n";
 const inserted=HOOK+eol+ANCHOR;
 if(remove){
  if(count(text,HOOK)===0)return text;
  if(count(text,inserted)!==1)throw Error("UNKNOWN_NATIVE_MISSION_JOIN_PATCH");
  return text.replace(inserted,ANCHOR);
 }
 if(count(text,inserted)===1)return text;
 if(count(text,HOOK)||count(text,ANCHOR)!==1)
  throw Error("UNKNOWN_PINNED_NATIVE_MISSION_OFFER_ANCHOR");
 return text.replace(ANCHOR,inserted);
}
module.exports={patch,FILE,ANCHOR,HOOK};
