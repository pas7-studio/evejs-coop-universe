"use strict";
// NPCs physically respond to real source-proven wrecks; no invented loot,
// no auto-teleport, no station credit and no fake rescue payout.
const pos=n=>Number.isSafeInteger(n)&&n>0;
const vector=p=>p&&["x","y","z"].every(k=>Number.isFinite(p[k]));
const dist=(a,b)=>Math.hypot(a.x-b.x,a.y-b.y,a.z-b.z);
function createNpcSalvageDispatch({readSalvageProof,getScene,
 getController,warpNative,orbitNative,clock=()=>Date.now()}={}){
 if([readSalvageProof,getScene,getController,warpNative,orbitNative,clock]
  .some(x=>typeof x!=="function"))throw Error("SALVAGE_NPC_NATIVE_MOVEMENT_REQUIRED");
 const next=new Map();
 function dispatch({manifestKey,systemID,salvagerID,wreckID}={}){
  if(process.env.EVEJS_COOP_SALVAGE_NPC_DISPATCH!=="1")
   return {status:"DISABLED"};
  if(!/^\d+-\d+-\d+$/.test(String(manifestKey))||
   ![systemID,salvagerID,wreckID].every(pos))
   return {status:"SALVAGE_NPC_DISPATCH_INVALID"};
  let proof,scene,controller;
  try{proof=readSalvageProof(manifestKey);
   scene=getScene(systemID);controller=getController(salvagerID)}
  catch{return {status:"SALVAGE_NPC_SOURCE_UNAVAILABLE"}}
  if(proof?.status!=="SALVAGE_ORIGIN_VERIFIED"||
   proof.wreckID!==wreckID||!Array.isArray(proof.rows)||!proof.rows.length)
   return {status:"SALVAGE_NPC_UNVERIFIED_WRECK"};
  const ship=scene?.getEntityByID?.(salvagerID);
  const wreck=scene?.getEntityByID?.(wreckID);
  if(scene?.systemID!==systemID||ship?.itemID!==salvagerID||
   ship.kind!=="ship"||ship.nativeNpc!==true||
   ship.session?.characterID||!vector(ship.position)||
   wreck?.itemID!==wreckID||wreck.nativeNpcWreck!==true||
   !vector(wreck.position)||controller?.entityID!==salvagerID||
   controller.systemID!==systemID||controller.currentTargetID>0||
   controller.manualOrder?.type==="attack"||
   String(ship.mode||"").includes("WARP"))
   return {status:"SALVAGE_NPC_NOT_SAFE_FOR_DISPATCH"};
  const now=clock(),k=systemID+":"+salvagerID;
  if(!pos(now)||next.get(k)>now)
   return {status:"SALVAGE_NPC_COOLDOWN"};
  const meters=dist(ship.position,wreck.position);
  if(meters<=2200)return {status:"SALVAGE_NPC_AT_NATIVE_WRECK",
   entityID:salvagerID,wreckID,lootTransferred:false};
  let ack;
  try{ack=meters>250000?warpNative(salvagerID,wreck.position,
   {targetEntityID:wreckID}):orbitNative(salvagerID,wreckID,1400)}
  catch{return {status:"SALVAGE_NPC_MOVEMENT_UNAVAILABLE"}}
  if(ack?.success!==true)
   return {status:"SALVAGE_NPC_MOVEMENT_DENIED"};
  next.set(k,now+60000);
  if(next.size>128)next.delete(next.keys().next().value);
  return {status:meters>250000?"SALVAGE_NPC_WARP_ORDERED":
   "SALVAGE_NPC_ORBIT_ORDERED",entityID:salvagerID,
   wreckID,lootTransferred:false,paid:false};
 }
 return {dispatch};
}
module.exports={createNpcSalvageDispatch};
