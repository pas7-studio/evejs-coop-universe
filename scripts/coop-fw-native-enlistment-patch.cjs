"use strict";
// Chat 35. One-statement guarded insertions in pinned EveJS.
// The central scripts/patch-evejs-coop.cjs installer is owned by Chat 01.
const FILE="server/src/services/corporation/fwCharacterEnlistmentMgrService.js";
const BLOCKS=Object.freeze([
 {begin:"  Handle_SetMyCorpAllowedEnlistmentFactions(args, session) {",
  end:"  Handle_GetMyDirectEnlistmentCooldownTimestamp(args, session) {",
  anchor:"    updateCorporationRuntime(corporationID, (runtime) => {",
  code:'    if (process.env.EVEJS_COOP_NATIVE_FW_ENLISTMENT_GUARD === "1") require("../../space/coopFwEnlistmentGate").assertCorpPolicy(session, factions);'},
 {begin:"  Handle_CreateMyDirectEnlistment(args, session) {",
  end:"  Handle_RemoveMyDirectEnlistment(args, session) {",
  anchor:"    updateCharacterRecord(characterID, (record) => ({",
  code:'    if (process.env.EVEJS_COOP_NATIVE_FW_ENLISTMENT_GUARD === "1") require("../../space/coopFwEnlistmentGate").assertDirect(session, characterID, factionID);'},
 {begin:"  Handle_RemoveMyDirectEnlistment(args, session) {",
  end:"module.exports = FwCharacterEnlistmentMgrService;",
  anchor:"    updateCharacterRecord(characterID, (record) => ({",
  code:'    if (process.env.EVEJS_COOP_NATIVE_FW_ENLISTMENT_GUARD === "1") require("../../space/coopFwEnlistmentGate").assertRetire(session, characterID);'},
 {begin:"  Handle_SetMyCorpAllowedEnlistmentFactions(args, session) {",
  end:"  Handle_GetMyDirectEnlistmentCooldownTimestamp(args, session) {",
  anchor:"    return buildList(factions);",
  code:'    if (process.env.EVEJS_COOP_NATIVE_FW_ENLISTMENT_GUARD === "1") require("../../space/coopFwEnlistmentGate").assertPersistedCorpPolicy(session, factions);'},
 {begin:"  Handle_CreateMyDirectEnlistment(args, session) {",
  end:"  Handle_RemoveMyDirectEnlistment(args, session) {",
  anchor:"    pushWarFactionSessionChange(session, factionID);",
  code:'    if (process.env.EVEJS_COOP_NATIVE_FW_ENLISTMENT_GUARD === "1") require("../../space/coopFwEnlistmentGate").assertPersistedDirect(session, characterID, factionID);'},
 {begin:"  Handle_RemoveMyDirectEnlistment(args, session) {",
  end:"module.exports = FwCharacterEnlistmentMgrService;",
  anchor:"    pushWarFactionSessionChange(session, corpFactionID);",
  code:'    if (process.env.EVEJS_COOP_NATIVE_FW_ENLISTMENT_GUARD === "1") require("../../space/coopFwEnlistmentGate").assertPersistedRetire(session, characterID, corpFactionID);'},
]);
const count=(s,needle)=>s.split(needle).length-1;
function patchFwNative(source,file,{remove=false}={}) {
 if(file!==FILE || typeof source!=="string")throw Error("FW_PINNED_FILE_UNSUPPORTED");
 let text=source;
 const eol=source.includes("\r\n")?"\r\n":"\n";
 // Reverse order preserves source offsets; scope every identical write anchor.
 for(const spec of [...BLOCKS].reverse()){
   if(count(text,spec.begin)!==1 || count(text,spec.end)!==1)throw Error("FW_PINNED_METHOD_CONTEXT_MISMATCH");
   const start=text.indexOf(spec.begin),end=text.indexOf(spec.end,start+spec.begin.length);
   if(end<start)throw Error("FW_PINNED_METHOD_ORDER_MISMATCH");
   const scope=text.slice(start,end),n=count(scope,spec.anchor),m=count(scope,spec.code);
   const observed=count(scope,"EVEJS_COOP_NATIVE_FW_ENLISTMENT_GUARD");
   const recognized=BLOCKS.filter(block=>block.begin===spec.begin)
     .reduce((sum,block)=>sum+count(scope,block.code),0);
   if(n!==1 || m>1 || observed!==recognized)
     throw Error("FW_PINNED_METHOD_ANCHOR_MISMATCH");
   const insert=spec.code+eol;
   const changed=remove? (m?scope.replace(insert,""):scope) :
     (m?scope:scope.replace(spec.anchor,insert+spec.anchor));
   if(m && !scope.includes(insert))throw Error("FW_PINNED_HOOK_EOL_MISMATCH");
   text=text.slice(0,start)+changed+text.slice(end);
 }
 return text;
}
module.exports={patchFwNative,FILE,BLOCKS};
