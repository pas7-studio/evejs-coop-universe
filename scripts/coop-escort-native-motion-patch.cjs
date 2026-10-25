"use strict";
// Reversible pinned upstream hook: called AFTER native NPC has received its
// actual warp ingress position, never before physical movement or for clones.
const ANCHOR="    ingressState.lastUpdateAtMs = now;";
const HOOK='    if (process.env.EVEJS_COOP_ESCORT_NATIVE_WARP_OBSERVER === "1" && entity.nativeNpc === true) { try { require("../../coopNativeStationArrival").noteNativeMotion(entity, now); } catch (_) { /* witness unavailable: payout fails closed */ } }';
const count=(s,x)=>s.split(x).length-1;
function patch(text,{remove=false}={}){
 if(typeof text!=="string")throw Error("NATIVE_WARP_SOURCE_REQUIRED");
 const nl=text.includes("\r\n")?"\r\n":"\n";
 if(remove){
  if(count(text,HOOK)>1)throw Error("DUPLICATE_NATIVE_ESCORT_MOTION_HOOK");
  return count(text,HOOK)===1?text.replace(HOOK+nl,""):text;
 }
 if(count(text,HOOK)===1)return text;
 if(count(text,HOOK)>1||count(text,ANCHOR)!==1)
  throw Error("NATIVE_WARP_INGRESS_PINNED_ANCHOR_MISMATCH");
 return text.replace(ANCHOR,ANCHOR+nl+HOOK);
}
module.exports={patch,ANCHOR,HOOK};
