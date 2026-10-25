"use strict";
// Pinned EveJS nativeNpcService materialization hook, after real entity spawn.
// Never called for clients, simulated clones or before original state is loaded.
const ANCHOR=`  const entity = applyNativeRuntimeNpcPresentation(
    spawnResult.data.entity,
    entityRecord,
    definition,
  );
  const controller = registerNativeRuntimeController(entityRecord, controllerRecord, definition);
  if (runtimeKind === "nativeAmbient") {
    syncNativeAmbientIdleState(scene, entity, controller, definition);
  }`;
const HOOK=`  if (process.env.EVEJS_COOP_ESCORT_NATIVE_INGRESS_SNAPSHOT === "1" && entity.nativeNpc === true) {
    try { require("../coopNativeStationArrival").restoreNativeIngress(entity, entityRecord); } catch (_) { /* skip recovery; never alter spawn */ }
  }`;
const count=(s,x)=>s.split(x).length-1;
function patch(text,{remove=false}={}){
 if(typeof text!=="string")throw Error("ESCORT_PINNED_NPC_MATERIALIZER_REQUIRED");
 const newline=text.includes("\r\n")?"\r\n":"\n";
 const hook=HOOK.replace(/\n/g,newline),anchor=ANCHOR.replace(/\n/g,newline);
 if(remove){
  if(count(text,hook)>1)throw Error("ESCORT_NPC_RESTORE_DUPLICATE_HOOK");
  return count(text,hook)===1?text.replace(newline+hook,""):text;
 }
 if(count(text,hook)>1)throw Error("ESCORT_NPC_RESTORE_DUPLICATE_HOOK");
 if(count(text,hook)===1)return text;
 if(count(text,anchor)!==1)
  throw Error("ESCORT_NPC_RESTORE_PINNED_ANCHOR_MISMATCH");
 return text.replace(anchor,anchor+newline+hook);
}
module.exports={patch,HOOK,ANCHOR};
