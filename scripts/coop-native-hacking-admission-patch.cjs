"use strict";
// EX-04A: exact reversible source hooks; native Dogma authorizes hacking, not
// a client RPC. Opt-in and OFF by default. Uses the pinned upstream anchors.
const DOGMA="server/src/services/dogma/dogmaService.js";
const HACK="server/src/services/exploration/hackingMgrService.js";
function swap(text,original,patched,remove){
 if(typeof text!=="string"||!original||!patched||original===patched)
  throw Error("EX04_BAD_PATCH_INPUT");
 const from=remove?patched:original,to=remove?original:patched;
 // Anchors can be substrings of inserted code, so check full patched
 // text before trying a rewrite. This is apply/apply + remove/remove safe.
 if(!remove&&text.includes(patched))return text;
 if(remove&&!text.includes(patched)){
  if(text.includes(original))return text;
  throw Error("EX04_REMOVAL_DRIFT");
 }
 const matches=text.split(from).length-1;
 if(matches!==1)throw Error("EX04_ANCHOR_DRIFT_"+matches);
 return text.replace(from,to);
}
function patch(source,file,remove=false){
 if(file!==DOGMA&&file!==HACK)return source;
 let s=source;
 if(file===DOGMA){
  const original="        const hackingMgr = new HackingMgrService();";
  const replacement=`        // COOP_EX04_DOGMA_START
        if (process.env.EVEJS_COOP_NATIVE_HACKING_ADMISSION === "1") {
          const result = require(path.join(__dirname,
            "../../space/coopNativeHackingAdmission"))
            .getNativeHackingAdmission().issue(session, contextData);
          if (result.status !== "ISSUED") throw Error("COOP_HACKING_NATIVE_ADMISSION_REJECTED");
        }
        // COOP_EX04_DOGMA_END
${original}`;
  return swap(s,original,replacement,remove);
 }
 const start="    const nowMs = Date.now();\n    const target = resolveContainerTarget(targetID, session);";
 const startPatch=`    // COOP_EX04_HACK_START
    const admissionGuard = process.env.EVEJS_COOP_NATIVE_HACKING_ADMISSION === "1"
      ? require(path.join(__dirname,"../../space/coopNativeHackingAdmission"))
        .getNativeHackingAdmission() : null;
    const nativeAdmission = admissionGuard ?
      admissionGuard.consume(session,{targetID,gameType,moduleTypeID}) : null;
    if (admissionGuard && !nativeAdmission) return null;
    // COOP_EX04_HACK_START_END
${start}
    if (nativeAdmission && (!target || target.entity !== nativeAdmission.target)) return null;`;
 s=swap(s,start,startPatch,remove);
 const fields=[
  ["roundNumber(toFiniteNumber(difficulty, 1), 6)",
   "roundNumber(toFiniteNumber(nativeAdmission ? nativeAdmission.difficulty : difficulty, 1), 6)"],
  ["gameType: toInt(\n        gameType,", "gameType: toInt(\n        nativeAdmission ? nativeAdmission.gameType : gameType,"],
  ["moduleTypeID: toPositiveInt(moduleTypeID, 0) || null,",
   "moduleTypeID: toPositiveInt(nativeAdmission ? nativeAdmission.moduleTypeID : moduleTypeID, 0) || null,"],
  ["virusCoherence: Math.max(1, toInt(virusInitialCoherence, 200)),",
   "virusCoherence: Math.max(1, toInt(nativeAdmission ? nativeAdmission.coherence : virusInitialCoherence, 200)),"],
  ["virusStrength: Math.max(1, toInt(virusInitialStrength, 30)),",
   "virusStrength: Math.max(1, toInt(nativeAdmission ? nativeAdmission.strength : virusInitialStrength, 30)),"],
  ["virusSlots: Math.max(0, toInt(virusSlots, 3)),",
   "virusSlots: Math.max(0, toInt(nativeAdmission ? nativeAdmission.slots : virusSlots, 3)),"],
  ["key: getAttemptKey(session),\n      targetID:",
   "key: getAttemptKey(session),\n      nativeAdmission,\n      targetID:"]
 ];
 for(const [a,b] of fields)s=swap(s,a,b,remove);
 const hook=`  Handle_ClickedOnTile(args = [], session = null) {
    const [tileCoord] = normalizeCallArgs(args);
    const key = getAttemptKey(session);
    const attempt = ACTIVE_ATTEMPTS.get(key);
    if (!attempt || attempt.completed) {
      emitHackingTurn(session, [buildEvent(HACKING_CONSTANTS.EVENT_ACK, {})]);
      return null;
    }`;
 const withGuard=`${hook}
    // COOP_EX04_HACK_CONTINUATION
    if (process.env.EVEJS_COOP_NATIVE_HACKING_ADMISSION === "1" &&
        !require(path.join(__dirname,"../../space/coopNativeHackingAdmission"))
          .getNativeHackingAdmission().validate(session,attempt.nativeAdmission)) {
      ACTIVE_ATTEMPTS.delete(key);
      if (attempt.target?.entity?.dungeonSiteContentHackingState ===
          HACKING_CONSTANTS.HACKING_STATE_BEING_HACKED)
        markContainerState(attempt.target,HACKING_CONSTANTS.HACKING_STATE_SECURE,Date.now());
      return null;
    }
    // COOP_EX04_HACK_CONTINUATION_END`;
 s=swap(s,hook,withGuard,remove);
 const quitHook=`  Handle_QuitHackingAttempt(args = [], session = null) {
    normalizeCallArgs(args);
    const key = getAttemptKey(session);
    const attempt = ACTIVE_ATTEMPTS.get(key);
    if (!attempt || attempt.completed) {
      return null;
    }`;
 const guardedQuit=`${quitHook}
    // COOP_EX04_HACK_QUIT_IDENTITY
    if (process.env.EVEJS_COOP_NATIVE_HACKING_ADMISSION === "1" &&
        attempt.nativeAdmission?.session !== session) return null;
    // COOP_EX04_HACK_QUIT_IDENTITY_END`;
 s=swap(s,quitHook,guardedQuit,remove);
 return s;
}
module.exports={patch,DOGMA,HACK};
