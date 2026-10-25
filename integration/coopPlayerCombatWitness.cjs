"use strict";
// Passive proof of applied player damage from the pinned native EveJS
// killmailTracker.noteDamage call. Never changes combat, rewards or standings.
const positive = value => {
  const n = Number(value);
  return Number.isSafeInteger(n) && n > 0 ? n : null;
};
function observeAppliedDamage({attackerEntity, targetEntity, appliedDamage, sessions, sceneForSession, emit} = {}) {
  const amount = Number(appliedDamage);
  const attackerID = positive(attackerEntity?.itemID);
  const targetID = positive(targetEntity?.itemID);
  if (!attackerID || !targetID || attackerID === targetID ||
    attackerEntity?.kind !== "ship" || attackerEntity.nativeNpc === true ||
    targetEntity?.kind !== "ship" || targetEntity.nativeNpc !== true ||
    !Number.isFinite(amount) || amount <= 0 || !Array.isArray(sessions) ||
    typeof sceneForSession !== "function" || typeof emit !== "function")
    return {status: "NOT_VERIFIED_NATIVE_PLAYER_DAMAGE"};
  // Not a user-supplied pilot ID: resolve the exact active ship and target
  // through the same authoritative native scene and a unique live session.
  const matches = sessions.filter(session =>
    positive(session?.characterID) &&
    positive(session?._space?.shipID) === attackerID &&
    positive(session?._space?.systemID) &&
    session._space.initialStateSent === true &&
    session?.socket?.destroyed !== true &&
    sceneForSession(session)?.getEntityByID?.(attackerID) === attackerEntity &&
    sceneForSession(session)?.getEntityByID?.(targetID) === targetEntity &&
    positive(sceneForSession(session)?.systemID) === positive(session._space.systemID));
  if(matches.length !== 1)return {status:"NO_UNIQUE_NATIVE_SHIP_OWNER"};
  const session = matches[0];
  const claimedPilot=positive(attackerEntity.pilotCharacterID ?? attackerEntity.characterID);
  if(claimedPilot && claimedPilot !== positive(session.characterID))
    return {status:"PLAYER_IDENTITY_MISMATCH"};
  const receipt = {
    status:"APPLIED_NATIVE_PLAYER_DAMAGE", systemID:positive(session._space.systemID),
    characterID:positive(session.characterID),shipID:attackerID,
    victimEntityID:targetID,appliedDamage:amount,
    source:"NATIVE_KILLMAIL_TRACKER_NOTE_DAMAGE"
  };
  try {emit(receipt);}catch(error){
    console.warn("[CoopPlayerCombatWitness] telemetry",String(error?.message||error));
    return {status:"TELEMETRY_NOT_RECORDED"};
  }
  return receipt;
}
function note(attackerEntity,targetEntity,appliedDamage){
  if(process.env.EVEJS_COOP_PLAYER_DAMAGE_EVIDENCE!=="1")return {status:"DISABLED"};
  try {
    const registry=require("../services/chat/sessionRegistry");
    const runtime=require("./runtime");
    return observeAppliedDamage({attackerEntity,targetEntity,appliedDamage,
      sessions:registry.getSessions(),sceneForSession:s=>runtime.getSceneForSession(s),
      emit:receipt=>require("./coopRuntimeProbe").observe("coop-native-player-damage",null,
        {spaceState:{systemID:receipt.systemID}},receipt)});
  }catch(error){
    console.warn("[CoopPlayerCombatWitness] native hook",String(error?.message||error));
    return {status:"UNAVAILABLE"};
  }
}
module.exports={observeAppliedDamage,note};
