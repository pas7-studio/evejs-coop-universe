// Agent-mission waves 2..N spawn with an empty triggerMessages list: the wave is
// real, the client is never told. Measured on the play stack 2026-10-27 with
// "Gone Berserk" (dungeon 875): wave 1 -> 9 hulls, wave 2 -> 3 hulls spawned four
// minutes later with no client refresh, 7 waves / 24 hulls for 120k + 45k ISK and
// 250 LP. The module must announce a real wave and (optionally) cap the chain,
// never spawn, damage or complete anything by itself.
import test from "node:test";
import assert from "node:assert/strict";
import {
  capFor,
  capPlan,
  describeWave,
  isAgentMissionInstance,
  onWaveSpawn,
  parseMissionSiteKey,
  totalWavesOf,
  waveKey,
} from "../integration/coopMissionWavePacing.cjs";

const ON = { EVEJS_COOP_MISSION_WAVE_NOTIFY: "1" };

function withFlags(flags, run) {
  const previous = {};
  for (const key of ["EVEJS_COOP_MISSION_WAVE_NOTIFY", "EVEJS_COOP_MISSION_WAVE_CAP"]) {
    previous[key] = process.env[key];
    if (flags[key] === undefined) delete process.env[key];
    else process.env[key] = flags[key];
  }
  try {
    return run();
  } finally {
    for (const key of Object.keys(previous)) {
      if (previous[key] === undefined) delete process.env[key];
      else process.env[key] = previous[key];
    }
  }
}

function missionInstance(overrides = {}) {
  return {
    instanceID: 6,
    templateID: "client-dungeon:875",
    siteKey: "mission:140000005:2",
    siteKind: "mission",
    siteOrigin: "agentmission",
    solarSystemID: 30001376,
    lifecycleState: "active",
    objectiveState: {
      state: "in_progress",
      counters: { current_wave: 1, total_waves: 7, rooms_completed: 0 },
      metadata: { totalWaves: 7, completionEncounterKeys: ["wave_01", "wave_02", "wave_03", "wave_04", "wave_05", "wave_06", "wave_07"] },
    },
    spawnState: { encounterStatesByKey: { wave_01: { spawnedAtMs: 1, completedAtMs: 2, remainingEntityIDs: [] } } },
    ...overrides,
  };
}

function harness() {
  const writes = [];
  const trims = [];
  const notifications = [];
  return {
    writes,
    trims,
    notifications,
    deps: {
      sessionFor: (characterID) => ({
        characterID,
        sendNotification: (type, idType, payload) => notifications.push({ type, idType, payload }),
      }),
      missionUpdates: () => [{ agentID: 3019082, info: [] }],
      mergeSpawnState: (instanceID, patch, options) => writes.push({ instanceID, patch, options }),
      trimCompletion: (instanceID, keys, at) => trims.push({ instanceID, keys, at }),
      hasSpawned: () => false,
    },
  };
}

test("wave keys and mission site keys are parsed, not guessed", () => {
  assert.equal(waveKey(1), "wave_01");
  assert.equal(waveKey(7), "wave_07");
  assert.deepEqual(parseMissionSiteKey("mission:140000005:2"), { characterID: 140000005, sequence: 2 });
  assert.equal(parseMissionSiteKey("scenesignaturesite:30005203:5480005203001"), null);
});

test("only an agent-mission dungeon is paced", () => {
  assert.equal(isAgentMissionInstance(missionInstance()), true);
  assert.equal(isAgentMissionInstance(missionInstance({ siteKind: "signature", siteOrigin: "universe_dungeon", siteKey: "scenesignaturesite:1:2" })), false);
  assert.equal(isAgentMissionInstance(null), false);
});

test("flags off means no observation and no writes", () => {
  withFlags({}, () => {
    const h = harness();
    const result = onWaveSpawn({ instance: missionInstance(), plan: { waveIndex: 2, label: "Gone Berserk Wave 2" }, spawned: [{}, {}, {}], nowMs: 1000, totalWaves: 7 }, h.deps);
    assert.deepEqual(result, { status: "SKIPPED", reason: "FLAG_OFF" });
    assert.equal(h.writes.length, 0);
    assert.equal(h.notifications.length, 0);
    assert.equal(capFor(), 0);
  });
});

test("a spoken wave: the owner's mission is refreshed and the wave is described honestly", () => {
  withFlags(ON, () => {
    const h = harness();
    const result = onWaveSpawn({ instance: missionInstance(), plan: { waveIndex: 2, label: "Gone Berserk Wave 2" }, spawned: [{}, {}, {}], nowMs: 1000, totalWaves: 7 }, h.deps);
    assert.equal(result.status, "WAVE_OK");
    assert.equal(result.reason, "WAVE_SPAWNED");
    assert.equal(result.wave, 2);
    assert.equal(result.total, 7);
    assert.equal(result.spawned, 3);
    assert.equal(result.remainingWaves, 5);
    assert.equal(h.notifications.length, 1);
    assert.equal(h.notifications[0].type, "OnMissionsUpdated");
    assert.equal(result.notify.status, "NOTIFIED");
    assert.equal(h.writes.length, 0, "announcing must never rewrite dungeon state");
  });
});

test("an offline owner is reported, not invented", () => {
  withFlags(ON, () => {
    const h = harness();
    h.deps.sessionFor = () => null;
    const result = onWaveSpawn({ instance: missionInstance(), plan: { waveIndex: 3, label: "w3" }, spawned: [{}], nowMs: 1000 }, h.deps);
    assert.equal(result.status, "WAVE_OK");
    assert.deepEqual(result.notify, { status: "SKIPPED", reason: "OWNER_OFFLINE" });
  });
});

test("a non-mission instance is never touched even with both flags on", () => {
  withFlags({ EVEJS_COOP_MISSION_WAVE_NOTIFY: "1", EVEJS_COOP_MISSION_WAVE_CAP: "3" }, () => {
    const h = harness();
    const result = onWaveSpawn({ instance: missionInstance({ siteKind: "anomaly", siteOrigin: "universe_dungeon", siteKey: "x" }), plan: { waveIndex: 2 }, spawned: [{}], nowMs: 5 }, h.deps);
    assert.deepEqual(result, { status: "SKIPPED", reason: "NOT_AGENT_MISSION" });
    assert.equal(h.writes.length, 0);
  });
});

test("cap 3 settles waves 4..7 without spawning them and trims completion", () => {
  withFlags({ EVEJS_COOP_MISSION_WAVE_NOTIFY: "1", EVEJS_COOP_MISSION_WAVE_CAP: "3" }, () => {
    const h = harness();
    const result = onWaveSpawn({ instance: missionInstance(), plan: { waveIndex: 1, label: "w1" }, spawned: new Array(9).fill({}), nowMs: 4242, totalWaves: 7 }, h.deps);
    assert.equal(result.status, "WAVE_OK");
    assert.equal(result.reason, "WAVE_CAPPED");
    assert.equal(result.cap, 3);
    assert.deepEqual(result.skipped, ["wave_04", "wave_05", "wave_06", "wave_07"]);
    assert.equal(h.writes.length, 4);
    for (const write of h.writes) {
      assert.equal(write.instanceID, 6);
      const [key, state] = Object.entries(write.patch.encounterStatesByKey)[0];
      assert.equal(state.status, undefined);
      assert.equal(state.spawnCount, 0, "a capped wave must never claim spawned ships");
      assert.equal(state.skippedByCap, true);
      assert.equal(state.trigger, "coop_wave_cap");
      assert.equal(state.completedAtMs, 4242);
      assert.equal(state.spawnedAtMs, 4242, "spawnedAtMs is what stops the stock chain from spawning it");
      assert.equal(waveKey(Number(key.slice(-2))), key);
    }
    assert.equal(h.trims.length, 1);
    assert.deepEqual(h.trims[0].keys, ["wave_01", "wave_02", "wave_03"]);
    assert.equal(h.notifications.length, 1);
  });
});

test("a cap that already covers the mission changes nothing", () => {
  withFlags({ EVEJS_COOP_MISSION_WAVE_NOTIFY: "1", EVEJS_COOP_MISSION_WAVE_CAP: "7" }, () => {
    const h = harness();
    const result = onWaveSpawn({ instance: missionInstance(), plan: { waveIndex: 1 }, spawned: [{}], nowMs: 1, totalWaves: 7 }, h.deps);
    assert.equal(result.reason, "WAVE_SPAWNED");
    assert.deepEqual(result.skipped, []);
    assert.equal(h.writes.length, 0);
    assert.equal(h.trims.length, 0);
  });
});

test("a wave that already spawned is never re-marked or written over", () => {
  const plan = capPlan(missionInstance(), 3, 99, (key) => key === "wave_05");
  assert.equal(plan.apply, true);
  assert.deepEqual(plan.skipped, ["wave_04", "wave_06", "wave_07"]);
  assert.deepEqual(plan.kept, ["wave_01", "wave_02", "wave_03"]);
});

test("a malformed cap value cannot enable a silent gameplay change", () => {
  withFlags({ EVEJS_COOP_MISSION_WAVE_CAP: "0" }, () => assert.equal(capFor(), 0));
  withFlags({ EVEJS_COOP_MISSION_WAVE_CAP: "three" }, () => assert.equal(capFor(), 0));
  withFlags({ EVEJS_COOP_MISSION_WAVE_CAP: "-2" }, () => assert.equal(capFor(), 0));
  withFlags({ EVEJS_COOP_MISSION_WAVE_CAP: "3" }, () => assert.equal(capFor(), 3));
});

test("totals come from the dungeon state, never from a guessed constant", () => {
  assert.equal(totalWavesOf(missionInstance(), 0), 7);
  assert.equal(totalWavesOf(missionInstance({ objectiveState: { counters: { total_waves: 2 }, metadata: { totalWaves: 2 } } }), 0), 2);
  assert.equal(totalWavesOf(missionInstance({ objectiveState: {} }), 4), 4);
  const described = describeWave(missionInstance(), { waveIndex: 7, label: "Gone Berserk Wave 7" }, 7, 2);
  assert.deepEqual(
    { wave: described.wave, total: described.total, remainingWaves: described.remainingWaves, spawned: described.spawned },
    { wave: 7, total: 7, remainingWaves: 0, spawned: 2 },
  );
});
