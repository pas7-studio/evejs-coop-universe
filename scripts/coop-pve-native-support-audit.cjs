"use strict";
// Read-only presence audit for pinned EveJS. String contracts do NOT prove
// content, player interaction, NPC spawn, item/ISK payout or a working client.
const fs = require("node:fs");
const path = require("node:path");
const PREFIX = "server/src/services/";
const CONTRACTS = Object.freeze({
  "dungeon/dungeonUniverseRuntime.js": ["UNIVERSE_SITE_ID_BASES", "combat_anomaly", "buildUniverseSiteDefinition", "rotateUniversePersistentInstances"],
  "dungeon/dungeonUniverseSiteService.js": ["spawnEncounterPlan", "materializeEncounterRewardContainers", "maybeCompleteClearedEncounterSite", "markDestroyedObjectiveTargets", "tickSceneSiteBehaviors"],
  "dungeon/dungeonRuntime.js": ["createInstance", "advanceObjective", "setLifecycleState", "listActiveInstancesBySystem"],
  "dungeon/dungeonTrackingRuntime.js": ["notifyDungeonCompletedForScene", "listSceneSessions", "completeCurrentDungeonForSession"],
  "dungeon/dungeonExplorationMgrService.js": ["Handle_GetInstancesForSolarsystem", "GetMyEscalatingPathDetails", "ESCALATING_PATH_HEADER"],
  "dungeon/dungeonInstanceCacheMgrService.js": ["Handle_GetCombatAnomalyInstances", "Handle_GetHomefrontSiteInstances", "Handle_GetTriglavianSiteInstances"],
  "exploration/signatures/signatureRuntime.js": ["listSystemAnomalySites", "listSystemSignatureSites"],
  "activity/abyssalMgrService.js": ["AbyssalEntranceDeployment rejected", "Abyssal content generation is not available"],
  "incursion/incursionRuntime.js": ["let activeIncursions = []", "replaceActiveIncursions"],
});
const readSources = codePath => {
  const root = path.resolve(codePath);
  const sources = {};
  for(const name of Object.keys(CONTRACTS)) {
    const filename = path.join(root, PREFIX + name);
    try { sources[name] = fs.readFileSync(filename,"utf8"); }
    catch(error) {
      if (error.code !== "ENOENT") throw error;
      sources[name] = null;
    }
  }
  return sources;
};
const all = (sources, ids) => ids.every(id => typeof sources[id] === "string" &&
  CONTRACTS[id].every(token => sources[id].includes(token)));
function auditSources(sources = {}) {
  const checks = {};
  for(const [filename,tokens] of Object.entries(CONTRACTS)) {
    const source = sources[filename];
    checks[filename] = {
      state: typeof source !== "string" ? "MISSING" :
        tokens.every(token => source.includes(token)) ? "PRESENT_CONTRACT_ONLY" : "DRIFTED",
      missingTokens: typeof source === "string" ? tokens.filter(t=>!source.includes(t)) : [...tokens],
    };
  }
  const dungeon = all(sources, ["dungeon/dungeonUniverseRuntime.js", "dungeon/dungeonUniverseSiteService.js", "dungeon/dungeonRuntime.js", "dungeon/dungeonTrackingRuntime.js", "dungeon/dungeonExplorationMgrService.js", "exploration/signatures/signatureRuntime.js"]);
  const cache = all(sources,["dungeon/dungeonInstanceCacheMgrService.js"]);
  const escalations = typeof sources["dungeon/dungeonExplorationMgrService.js"] === "string" &&
    /buildEscalatingPathDetails\(\)\s*\{[\s\S]*?return buildRowset\([\s\S]*?ESCALATING_PATH_HEADER\],[\s\r\n]*\[\]/.test(sources["dungeon/dungeonExplorationMgrService.js"]);
  const abyss = all(sources,["activity/abyssalMgrService.js"]);
  const incursion = all(sources,["incursion/incursionRuntime.js"]);
  const category = (state,evidence,details) => ({state,evidence,details,
    clientValidated:false,duoValidated:false,nativeRewardsValidated:false,gameplayVerified:false});
  return {
    sourceMode:"PINNED_SOURCE_CONTRACTS_ONLY", runtimeObserved:false, clientObserved:false,
    disclaimer:"No RPC call or source token is a client/gameplay acceptance result.",
    files:checks,
    activities:{
      combatAnomalies:category(dungeon?"NATIVE_PATH_PRESENT":"SOURCE_UNVERIFIED",["dungeon", "signature", "universe rotation"],"Generated anomaly sites, native waves and expiry need real-server validation."),
      combatComplexes:category(dungeon?"NATIVE_PATH_PRESENT":"SOURCE_UNVERIFIED",["dungeon", "signature"],"Only authored templates with authentic instances; no invented complexes."),
      dungeons:category(dungeon?"NATIVE_PATH_PRESENT":"SOURCE_UNVERIFIED",["dungeonRuntime", "dungeonTrackingRuntime"],"Native objective/room and completion notification available; no default duo payout promise."),
      escalations:category(escalations?"EMPTY_NATIVE_PATH":"SOURCE_UNVERIFIED",["dungeonExplorationMgr"],"Escalation method returns an empty rowset; no durable stage/reward chain established."),
      incursions:category(incursion?"REPORT_STATE_ONLY":"SOURCE_UNVERIFIED",["incursionRuntime"],"Incursion state list/replace exists, but this is not spawning and completing Incursion combat sites."),
      abyssalDeadspace:category(abyss?"ENTRY_REJECTED":"SOURCE_UNVERIFIED",["abyssalMgr"],"Native entrance deployment explicitly rejects unavailable content generation."),
      homefrontOperations:category(cache?"DISCOVERY_BUCKET_ONLY":"SOURCE_UNVERIFIED",["dungeonInstanceCacheMgr"],"Cache classifies archetype 70; no authored spawn/objective/reward proof."),
      otherCombatSites:category(cache&&dungeon?"NATIVE_PATH_PRESENT_CONDITIONAL":"SOURCE_UNVERIFIED",["triglavian site cache", "dungeon"],"Other invasion/pirate sites require matching authoritative templates and actual rewards."),
    },
  };
}
if(require.main === module) {
  try {
    if (process.argv.length !== 4 || process.argv[2] !== "--code-path")
      throw Error("usage: node scripts/coop-pve-native-support-audit.cjs --code-path <pinned EveJS/Code>");
    const result = auditSources(readSources(process.argv[3]));
    console.log(JSON.stringify(result,null,2));
    if (Object.values(result.files).some(f=>f.state!=="PRESENT_CONTRACT_ONLY")) process.exitCode=2;
  } catch(error) { console.error("PVE_AUDIT_ERROR:",error.message); process.exitCode=2; }
}
module.exports = {auditSources,readSources,CONTRACTS};
