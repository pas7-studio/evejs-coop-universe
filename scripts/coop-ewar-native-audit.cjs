"use strict";
// Read-only source contract audit; results are NEVER gameplay evidence.
const fs = require("node:fs");
const path = require("node:path");
const CONTRACTS = Object.freeze({
  "space/modules/hostileModuleRuntime.js": [
    "warpScrambler", "warpDisruptor", "stasisWebifier", "targetPainter",
    "sensorDampener", "trackingDisruptor", "guidanceDisruptor",
    "energyNeutralizer", "energyNosferatu", "isEntityLockedTarget",
    "buildLiveModuleAttributeMap", "hostileStackingPenalized",
    "executeHostileModuleCycle", "isEntityWarpScrambled"
  ],
  "space/modules/jammerModuleRuntime.js": [
    "ecmJammer", "ecmBurstJammer", "isEntityLockedTarget",
    "resolveJammerChance", "recomputeEntityJammedState",
    "clearOutgoingTargetLocksExcept", "executeJammerModuleCycle"
  ],
  "space/modules/assistanceModuleRuntime.js": [
    "remoteShield", "remoteArmor", "remoteHull", "remoteCapacitor",
    "remoteSensorBoost", "remoteTracking", "isEntityLockedTarget",
    "buildLiveModuleAttributeMap", "executeAssistanceModuleCycle",
    "notifyCapacitorChangeToSession", "commitHealthRepair"
  ],
  "space/modules/commandBurstRuntime.js": [
    "isInSameFleet", "resolveCommandBurstRecipients",
    "applyTimedCommandBurstToEntity", "pruneExpiredCommandBursts",
    "isChargeCompatibleWithModule", "ATTRIBUTE_CAPACITOR_NEED",
    "collectModifierEntriesForItem"
  ],
  "space/npc/npcBehaviorLoop.js": [
    "isEntityWarpScrambled", "syncNpcHostileModules",
    "syncNpcAssistanceModules", "scene.activateGenericModule",
    "scene.deactivateGenericModule"
  ]
});
function auditSourceFiles(load) {
  const files=[];
  for (const [file, tokens] of Object.entries(CONTRACTS)) {
    let src;
    try {src=load(file);} catch (error) {src=null;}
    const missing=typeof src === "string" ? tokens.filter(token=>!src.includes(token)) : tokens.slice();
    files.push({file,status:missing.length ? "SOURCE_CONTRACT_MISSING" : "SOURCE_CONTRACT_PRESENT",missing});
  }
  return {status:files.every(x=>x.status==="SOURCE_CONTRACT_PRESENT") ?
    "SOURCE_ONLY_PRESENT" : "BLOCKED_SOURCE_CONTRACT",files,
    liveGameplayVerified:false};
}
function auditCodeRoot(codeRoot) {
  if (typeof codeRoot !== "string" || !codeRoot.trim()) throw Error("EVEJS_CODE_PATH_REQUIRED");
  const root=path.resolve(codeRoot);
  return auditSourceFiles(file=>fs.readFileSync(path.join(root,"server/src",file),"utf8"));
}
if (require.main === module) {
  const result=auditCodeRoot(process.argv[2]);
  console.log(JSON.stringify(result,null,2));
  if (result.status!=="SOURCE_ONLY_PRESENT") process.exitCode=1;
}
module.exports = {auditSourceFiles,auditCodeRoot,CONTRACTS};
