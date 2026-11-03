import test from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import path from "node:path";

// Live regression 2026-11-03: owner flew into "Gone Berserk" (agent 3019082,
// client-dungeon:875), killed the pocket and stood there with a mission that could
// never finish. Instance 6 was created 2026-10-27 and still required all 7 waves
// (completionEncounterKeys wave_01..wave_07) while only wave_01 (a trigger message
// with no spawn record), wave_06 (skipped by EVEJS_COOP_MISSION_WAVE_CAP) and
// wave_07 (two hulls flagged non-objective) existed. Waves 02..05 were never spawned
// and nothing arms them again, so isEncounterCompletionSatisfied stayed false forever.
//
// The sweep may only ever CLOSE such an instance (never credit it): the owner's own
// instance was credited once, by an explicit operator repair.
const forkRoot = process.env.EVEJS_FORK_ROOT || "C:/Games/EveCoop/upstream-evejs";
const require = createRequire(import.meta.url);
const pacing = require(path.join(forkRoot, "Code/server/src/space/coopMissionWavePacing.js"));

const DAY = 86400000;
const NOW = Date.UTC(2026, 10, 3, 18, 0, 0);

function missionInstance(overrides = {}) {
  return {
    instanceID: 6,
    templateID: "client-dungeon:875",
    solarSystemID: 30001376,
    siteKey: "mission:140000005:2",
    siteKind: "mission",
    siteOrigin: "agentmission",
    lifecycleState: "active",
    timers: { createdAtMs: NOW - 7 * DAY },
    objectiveState: {
      state: "in_progress",
      completedAtMs: 0,
      counts: {},
      counters: { total_waves: 7, current_wave: 1 },
      metadata: {
        totalWaves: 7,
        completionEncounterKeys: ["wave_01", "wave_02", "wave_03", "wave_04", "wave_05", "wave_06", "wave_07"],
      },
    },
    spawnState: {
      encounterStatesByKey: {
        wave_01: { key: "wave_01", triggerNotificationsSentAtMs: NOW - 7 * DAY },
        wave_06: { key: "wave_06", spawnedAtMs: NOW - DAY, completedAtMs: NOW - DAY, spawnCount: 0, skippedByCap: true },
        wave_07: { key: "wave_07", spawnedAtMs: NOW - DAY, spawnCount: 2, remainingEntityIDs: [1, 2] },
      },
    },
    metadata: { missionRuntime: true, missionCharacterID: 140000005, missionAgentID: 3019082 },
    ...overrides,
  };
}

test("the measured zombie instance is recognised as unsatisfiable", () => {
  const reason = pacing.unsatisfiableMissionReason(missionInstance(), { nowMs: NOW });
  assert.equal(reason, "STALE_MISSION_WAVE_CHAIN_BROKEN");
});

test("a fresh instance inside the stale window is never touched", () => {
  const fresh = missionInstance({ timers: { createdAtMs: NOW - 3600000 } });
  assert.equal(pacing.unsatisfiableMissionReason(fresh, { nowMs: NOW }), null);
});

test("an instance whose waves are all settled is not a zombie", () => {
  const instance = missionInstance();
  instance.spawnState.encounterStatesByKey = {
    wave_01: { key: "wave_01", spawnedAtMs: NOW - DAY, completedAtMs: NOW - DAY },
    wave_02: { key: "wave_02", spawnedAtMs: NOW - DAY, completedAtMs: NOW - DAY },
    wave_03: { key: "wave_03", spawnedAtMs: NOW - DAY, completedAtMs: NOW - DAY },
  };
  instance.objectiveState.metadata.completionEncounterKeys = ["wave_01", "wave_02", "wave_03"];
  assert.equal(pacing.unsatisfiableMissionReason(instance, { nowMs: NOW }), null);
});

test("an already satisfied or completed instance is left alone", () => {
  const satisfied = missionInstance({ objectiveSatisfiedAtMs: NOW - DAY });
  assert.equal(pacing.unsatisfiableMissionReason(satisfied, { nowMs: NOW }), null);
  const completed = missionInstance();
  completed.objectiveState.state = "completed";
  assert.equal(pacing.unsatisfiableMissionReason(completed, { nowMs: NOW }), null);
});

test("a normal anomaly site is out of scope", () => {
  const anomaly = missionInstance({ siteKind: "anomaly", siteOrigin: "generated" });
  assert.equal(pacing.unsatisfiableMissionReason(anomaly, { nowMs: NOW }), null);
});

test("the sweep closes only the zombie instances", () => {
  const closed = [];
  const dungeonRuntime = {
    listInstancesByLifecycle(lifecycle, options) {
      assert.equal(lifecycle, "active");
      assert.deepEqual(options, { rawRows: true });
      return [missionInstance(), missionInstance({ instanceID: 9, timers: { createdAtMs: NOW - 60000 } })];
    },
    setLifecycleState(instanceID, state, options) {
      closed.push({ instanceID, state, reason: options && options.lifecycleReason });
      return { instanceID, lifecycleState: state };
    },
  };
  const result = pacing.sweepStaleMissionInstances({ dungeonRuntime, nowMs: NOW });
  assert.deepEqual(result.closed, [{ instanceID: 6, reason: "STALE_MISSION_WAVE_CHAIN_BROKEN" }]);
  assert.equal(result.scanned, 1);
  assert.deepEqual(closed, [
    { instanceID: 6, state: "failed", reason: "STALE_MISSION_WAVE_CHAIN_BROKEN" },
  ]);
});
