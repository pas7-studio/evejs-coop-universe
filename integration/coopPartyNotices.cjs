"use strict";
// Small, in-game rendezvous acknowledgement for two authenticated pilots.
// Actual ships/sessions are verified by coopDuoCoordinator before this call;
// the notice does not create ships, fleets, chat users or warp orders.
const pos=v=>Number.isSafeInteger(Number(v))&&Number(v)>0?Number(v):null;
function createNotices({clock=()=>Date.now(),cooldownMs=300000,
 send=(session,message)=>require("../services/chat/chatHub").sendSystemMessage(session,message)}={}){
 if(typeof clock!=="function"||typeof send!=="function"||
  !Number.isSafeInteger(cooldownMs)||cooldownMs<30000)
  throw Error("invalid duo notice options");
 const last=new Map();
 function rendezvous({scene,party,systemID}={}){
  const pilots=party?.pilots;
  if(!Array.isArray(pilots)||pilots.length!==2||
   !scene||Number(scene.systemID)!==Number(systemID)||
   !Number.isFinite(party.separation)||party.separation<0||
   party.separation>250000)return {status:"NOT_TWO_READY_NATIVE_PILOTS",sent:0};
  const ids=pilots.map(p=>pos(p?.characterID));
  if(ids.some(id=>!id)||ids[0]===ids[1])
   return {status:"INVALID_PARTY",sent:0};
  if(pilots.some(p=>!pos(p?.shipID)||p.session?._space?.initialStateSent!==true||
   Number(p.session?._space?.systemID)!==Number(systemID)||
   scene.getEntityByID?.(p.shipID)!==p.ship||
   ![...scene.sessions?.values?.()||[]].includes(p.session)))
   return {status:"NOT_NATIVE_SCENE_MEMBERS",sent:0};
  const key=systemID+":"+ids.sort((a,b)=>a-b).join(":");
  const now=clock();
  if(!Number.isFinite(now))return {status:"CLOCK_INVALID",sent:0};
  if(last.has(key)&&now-last.get(key)<cooldownMs)
   return {status:"COOLDOWN",sent:0};
  const distance=Math.round(party.separation/1000);
  const msg="[Co-op] Rendezvous: both ships are nearby ("+distance+
   " km apart). Form an EVE fleet to warp together; check Perimeter belts for real mining convoys and pirate activity.";
  let sent=0;
  for(const p of pilots){
   if(p.session?.socket?.destroyed===true)continue;
   try{send(p.session,msg);sent++;}catch(error){
    console.warn("[CoopPartyNotices] chat",String(error?.message||error).slice(0,90));
   }
  }
  if(sent)last.set(key,now);
  if(last.size>500)for(const [id,time] of last)if(now-time>cooldownMs)last.delete(id);
  return {status:sent===2?"SENT":"PARTIAL",sent,systemID,
   characterIDs:ids,separationMeters:party.separation};
 }
 return {rendezvous};
}
module.exports={createNotices};
