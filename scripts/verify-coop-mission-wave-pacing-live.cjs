"use strict";
// Runs INSIDE the server container (agents stack): proves the installed artifact,
// not the repository copy. It calls the deployed space/coopMissionWavePacing.js
// with capturing dependencies, so no world state is written and no ship is spawned.
//
//   docker cp scripts/verify-coop-mission-wave-pacing-live.cjs evejs-agents-server-1:/tmp/v.cjs
//   docker exec evejs-agents-server-1 node /tmp/v.cjs
const assert = require("node:assert/strict");
const path = require("node:path");

const SPACE = "/app/server/src/space";
const modulePath = path.join(SPACE, "coopMissionWavePacing.js");
const pacing = require(modulePath);

process.env.EVEJS_COOP_MISSION_WAVE_NOTIFY = "1";
process.env.EVEJS_COOP_MISSION_WAVE_CAP = "3";

const instance = {
  instanceID: 990001,
  templateID: "client-dungeon:875",
  siteKey: "mission:140000005:2",
  siteKind: "mission",
  siteOrigin: "agentmission",
  solarSystemID: 30001376,
  lifecycleState: "active",
  objectiveState: {
    state: "in_progress",
    counters: { current_wave: 1, total_waves: 7 },
    metadata: { totalWaves: 7, completionEncounterKeys: ["wave_01", "wave_02", "wave_03", "wave_04", "wave_05", "wave_06", "wave_07"] },
  },
  spawnState: { encounterStatesByKey: { wave_01: { spawnedAtMs: 1, completedAtMs: 2, remainingEntityIDs: [] } } },
};

const writes = [];
const trims = [];
const notifications = [];
const result = pacing.onWaveSpawn(
  { instance, plan: { waveIndex: 1, label: "Gone Berserk Wave 1" }, spawned: new Array(9).fill({}), nowMs: Date.now(), totalWaves: 7 },
  {
    sessionFor: (characterID) => ({ characterID, sendNotification: (type, idType, payload) => notifications.push({ type, idType, payload }) }),
    missionUpdates: () => [{ agentID: 3019082, info: [] }],
    mergeSpawnState: (instanceID, patch, options) => writes.push({ instanceID, patch, options }),
    trimCompletion: (instanceID, keys, at) => trims.push({ instanceID, keys, at }),
    hasSpawned: () => false,
  },
);

assert.equal(result.status, "WAVE_OK", "module must answer WAVE_OK");
assert.equal(result.reason, "WAVE_CAPPED", "cap 3 must trim the chain");
assert.deepEqual(result.skipped, ["wave_04", "wave_05", "wave_06", "wave_07"]);
assert.equal(writes.length, 4, "four waves above the cap must be settled");
for (const write of writes) {
  const [key, state] = Object.entries(write.patch.encounterStatesByKey)[0];
  assert.equal(state.spawnCount, 0);
  assert.equal(state.skippedByCap, true);
  assert.ok(state.spawnedAtMs > 0 && state.completedAtMs > 0, key + " must be settled, never spawned");
}
assert.deepEqual(trims[0].keys, ["wave_01", "wave_02", "wave_03"]);
assert.equal(notifications.length, 1);
assert.equal(notifications[0].type, "OnMissionsUpdated");

// Both flags off must be a no-op even on a real mission instance.
delete process.env.EVEJS_COOP_MISSION_WAVE_NOTIFY;
delete process.env.EVEJS_COOP_MISSION_WAVE_CAP;
const off = pacing.onWaveSpawn({ instance, plan: { waveIndex: 2 }, spawned: [{}], nowMs: Date.now() }, { mergeSpawnState: () => { throw new Error("must not write"); } });
assert.deepEqual(off, { status: "SKIPPED", reason: "FLAG_OFF" });

console.log("LIVE_OK module=" + modulePath + " capped=" + result.skipped.join(",") + " kept=" + trims[0].keys.join(","));
