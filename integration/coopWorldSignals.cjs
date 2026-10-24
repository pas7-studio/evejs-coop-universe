"use strict";
// Share *real* local disturbances with connected pilots via EveJS chat.
// Does not impersonate an NPC chat character or invent combat outcomes.
function notifyRaid(scene,actions=[],send){
 const events=(actions||[]).filter(a=>a?.action==="attack"||a?.action==="warp-to-hauler");
 if(!events.length||!scene?.sessions?.values)return {sent:0};
 const deliver=send||((session,message)=>require("../services/chat/chatHub").sendSystemMessage(session,message));
 let sent=0;
 for(const session of scene.sessions.values()){
  if(!session?.characterID||session?._space?.initialStateSent!==true)continue;
  try{
   const role=events[0].targetRole==="hauler"?"ore transport":"mining vessel";
   const target=scene.getEntityByID?.(Number(events[0].targetID));
   const {nearest}=require("./coopSystemIntel");
   const waypoint=nearest(scene,target);
   const location=waypoint?" near "+waypoint.name.replace(/[<>]/g,"").slice(0,60):" in this system";
   const text=events[0].action==="attack"
     ?"[Living Universe] NPC pirate engaging an "+role+location+". You can help the convoy or join the raid."
     :"[Living Universe] Pirate approaching a loaded "+role+location+". Investigate or escort it.";
   deliver(session,text);sent++;
  }catch(error){console.warn("[CoopWorldSignals] Local notification",error.message);}
 }
 return {sent};
}
module.exports={notifyRaid};
