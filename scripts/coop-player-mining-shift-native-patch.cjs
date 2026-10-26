"use strict";
// Single guarded native hook at the pinned stock mining fleet think boundary.
// Only touches miningNpcOperations.js; the whole original mining engine remains
// responsible for laser effects, native cargo, hauling, warp and retreat.
const TARGET="server/src/services/mining/miningNpcOperations.js";
const ANCHOR="  const thinkIntervalMs = Math.max(";
const HOOK='  if (process.env.EVEJS_COOP_PLAYER_NPC_MINING_COMPANY === "1" && require("../../space/coopPlayerMiningFleetTick").beforeTick({scene,fleetRecord,now,hooks,startHaul:()=>startHaulCycle(scene,fleetRecord,now,hooks),deactivate:()=>deactivateMiningModulesForFleet(scene,fleetRecord,hooks,"player-mining-shift"),retreat:()=>retreatFleetToOrigin(fleetRecord,{state:"retreating",scene,hooks,reason:"player-mining-shift"})})===true) return;';
function patch(source,filename=TARGET,remove=false){
 if(filename!==TARGET)throw Error("MINING_SHIFT_UNSUPPORTED_NATIVE_SOURCE");
 const eol=source.includes("\r\n")?"\r\n":"\n";
 const line=HOOK+eol;
 const marker="function tickMiningFleet(scene, fleetRecord, now, hooks) {";
 const begin=source.indexOf(marker);
 if(begin<0||source.indexOf(marker,begin+marker.length)>=0)
  throw Error("MINING_SHIFT_NATIVE_TICK_ANCHOR_AMBIGUOUS");
 const anchorAt=source.indexOf(ANCHOR,begin+marker.length);
 const nextFunction=source.indexOf("\nfunction ",begin+marker.length);
 if(anchorAt<0||(nextFunction>=0&&anchorAt>nextFunction))
  throw Error("MINING_SHIFT_NATIVE_THINK_ANCHOR_MISSING");
 const hookAt=source.indexOf(HOOK,begin+marker.length);
 if(remove){
  if(hookAt<0)return source;
  if(hookAt>anchorAt||source.indexOf(HOOK,hookAt+HOOK.length)>=0)
   throw Error("MINING_SHIFT_NATIVE_HOOK_AMBIGUOUS");
  return source.slice(0,hookAt)+source.slice(hookAt+line.length);
 }
 if(hookAt>=0){
  if(hookAt>anchorAt||source.indexOf(HOOK,hookAt+HOOK.length)>=0)
   throw Error("MINING_SHIFT_NATIVE_HOOK_DRIFT");
  return source;
 }
 return source.slice(0,anchorAt)+line+source.slice(anchorAt);
}
module.exports={patch,HOOK,TARGET};
