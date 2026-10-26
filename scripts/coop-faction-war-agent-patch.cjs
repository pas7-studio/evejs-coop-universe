"use strict";
// FW-002 native AgentMgr hook, idempotent and reversible; no extra transport.
const ACTION='  const actionID = args && args.length > 0 ? args[0] : null;';
const BRIEF='  Handle_GetMissionBriefingInfo(args, session) {';
const ACTION_HOOK='  if (process.env.EVEJS_COOP_FACTION_MILITIA_AGENT === "1") { const militia=require("../../space/coopFactionWarAgent").doAction({session,agentID,actionID}); if (militia) return buildDoActionResponsePayload(militia); }';
const BRIEF_HOOK='    if (process.env.EVEJS_COOP_FACTION_MILITIA_AGENT === "1") { const militia=require("../../space/coopFactionWarAgent").briefing({session,agentID:this._resolveBoundAgentID(session)}); if (militia) return toMarshalSafe(militia); }';
const count=(text,needle)=>text.split(needle).length-1;
function patch(text,{remove=false}={}){
 const eol=text.includes("\r\n")?"\r\n":"\n";
 for(const [anchor,hook] of [[ACTION,ACTION_HOOK],[BRIEF,BRIEF_HOOK]]){
  const present=count(text,hook);
  if(present>1)throw Error("FW_AGENT_DUPLICATE_HOOK");
  if(remove){if(present===1)text=text.replace(hook+eol,"");continue;}
  if(present===1)continue;
  if(count(text,anchor)!==1)throw Error("FW_AGENT_PINNED_ANCHOR_MISMATCH");
  text=text.replace(anchor,anchor+eol+hook);
 }
 return text;
}
module.exports={patch,ACTION_HOOK,BRIEF_HOOK};
