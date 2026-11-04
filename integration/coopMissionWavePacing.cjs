"use strict";
// Agent-mission dungeons spawn their follow-up waves in silence.
//
// Measured on 2026-10-27 (play stack, mission "Gone Berserk", dungeon 875):
// wave 1 carries `triggerMessages: [{messageType:2,messageID:123944}]`, waves
// 2..7 carry an empty `triggerMessages: []`. The runtime does spawn them (wave 2
// appeared 4 minutes after wave 1 was cleared) but nothing refreshes the mission
// in the client, so the player sees an empty pocket and a mission that "does not
// count". The same mission also asks for 24 hulls (9+3+3+3+2+2+2) for
// 120k + 45k ISK and 250 LP.
//
// This module only observes and paces. It never spawns, damages, kills or
// completes a mission by itself: a wave stays a real native wave, and the
// objective only completes when the allowed waves are really cleared.
//
//  EVEJS_COOP_MISSION_WAVE_NOTIFY=1  refresh the owner's mission + one telemetry
//                                    event per spawned wave
//  EVEJS_COOP_MISSION_WAVE_CAP=<n>   allow at most n waves; waves above the cap
//                                    are recorded as settled-without-spawn so
//                                    the objective can complete after wave n
const PROBE = "./coopRuntimeProbe";

function enabled() {
  return process.env.EVEJS_COOP_MISSION_WAVE_NOTIFY === "1";
}

function capFor() {
  const raw = process.env.EVEJS_COOP_MISSION_WAVE_CAP;
  if (raw === undefined || raw === "") return 0;
  const parsed = Number(raw);
  return Number.isFinite(parsed) && parsed >= 1 ? Math.floor(parsed) : 0;
}

function waveKey(index) {
  const wave = Math.max(0, Number(index) || 0);
  return "wave_" + String(wave).padStart(2, "0");
}

function waveIndex(key) {
  const match = /^wave_(\d+)$/.exec(String(key || ""));
  return match ? Math.max(0, Number(match[1]) || 0) : 0;
}

// How long an agent-mission instance may sit with an impossible wave list
// before the sweep closes it. Waves are armed by wave_cleared, not by time, so a
// chain that never advanced is dead, not slow - but the window is generous so an
// owner who docks for the night and comes back still finds his real site.
function staleMaxAgeMs() {
  const raw = Number(process.env.EVEJS_COOP_MISSION_STALE_HOURS);
  const hours = Number.isFinite(raw) && raw > 0 ? raw : 12;
  return Math.round(hours * 3600000);
}

function completionKeysOf(instance) {
  const metadata = instance && instance.objectiveState && instance.objectiveState.metadata;
  const keys = Array.isArray(metadata && metadata.completionEncounterKeys)
    ? metadata.completionEncounterKeys
    : [];
  return keys.map((key) => String(key || "")).filter(Boolean);
}

// siteKey is the only place the owning character is written down for a mission
// dungeon ("mission:<characterID>:<sequence>").
function parseMissionSiteKey(siteKey) {
  const match = /^mission:(\d+):(\d+)$/.exec(String(siteKey || ""));
  if (!match) return null;
  return { characterID: Number(match[1]) || 0, sequence: Number(match[2]) || 0 };
}

function isAgentMissionInstance(instance) {
  if (!instance) return false;
  if (String(instance.siteKind || "").toLowerCase() !== "mission") return false;
  return String(instance.siteOrigin || "").toLowerCase() === "agentmission" ||
    parseMissionSiteKey(instance.siteKey) !== null;
}

function totalWavesOf(instance, fallback) {
  const counters = instance && instance.objectiveState && instance.objectiveState.counters;
  const metadata = instance && instance.objectiveState && instance.objectiveState.metadata;
  const fromState = Math.max(
    Number(counters && counters.total_waves) || 0,
    Number(metadata && metadata.totalWaves) || 0,
  );
  return Math.max(fromState, Number(fallback) || 0, 1);
}

// Pure description used by the announcement and by tests: no I/O.
function describeWave(instance, plan, totalWaves, spawnedCount) {
  const wave = Math.max(0, Number(plan && plan.waveIndex) || 0);
  const total = Math.max(wave, totalWavesOf(instance, totalWaves));
  const cap = capFor();
  const effectiveTotal = cap > 0 ? Math.min(cap, total) : total;
  return {
    wave,
    total,
    effectiveTotal,
    finalWave: wave >= effectiveTotal,
    key: waveKey(wave),
    label: String((plan && plan.label) || (instance && instance.templateID) || "") || null,
    spawned: Math.max(0, Number(spawnedCount) || 0),
    remainingWaves: Math.max(0, effectiveTotal - wave),
    // The stock data announces a wave only when the plan carries triggerMessages;
    // waves 2..N of most mission templates carry none.
    stockAnnounced: Array.isArray(plan && plan.triggerMessages) && plan.triggerMessages.length > 0,
  };
}

// Waves above the cap are marked settled without a spawn. `armDeferredEncounterPlans`
// and `spawnEncounterPlan` both skip a wave that already has `spawnedAtMs`, and the
// completion check needs `completedAtMs`, so one write stops the chain without
// touching the wave that is currently alive.
function capPlan(instance, cap, nowMs, hasSpawned) {
  const total = totalWavesOf(instance, cap);
  if (cap <= 0 || total <= cap) {
    return { apply: false, reason: cap <= 0 ? "NO_CAP" : "CAP_COVERS_ALL", total, cap, skipped: [], kept: [] };
  }
  const skipped = [];
  for (let index = cap + 1; index <= total; index += 1) {
    const key = waveKey(index);
    if (hasSpawned(key)) continue;
    skipped.push(key);
  }
  const kept = [];
  for (let index = 1; index <= cap; index += 1) kept.push(waveKey(index));
  return { apply: skipped.length > 0, reason: skipped.length > 0 ? "CAP_APPLIED" : "CAP_ALREADY_APPLIED", total, cap, skipped, kept };
}

function notifyOwner(instance, described, deps) {
  const site = parseMissionSiteKey(instance && instance.siteKey);
  if (!site || !site.characterID) return { status: "SKIPPED", reason: "NO_OWNER" };
  try {
    const session = deps.sessionFor(site.characterID);
    if (!session) return { status: "SKIPPED", reason: "OWNER_OFFLINE" };
    if (typeof session.sendNotification === "function" && deps.missionUpdates) {
      const updates = deps.missionUpdates(site.characterID);
      if (Array.isArray(updates) && updates.length > 0) {
        session.sendNotification("OnMissionsUpdated", "charid", [updates]);
        return { status: "NOTIFIED", reason: "MISSION_REFRESHED", characterID: site.characterID };
      }
    }
    return { status: "SKIPPED", reason: "NO_MISSION_UPDATES" };
  } catch (error) {
    return { status: "FAILED", reason: String((error && error.message) || error) };
  }
}

function observe(instance, described, extra) {
  try {
    require(PROBE).observe("living-mission-wave", null,
      { spaceState: { systemID: Number(instance && instance.solarSystemID) || 0 } },
      { status: extra && extra.status, reason: extra && extra.reason, ...described, ...(extra || {}) });
  } catch (_error) { /* observation must never break the native spawn */ }
}

// Called once per spawned wave, from the site service, after the wave really
// exists in the scene.
function onWaveSpawn(input, deps = {}) {
  const instance = input && input.instance;
  const plan = input && input.plan;
  const nowMs = Math.max(0, Number(input && input.nowMs) || Date.now());
  if (!instance || !plan) return { status: "SKIPPED", reason: "NO_INSTANCE" };
  if (!isAgentMissionInstance(instance)) return { status: "SKIPPED", reason: "NOT_AGENT_MISSION" };
  if (!enabled() && capFor() <= 0) return { status: "SKIPPED", reason: "FLAG_OFF" };
  const spawnedCount = Array.isArray(input && input.spawned) ? input.spawned.length : 0;
  const described = describeWave(instance, plan, input && input.totalWaves, spawnedCount);
  if (described.wave <= 0) return { status: "SKIPPED", reason: "NO_WAVE_INDEX" };

  const result = { status: "WAVE_OK", reason: "WAVE_SPAWNED", ...described, cap: capFor(), skipped: [], notify: null };

  if (capFor() > 0 && typeof deps.mergeSpawnState === "function") {
    const cap = capPlan(instance, capFor(), nowMs, (key) => deps.hasSpawned && deps.hasSpawned(key));
    result.skipped = cap.skipped;
    result.cap = cap.cap;
    if (cap.apply) {
      for (const key of cap.skipped) {
        deps.mergeSpawnState(instance.instanceID, {
          encounterStatesByKey: {
            [key]: {
              key,
              spawnedAtMs: nowMs,
              completedAtMs: nowMs,
              remainingEntityIDs: [],
              spawnCount: 0,
              trigger: "coop_wave_cap",
              skippedByCap: true,
            },
          },
        }, { nowMs });
      }
      if (typeof deps.trimCompletion === "function") deps.trimCompletion(instance.instanceID, cap.kept, nowMs);
      result.reason = "WAVE_CAPPED";
    }
  }

  if (enabled() && typeof deps.sessionFor === "function") {
    // A wave the stock data already announces must not be announced twice.
    result.notify = described.stockAnnounced
      ? { status: "SKIPPED", reason: "STOCK_ANNOUNCED" }
      : notifyOwner(instance, described, deps);
  }

  if (enabled() || capFor() > 0) observe(instance, result, { notify: result.notify });
  return result;
}

// Why an agent-mission instance can never satisfy its objective any more.
//
// Measured 2026-11-03 on "Gone Berserk" (client-dungeon:875, instance 6, created
// 2026-10-27): objectiveState counted 7 waves and required all of them
// (completionEncounterKeys wave_01..wave_07), but only wave_01 (a trigger message
// with no spawn record), wave_06 (skipped by the coop cap) and wave_07 (two hulls
// flagged non-objective) existed. Waves 02..05 were never spawned and nothing arms
// them any more, so isEncounterCompletionSatisfied stayed false forever and the
// player stood in a cleared pocket with an uncompletable mission.
function unsatisfiableMissionReason(instance, options = {}) {
  if (!instance || !isAgentMissionInstance(instance)) return null;
  if (String(instance.lifecycleState || "").toLowerCase() !== "active") return null;
  const objective = (instance && instance.objectiveState) || {};
  if (String(objective.state || "").toLowerCase() === "completed") return null;
  if (Math.max(0, Number(objective.completedAtMs) || 0) > 0) return null;
  if (Math.max(0, Number(instance.objectiveSatisfiedAtMs) || 0) > 0) return null;
  if (Math.max(0, Number(instance.metadata && instance.metadata.objectiveSatisfiedAtMs) || 0) > 0) return null;
  const keys = completionKeysOf(instance);
  if (keys.length <= 0) return null;
  const maxAgeMs = Math.max(0, Number(options.maxAgeMs) || staleMaxAgeMs());
  const nowMs = Math.max(0, Number(options.nowMs) || Date.now());
  const createdAtMs = Math.max(0, Number(instance.timers && instance.timers.createdAtMs) || 0);
  if (createdAtMs <= 0 || nowMs - createdAtMs < maxAgeMs) return null;
  const cap = capFor();
  const states = (instance.spawnState && instance.spawnState.encounterStatesByKey) || {};
  const stalled = keys.filter((key) => {
    const index = waveIndex(key);
    // A wave above the cap is settled on the next spawn pass, not broken.
    if (cap > 0 && index > cap) return false;
    const state = states[key];
    if (!state) return true;
    return Math.max(0, Number(state.spawnedAtMs) || 0) <= 0 &&
      Math.max(0, Number(state.completedAtMs) || 0) <= 0;
  });
  return stalled.length > 0 ? "STALE_MISSION_WAVE_CHAIN_BROKEN" : null;
}

// A mission wave that has a higher wave completed after it was never recorded at
// all is a bookkeeping hole, not a wave the player still owes: the chain really did
// pass it. Measured 2026-11-03 on "The Blockade" (client-dungeon:1940,
// instance 59114): wave_01 carried no state at all (its on_load spawn was never
// recorded), wave_02/03 followed from it and so never armed, wave_04 was skipped by
// the coop cap and wave_05 had really spawned and been cleared - and the mission sat
// at current_wave 2 forever, because its completion keys could never all settle.
//
// The heal only settles waves that are BELOW a wave the server itself recorded as
// completed; it never settles the wave that is being fought, and it never spawns or
// kills anything, so no mission can be credited by it alone.
function settleWavesPassedByCompletedWaves(instance, plans, options = {}) {
  const out = [];
  if (!instance || !isAgentMissionInstance(instance)) return out;
  const states = (instance.spawnState && instance.spawnState.encounterStatesByKey) || {};
  const ordered = (Array.isArray(plans) ? plans : [])
    .map((plan) => ({
      key: String((plan && plan.key) || ""),
      wave: Math.max(0, Number(plan && plan.waveIndex) || waveIndex(plan && plan.key)),
    }))
    .filter((plan) => plan.key && plan.wave > 0)
    .sort((left, right) => left.wave - right.wave);
  if (ordered.length <= 0) return out;
  let highestCompletedWave = 0;
  let lowestActiveWave = 0;
  for (const plan of ordered) {
    const state = states[plan.key];
    if (!state) continue;
    if (Math.max(0, Number(state.completedAtMs) || 0) > 0) {
      highestCompletedWave = Math.max(highestCompletedWave, plan.wave);
      continue;
    }
    if (Math.max(0, Number(state.spawnedAtMs) || 0) > 0) {
      lowestActiveWave = lowestActiveWave > 0
        ? Math.min(lowestActiveWave, plan.wave)
        : plan.wave;
    }
  }
  if (highestCompletedWave <= 0) return out;
  const limitWave = lowestActiveWave > 0
    ? Math.min(highestCompletedWave, lowestActiveWave)
    : highestCompletedWave;
  const nowMs = Math.max(0, Number(options.nowMs) || Date.now());
  for (const plan of ordered) {
    if (plan.wave >= limitWave) break;
    const state = states[plan.key];
    if (state) {
      if (Math.max(0, Number(state.spawnedAtMs) || 0) > 0) continue;
      if (Math.max(0, Number(state.completedAtMs) || 0) > 0) continue;
    }
    out.push({
      key: plan.key,
      patch: {
        key: plan.key,
        spawnedAtMs: nowMs,
        completedAtMs: nowMs,
        remainingEntityIDs: [],
        spawnCount: 0,
        trigger: "coop_mission_chain_heal",
        settledWithoutSpawn: true,
        healedAtMs: nowMs,
      },
    });
  }
  return out;
}

// Close (never complete) the agent-mission instances that can no longer satisfy
// their objective, so the pocket despawns and the owner can quit and retake the
// mission instead of standing in a site that will never finish.
function sweepStaleMissionInstances(deps = {}) {
  const dungeonRuntime = deps.dungeonRuntime;
  const result = { scanned: 0, closed: [] };
  if (!dungeonRuntime || typeof dungeonRuntime.listInstancesByLifecycle !== "function") return result;
  let rows = [];
  try {
    rows = dungeonRuntime.listInstancesByLifecycle("active", { rawRows: true }) || [];
  } catch (_error) {
    return result;
  }
  const nowMs = Math.max(0, Number(deps.nowMs) || Date.now());
  const limit = Math.max(1, Number(deps.limit) || 25);
  const maxAgeMs = Math.max(0, Number(deps.maxAgeMs) || staleMaxAgeMs());
  for (const summary of rows) {
    if (result.closed.length >= limit) break;
    // Summaries carry siteKind/siteOrigin/siteKey but not the wave bookkeeping, and
    // cloning every active instance would be a per-slice cost for nothing: only the
    // few agent-mission instances are read in full.
    if (!isAgentMissionInstance(summary)) continue;
    const createdAtMs = Math.max(0, Number(summary.timers && summary.timers.createdAtMs) || 0);
    if (createdAtMs <= 0 || nowMs - createdAtMs < maxAgeMs) continue;
    let instance = summary;
    try {
      if (typeof dungeonRuntime.getInstance === "function") {
        instance = dungeonRuntime.getInstance(Number(summary.instanceID)) || summary;
      }
    } catch (_error) { /* fall back to the summary, which simply fails closed */ }
    const reason = unsatisfiableMissionReason(instance, { nowMs, maxAgeMs });
    if (!reason) continue;
    result.scanned += 1;
    try {
      dungeonRuntime.setLifecycleState(Number(instance.instanceID), "failed", {
        lifecycleReason: reason,
        nowMs,
      });
      result.closed.push({ instanceID: Number(instance.instanceID), reason });
      try {
        require(PROBE).observe("living-mission-wave", null,
          { spaceState: { systemID: Number(instance.solarSystemID) || 0 } },
          { status: "STALE_INSTANCE_CLOSED", reason,
            instanceID: Number(instance.instanceID), totalWaves: completionKeysOf(instance).length });
      } catch (_error) { /* observation must never break the sweep */ }
    } catch (_error) { /* a failed close is retried on the next pass */ }
  }
  return result;
}

module.exports = {
  enabled,
  capFor,
  waveKey,
  waveIndex,
  parseMissionSiteKey,
  isAgentMissionInstance,
  totalWavesOf,
  describeWave,
  capPlan,
  completionKeysOf,
  unsatisfiableMissionReason,
  settleWavesPassedByCompletedWaves,
  sweepStaleMissionInstances,
  onWaveSpawn,
  onNativeWaveSpawn,
};

// dungeonUniverseSiteService built this adapter object inline in stock source: 1131
// characters of runtime plumbing per wave spawn. It now hands over the pieces and the
// wiring lives here, so the native file keeps one call.
function onNativeWaveSpawn({
  scene, instance, plan, spawned, nowMs, totalWaves, dungeonRuntime, sessionRegistry, missionRuntime,
}) {
  return onWaveSpawn({ scene, instance, plan, spawned, nowMs, totalWaves }, {
    mergeSpawnState: dungeonRuntime.mergeSpawnState,
    hasSpawned: (key) => {
      const live = dungeonRuntime.getInstance(instance.instanceID) || instance;
      const state = live && live.spawnState && live.spawnState.encounterStatesByKey
        && live.spawnState.encounterStatesByKey[key];
      return Math.max(0, Number(state && state.spawnedAtMs) || 0) > 0;
    },
    trimCompletion: (instanceID, keys, at) => dungeonRuntime.mergeObjectiveState(instanceID, {
      counters: { total_waves: keys.length },
      metadata: { completionEncounterKeys: keys, totalWaves: keys.length },
    }, { nowMs: at }),
    sessionFor: (characterID) => sessionRegistry.getSessions()
      .find((entry) => Number(entry && entry.characterID) === Number(characterID)),
    missionUpdates: (characterID) => missionRuntime.getMissionInfoItems(characterID,
      Number(instance && instance.metadata && instance.metadata.agentID) || 0, {}),
  });
}
