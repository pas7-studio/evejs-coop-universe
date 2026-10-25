"use strict";
// Reversible P0 adapter for the EXACT PINNED EveJS mission+dungeon source.
// The runtime source still controls native completion, journals, rewards,
// standings, and items. Co-op shares only a verified native objective.
const count=(s,needle)=>s.split(needle).length-1;
function patch(source,file,remove=false){
 let text=String(source);
 const eol=text.includes("\r\n")?"\r\n":"\n";
 const lines=s=>s.replace(/\n/g,eol);
 if(file.endsWith("/agent/agentMissionRuntime.js")){
  const progressBase='  if (nextRecord.objectiveMode === OBJECTIVE_TYPE_TRANSPORT) {';
  const progressNew=lines([
   '  if (nextRecord.objectiveMode === OBJECTIVE_TYPE_DUNGEON &&',
   '    nextRecord.coopSharedDungeon &&',
   '    normalizePositiveInteger(nextRecord.coopSharedDungeon.sourceInstanceID, 0) > 0 &&',
   '    normalizePositiveInteger(nextRecord.coopSharedDungeon.agentID, 0) ===',
   '      normalizePositiveInteger(nextRecord.agentID, 0) &&',
   '    String(nextRecord.coopSharedDungeon.contentID) === String(nextRecord.contentID) &&',
   '    String(nextRecord.coopSharedDungeon.missionTemplateID || "") ===',
   '      String(nextRecord.missionTemplateID || "")) {',
   '    nextRecord.objectiveCompleted = true;',
   '    return nextRecord;',
   '  }',
   ''
  ].join("\n"));
  const functionAnchor='function setMissionObjectiveCompleted(characterID, agentID) {';
  const exportedAnchor='  syncMissionRecordForDungeonInstance,';
  const exportedLine='  shareCoopDungeonObjective,';
  const nativeMethod=lines([
   'function shareCoopDungeonObjective(peerID, agentID, ownerID, sourceInstanceID) {',
   '  const peer = normalizePositiveInteger(peerID, 0);',
   '  const owner = normalizePositiveInteger(ownerID, 0);',
   '  const agent = normalizePositiveInteger(agentID, 0);',
   '  const instanceID = normalizePositiveInteger(sourceInstanceID, 0);',
   '  if (!peer || !owner || peer === owner || !agent || !instanceID)',
   '    return { success: false, errorMsg: "INVALID_NATIVE_COOP_MISSION" };',
   '  const nativeInstance = dungeonRuntime.getInstance(instanceID);',
   '  const state = nativeInstance && nativeInstance.objectiveState;',
   '  const originalOwner = normalizePositiveInteger(',
   '    nativeInstance && nativeInstance.ownership && nativeInstance.ownership.missionOwnerCharacterID, 0) ||',
   '    normalizePositiveInteger(nativeInstance && nativeInstance.metadata && nativeInstance.metadata.missionCharacterID, 0);',
   '  const instanceAgent = normalizePositiveInteger(',
   '    nativeInstance && nativeInstance.metadata && nativeInstance.metadata.missionAgentID, 0);',
   '  if (!state || (String(state.state || "").toLowerCase() !== "completed" &&',
   '    !(Number(state.completedAtMs) > 0)) || originalOwner !== owner || instanceAgent !== agent)',
   '    return { success: false, errorMsg: "SOURCE_DUNGEON_NOT_COMPLETED" };',
   '  const leaderMission = getMissionRecord(owner, agent);',
   '  const wingmanMission = getMissionRecord(peer, agent);',
   '  if (!leaderMission || !wingmanMission ||',
   '    leaderMission.runtimeStatus !== "accepted" ||',
   '    wingmanMission.runtimeStatus !== "accepted" ||',
   '    leaderMission.objectiveMode !== OBJECTIVE_TYPE_DUNGEON ||',
   '    wingmanMission.objectiveMode !== OBJECTIVE_TYPE_DUNGEON ||',
   '    leaderMission.objectiveCompleted !== true ||',
   '    leaderMission.gmCompleted === true || wingmanMission.gmCompleted === true ||',
   '    normalizePositiveInteger(leaderMission.dungeonInstanceID, 0) !== instanceID ||',
   '    String(leaderMission.contentID) !== String(wingmanMission.contentID) ||',
   '    String(leaderMission.missionTemplateID || "") !== String(wingmanMission.missionTemplateID || "") ||',
   '    normalizePositiveInteger(leaderMission.missionSystemID, 0) !==',
   '      normalizePositiveInteger(wingmanMission.missionSystemID, 0))',
   '    return { success: false, errorMsg: "NATIVE_MISSION_CONTEXT_CHANGED" };',
   '  if (wingmanMission.objectiveCompleted === true)',
   '    return { success: true, alreadyCompleted: true };',
   '  const result = mutateCharacterState(peer, (characterState) => {',
   '    const existing = characterState.missionsByAgentID[String(agent)];',
   '    if (!existing || existing.runtimeStatus !== "accepted" ||',
   '      existing.objectiveMode !== OBJECTIVE_TYPE_DUNGEON ||',
   '      existing.missionSequence !== wingmanMission.missionSequence ||',
   '      existing.gmCompleted === true ||',
   '      String(existing.contentID) !== String(leaderMission.contentID) ||',
   '      String(existing.missionTemplateID || "") !== String(leaderMission.missionTemplateID || ""))',
   '      return null;',
   '    if (existing.coopSharedDungeon && existing.coopSharedDungeon.sourceInstanceID === instanceID)',
   '      return { alreadyCompleted: true };',
   '    existing.coopSharedDungeon = { sourceInstanceID: instanceID,',
   '      agentID: agent, ownerID: owner, contentID: existing.contentID,',
   '      missionTemplateID: existing.missionTemplateID };',
   '    existing.objectiveCompleted = true;',
   '    existing.lastUpdatedAtMs = Date.now();',
   '    return { shared: true };',
   '  });',
   '  if (!result || !result.success || !result.data || result.data.shared !== true)',
   '    return { success: false, errorMsg: "NATIVE_COOP_OBJECTIVE_WRITE_FAILED" };',
   '  notifyMissionTrackerUpdate(peer, agent);',
   '  notifyMissionChange(peer, AGENT_MISSION_MODIFIED, agent);',
   '  return { success: true, data: { agentID: agent, sourceInstanceID: instanceID } };',
   '}',
   ''
  ].join("\n"));
  const start=text.indexOf('function evaluateMissionProgress(characterID, missionRecord) {');
  const end=text.indexOf('function syncMissionRecordState(',start);
  const target=start<0||end<start?-1:text.indexOf(progressBase,start);
  if(target<start||target>end||count(text,functionAnchor)!==1||
   count(text,exportedAnchor)!==1)
   throw Error("UNKNOWN_PINNED_EVEJS_AGENT_MISSION_SOURCE");
  const hasProgress=text.slice(start,end).includes(progressNew);
  const hasMethod=text.includes(nativeMethod);
  const hasExport=text.includes(exportedLine);
  if([hasProgress,hasMethod,hasExport].some(x=>x!==hasProgress))
   throw Error("PARTIAL_COOP_NATIVE_AGENT_MISSION_PATCH");
  if(remove&&hasProgress){
   text=text.replace(progressNew,"").replace(nativeMethod,"").replace(
    exportedLine+eol,"");
  }else if(!remove&&!hasProgress){
   text=text.slice(0,target)+progressNew+text.slice(target);
   text=text.replace(functionAnchor,nativeMethod+functionAnchor);
   text=text.replace(exportedAnchor,exportedLine+eol+exportedAnchor);
  }
 }else if(file.endsWith("/dungeon/dungeonUniverseSiteService.js")){
  const old=lines([
   '      return agentMissionRuntime.syncMissionRecordForDungeonInstance(instance, {',
   '        notifyTracker: true,',
   '        notifyMissionChange: false,',
   '        nowMs: options.nowMs,',
   '      });'
  ].join("\n"));
  const patched=lines([
   '      const originalMission = agentMissionRuntime.syncMissionRecordForDungeonInstance(instance, {',
   '        notifyTracker: true,',
   '        notifyMissionChange: false,',
   '        nowMs: options.nowMs,',
   '      });',
   '      if (originalMission && originalMission.objectiveCompleted === true &&',
   '        process.env.EVEJS_COOP_FLEET_MISSION_SHARE === "1") {',
   '        try {',
   '          const event = require("../../space/coopFleetDungeonCredit").observe({',
   '            instance, missionRuntime: agentMissionRuntime,',
   '            fleetRuntime: require("../fleets/fleetRuntime"),',
   '            spaceRuntime: require("../../space/runtime"),',
   '            sessions: require("../chat/sessionRegistry").getSessions()',
   '          });',
   '          if (event.status === "TWO_PLAYER_NATIVE_DUNGEON_OBJECTIVE_CREDITED")',
   '            require("../../space/coopRuntimeProbe").observe(',
   '              "coop-fleet-dungeon-objective", null, null, event);',
   '        } catch (error) { console.warn("[CoopDungeonObjective]",error.message); }',
   '      }',
   '      return originalMission;'
  ].join("\n"));
  const before=count(text,old),after=count(text,patched);
  if(before+after!==1)throw Error("UNKNOWN_OR_PARTIAL_PINNED_EVEJS_DUNGEON_SYNC");
  if(remove&&after)text=text.replace(patched,old);
  if(!remove&&before)text=text.replace(old,patched);
 }
 return text;
}
module.exports={patch};
