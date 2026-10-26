"use strict";
// CH24+31 D1: the existing stock agentMgr bound dialogue, AFTER native paid
// convoy and faction hooks have had priority; before original stock mission.
// Only opt-in and no stock mission for the selected authentic character.
const FILE="server/src/services/agent/agentMgrService.js";
const ACTION='  const actionID = args && args.length > 0 ? args[0] : null;';
const BRIEF='  Handle_GetMissionBriefingInfo(args, session) {';
const ACTION_HOOK='    if (process.env.EVEJS_COOP_PLAYER_NPC_MINING_AGENT === "1") { const mining=require("../../space/coopPlayerMiningAgent").doAction({session,agentID,actionID}); if(mining) return buildDoActionResponsePayload(mining); }';
const BRIEF_HOOK='    if (process.env.EVEJS_COOP_PLAYER_NPC_MINING_AGENT === "1") { const mining=require("../../space/coopPlayerMiningAgent").briefing({session,agentID:this._resolveBoundAgentID(session)}); if(mining) return toMarshalSafe(mining); }';
function patch(text,remove=false){
 const eol=text.includes("\r\n")?"\r\n":"\n";
 const count=s=>text.split(s).length-1;
 if(remove){
  for(const hook of [ACTION_HOOK,BRIEF_HOOK]){
   if(count(hook)>1)throw Error("MINING_AGENT_DUPLICATED_HOOK");
   if(count(hook)===1)text=text.replace(hook+eol,"");
  }
  return text;
 }
 if(count(ACTION_HOOK)===1&&count(BRIEF_HOOK)===1)return text;
 if(count(ACTION_HOOK)||count(BRIEF_HOOK)||count(ACTION)!==1||
   count(BRIEF)!==1||!text.includes("buildDoActionResponsePayload"))
  throw Error("MINING_AGENT_PINNED_SOURCE_DRIFT");
 const job='  if (process.env.EVEJS_COOP_NATIVE_JOB_AGENT === "1")';
 const faction='EVEJS_COOP_FACTION_WAR_AGENT';
 if(!text.includes(job)||!text.includes(faction))
  throw Error("MINING_AGENT_EXISTING_IN_GAME_PRIORITY_REQUIRED");
 // Insert immediately before native decline logic, but AFTER the already
 // inserted escort + faction agent hooks in the complete overlay transform.
 const next='    if (Number(actionID) === agentMissionRuntime.AGENT_DIALOGUE_BUTTON_DECLINE) {';
 if(count(next)!==1||count(job)!==2)throw Error("MINING_AGENT_ACTION_PRIORITY_ANCHOR_MISMATCH");
 text=text.replace(next,ACTION_HOOK+eol+next);
 text=text.replace(BRIEF,BRIEF+eol+BRIEF_HOOK+eol);
 return text;
}
module.exports={patch,FILE,ACTION_HOOK,BRIEF_HOOK};
