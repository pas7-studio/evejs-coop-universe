"use strict";
// COOP-049: reversible, minimal pinned native agentMgr hooks.
// No raw client ID, free mission record, native item or wallet changes.
const ACTION='  const actionID = args && args.length > 0 ? args[0] : null;';
const BRIEF='  Handle_GetMissionBriefingInfo(args, session) {';
const ACTION_HOOK='  if (process.env.EVEJS_COOP_NATIVE_JOB_AGENT === "1") { const job=require("../../space/coopNativeJobAgent").doAction({session,agentID,actionID}); if (job) return buildDoActionResponsePayload(job); }';
const BRIEF_HOOK='    if (process.env.EVEJS_COOP_NATIVE_JOB_AGENT === "1") { const job=require("../../space/coopNativeJobAgent").briefing({session,agentID:this._resolveBoundAgentID(session)}); if (job) return toMarshalSafe(job); }';
const count=(text,part)=>text.split(part).length-1;
function patch(text,{remove=false}={}){
 const eol=text.includes("\r\n")?"\r\n":"\n";
 if(remove){
  for(const hook of [ACTION_HOOK,BRIEF_HOOK]){
   if(count(text,hook)>1)throw Error("DUPLICATE_NATIVE_JOB_AGENT_HOOK");
   if(count(text,hook)===1)text=text.replace(hook+eol,"");
  }
  return text;
 }
 for(const [anchor,hook] of [[ACTION,ACTION_HOOK],[BRIEF,BRIEF_HOOK]]){
  if(count(text,hook)===1)continue;
  if(count(text,hook)>1||count(text,anchor)!==1)
   throw Error("NATIVE_JOB_AGENT_PINNED_ANCHOR_MISMATCH");
  text=text.replace(anchor,anchor+eol+hook);
 }
 return text;
}
module.exports={patch,ACTION_HOOK,BRIEF_HOOK};