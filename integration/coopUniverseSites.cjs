"use strict";
// Universe site seeding for the systems this world actually plays in.
//
// The dungeon seeder exists and works, but it is only ever fed the AWAKE system list, so a system that
// the player visits without a scene holding a site gets nothing and never rotates. Measured on the
// owner's stack: 27 persistent instances in 16 systems, and zero in Jita / Perimeter / New Caldari.
//
// This module reconciles the visited systems through the real persistent-site seeder
// (dungeonUniverseRuntime.reconcileUniversePersistentSites), which builds the desired definitions for
// exactly those systems from the dungeon authority's own spawn profiles (23 families, band slots) and
// creates only what is missing. The 24-hour lifetime and the expire/rotate tick stay exactly as they
// are - sites appear, expire and move on their own; this only makes sure our systems take part.
//
// Rate limited on purpose: a full reconcile builds definitions for every band, so it runs when a new
// system is visited or when RECONCILE_INTERVAL_MS has passed, never on every tick.
const RECONCILE_INTERVAL_MS = 10 * 60 * 1000;
// The owner hunts difficulty-4 combat anomalies and was flying 5-9 jumps to find one.
// Cover more of the systems he actually visits per pass (24) and seed a wider
// rotating sample of the bands, so "the next system over" usually has sites too.
function readLimit(envKey, fallback, minimum, maximum) {
  const parsed = Number(process.env[envKey]);
  if (!Number.isFinite(parsed) || parsed < minimum || parsed > maximum) {
    return fallback;
  }
  return Math.floor(parsed);
}
const MAX_SYSTEMS = readLimit("EVEJS_COOP_UNIVERSE_SITE_SYSTEMS", 24, 1, 64);
const SLICE_SYSTEMS = 1;
// A pass seeds at most this many systems; the rest stays pending for a later pass.
const MAX_PASS_SYSTEMS = readLimit("EVEJS_COOP_UNIVERSE_SITE_PASS", 16, 1, 48);
// A real delay, not 0: back-to-back 0 ms slices still starve the game tick and the
// lag monitor, so the whole pass showed up as one multi-second block.
const SLICE_DELAY_MS = 300;
const MAX_DESTINATION_RETRIES = 3;

let lastReconcileAtMs = 0;
const reconciledSystemIDs = new Set();
const pendingDestinationSystemIDs = new Map();
let lastSummary = null;
let passJob = null;
let passTimer = null;

function enabled(env = process.env) {
  return String(env.EVEJS_COOP_UNIVERSE_SITES || "1") !== "0";
}

// Deterministic RNG for the site allocator. The engine's random allocator falls back to Math.random,
// so every reconcile produced different definitions and REPLACED the live instances: materialised
// asteroid and NPC content was destroyed, and a client that had locked a rock got TARGET_NOT_FOUND
// from the mining laser (live 2026-10-30 19:47). Seeding by UTC day keeps the layout identical for
// the whole day and still rotates it daily.
function createSeededRng(seed) {
  let state = (Number(seed) >>> 0) || 0x9e3779b9;
  return function nextRandom() {
    state = (state + 0x6d2b79f5) >>> 0;
    let value = state;
    value = Math.imul(value ^ (value >>> 15), value | 1);
    value ^= value + Math.imul(value ^ (value >>> 7), value | 61);
    return ((value ^ (value >>> 14)) >>> 0) / 4294967296;
  };
}

function siteAllocationRng(nowMs, salt = "coop-universe-sites") {
  const day = Math.floor(Math.max(0, Number(nowMs) || 0) / 86400000);
  const mix = (hashToUnit(`${salt}:${day}`) * 4294967296) >>> 0;
  return createSeededRng(mix);
}

// A rotating, deterministic sample of the systems the world does not naturally visit, so a player who
// flies into null-sec or wormhole space meets sites there too (the engine materialises an instance the
// moment a scene is built, so seeding ahead of time is exactly right).
const SAMPLE_PER_BAND = readLimit("EVEJS_COOP_UNIVERSE_SITE_SAMPLE", 24, 1, 128);
let sampleCache = { day: 0, nullsec: [], wormhole: [] };

function isWormholeSystemID(systemID) {
  const numeric = Number(systemID) || 0;
  return numeric >= 31000000 && numeric <= 31999999;
}

function hashToUnit(value) {
  let hash = 2166136261;
  const text = String(value);
  for (let index = 0; index < text.length; index += 1) {
    hash ^= text.charCodeAt(index);
    hash = Math.imul(hash, 16777619) >>> 0;
  }
  return hash / 4294967296;
}

function sampleBands(nowMs) {
  const day = Math.floor(nowMs / 86400000);
  if (sampleCache.day === day) return sampleCache;
  let rows = [];
  try {
    rows = require("./worldData").getSolarSystems() || [];
  } catch (_error) {
    rows = [];
  }
  const nullsec = [];
  const wormhole = [];
  for (const row of rows) {
    const systemID = Number(row && (row.solarSystemID || row.itemID)) || 0;
    if (systemID <= 0) continue;
    // J-space is identified by its id range (31xxxxxx), not by a column: `worldData` carries the
    // SDE solar-system rows, which only have `security`/`securityClass`. J-space systems report
    // security -1, so without this check they would be sampled as null-sec.
    if (isWormholeSystemID(systemID)) {
      wormhole.push({ systemID, rank: hashToUnit(`wh:${systemID}:${day}`) });
      continue;
    }
    // Special space (Pochven, 32xxxxxx) has no player stargate: seeding sites there would be invisible.
    if (systemID >= 31000000) continue;
    const security = Number(row && (row.securityStatus ?? row.security));
    if (Number.isFinite(security) && security < 0) {
      nullsec.push({ systemID, rank: hashToUnit(`ns:${systemID}:${day}`) });
    }
  }
  const take = (list) => list.sort((left, right) => left.rank - right.rank)
    .slice(0, SAMPLE_PER_BAND)
    .map((entry) => entry.systemID);
  sampleCache = { day, nullsec: take(nullsec), wormhole: take(wormhole) };
  return sampleCache;
}

function liveSceneSystemIDs() {
  const ids = [];
  try {
    const runtime = require("./runtime");
    if (runtime && runtime.scenes instanceof Map) {
      for (const key of runtime.scenes.keys()) {
        const numeric = Number(key);
        if (Number.isSafeInteger(numeric) && numeric > 0) ids.push(numeric);
      }
    }
  } catch (_error) {
    /* no scene registry yet: the world visited set is still enough */
  }
  return ids;
}

function systemIDsOf(visitedSystems) {
  const ids = [];
  for (const value of visitedSystems || []) {
    const numeric = Number(value);
    if (Number.isSafeInteger(numeric) && numeric > 0) ids.push(numeric);
  }
  return [...new Set(ids)].sort((left, right) => left - right).slice(0, MAX_SYSTEMS);
}

// Systems where a real player is sitting right now. Only these may force an immediate seeding pass: every other
// system, including the ones this pass creates scenes for, waits for the ten-minute interval.
function playerOccupiedSystems() {
  const ids = new Set();
  try {
    const runtime = require("./runtime");
    if (runtime && runtime.scenes instanceof Map) {
      for (const [key, scene] of runtime.scenes.entries()) {
        const numeric = Number(key);
        if (!Number.isSafeInteger(numeric) || numeric <= 0) continue;
        const sessions = scene && scene.sessions;
        if (!sessions || typeof sessions.values !== "function") continue;
        for (const session of sessions.values()) {
          // A server-driven NPC agent also holds a pseudo session, so "some session exists" is not "a player is
          // here". Only a real client socket counts.
          const socket = session && session.socket;
          if (!socket || socket.destroyed === true) continue;
          ids.add(numeric);
          break;
        }
      }
    }
  } catch (_error) {
    /* no scene registry yet */
  }
  return ids;
}

function reconcile({ visitedSystems, nowMs = Date.now(), force = false, env = process.env } = {}) {
  if (!enabled(env)) return { status: "DISABLED" };
  // One pass at a time. The pass is sliced (see runPassSlice), so a tick that
  // arrives mid-pass must not start a second one.
  if (passJob) {
    return { status: "IN_PROGRESS", done: passJob.completed, total: passJob.systemIDs.length };
  }
  const world = [...new Set([...systemIDsOf(visitedSystems), ...liveSceneSystemIDs()])]
    .sort((left, right) => left - right)
    .slice(0, MAX_SYSTEMS);
  const sample = sampleBands(nowMs);
  // Plan the known-space wormhole entrances BEFORE seeding, so the J-space systems those entrances
  // lead into get their sites in the same pass. Without that a player could scan a hole and land in a
  // completely empty system.
  let entrancePlan = { status: "SKIPPED", entrances: [] };
  try {
    entrancePlan = require("./coopWormholeEntrances").plan({ systemIDs: world, nowMs });
  } catch (_error) {
    entrancePlan = { status: "SKIPPED", entrances: [] };
  }
  const entranceJSystems = entrancePlan.entrances
    .map((entry) => Math.max(0, Number(entry.sourceSystemID) || 0))
    .filter((systemID) => systemID > 0);
  const systemIDs = [...new Set([
    ...world,
    ...sample.nullsec,
    ...sample.wormhole,
    ...entranceJSystems,
    ...pendingDestinationSystemIDs.keys(),
  ])];
  if (systemIDs.length === 0) return { status: "NO_SYSTEMS" };
  // The player's own systems first, then the rest. One system still costs ~1 s of blocked loop (the engine
  // deep-clones its whole dungeon state on every mutation), so a pass seeds at most MAX_PASS_SYSTEMS: the
  // remainder stays pending and goes out with a later pass instead of freezing 36 systems in a row.
  const occupied = playerOccupiedSystems();
  const occupiedSet = new Set(occupied);
  const ordered = [
    ...systemIDs.filter((id) => occupiedSet.has(id)),
    ...systemIDs.filter((id) => !occupiedSet.has(id)),
  ].slice(0, MAX_PASS_SYSTEMS);
  const pending = ordered.filter((id) => !reconciledSystemIDs.has(id));
  // Only a system a player is really sitting in may force an immediate pass. A live *scene* is not enough: the
  // site pass itself creates scenes, so the pending set was refilled by its own output and the whole 36-system pass
  // (measured 2026-11-03: p50 19.0 s, max 23.2 s of blocked event loop) ran about once a minute instead of every ten.
  const due = require("./coopUniverseSitesCadence").shouldReconcile({
    pending,
    worldIDs: occupied,
    lastReconcileAtMs,
    nowMs,
    intervalMs: RECONCILE_INTERVAL_MS,
    force,
  });
  if (!due) {
    return { status: "NOT_DUE", summary: lastSummary };
  }

  try {
    require("../services/dungeon/dungeonUniverseRuntime");
  } catch (error) {
    return { status: "UNAVAILABLE", reason: String(error && error.message || error) };
  }
  lastReconcileAtMs = nowMs;
  passJob = {
    systemIDs: [...ordered],
    index: 0,
    completed: 0,
    nowMs,
    rng: siteAllocationRng(nowMs),
    entrancePlan,
    created: 0,
    desired: 0,
    spawned: 0,
    anomalies: {},
    destinations: [],
    wormholes: null,
    reason: null,
  };
  schedulePassSlice();
  return { status: "SCHEDULED", systems: passJob.systemIDs.length, sliceSize: SLICE_SYSTEMS };
}

// A full pass builds definitions for every band and family. One pass was measured at 16-23 s of BLOCKED
// event loop, so the pass now runs in small slices on a 0 ms timer: the engine's sockets and timers run
// between slices and no single tick pays the whole price. Correctness never needed one tick - the seeder
// is idempotent per system and marks a system reconciled only when its slice really finished.
function schedulePassSlice() {
  if (!passJob || passTimer) return;
  passTimer = setTimeout(runPassSlice, SLICE_DELAY_MS);
}

function runPassSlice() {
  passTimer = null;
  const job = passJob;
  if (!job) return;
  const chunk = job.systemIDs.slice(job.index, job.index + SLICE_SYSTEMS);
  if (chunk.length === 0) return completePass(job);
  job.index += chunk.length;
  try {
    const runtime = require("../services/dungeon/dungeonUniverseRuntime");
    const summary = runtime.reconcileUniversePersistentSites({
      systemIDs: chunk,
      nowMs: job.nowMs,
      progressLabel: "coop world systems",
      logProgress: false,
      rng: job.rng,
    });
    job.created += Number(summary && summary.createdInstances) || 0;
    job.desired += Number(summary && summary.desiredSiteCount) || 0;
    job.completed += chunk.length;
    for (const id of chunk) reconciledSystemIDs.add(id);
    // A scene that already exists does not see an instance created afterwards: the site service only
    // materialises on scene creation. Re-run it for the awake scenes of this slice (addStaticEntity is
    // idempotent, so nothing is spawned twice).
    const materialized = materializeAwakeScenes(chunk);
    job.spawned += materialized.spawned;
    Object.assign(job.anomalies, materialized.anomalies);
    // Zombie agent-mission instances (a wave chain that can never advance) are
    // closed here, once per slice. A real site inside its stale window is never
    // touched, and a failed close is retried on the next pass.
    try {
      require("./coopMissionWavePacing").sweepStaleMissionInstances({ dungeonRuntime: runtime });
    } catch (_error) { /* the site pass must never fail because of the sweep */ }
  } catch (error) {
    job.reason = String((error && error.message) || error).slice(0, 120);
  }
  if (job.index < job.systemIDs.length) return schedulePassSlice();
  return completePass(job);
}

function completePass(job) {
  try {
    return finishPass(job);
  } catch (error) {
    // A pass that cannot finish must never leave the scheduler locked: the next
    // due check starts a fresh one and the reason stays visible.
    passJob = null;
    lastSummary = { status: "FAILED", reason: String((error && error.message) || error).slice(0, 120) };
    console.warn(`[CoopUniverseSites] ${lastSummary.reason}`);
    return lastSummary;
  }
}

function finishPass(job) {
  // Known space never scanned the K162 side of any wormhole, so J-space was unreachable. Open the
  // planned entrances (or a real wandering pair where none exists).
  try {
    job.wormholes = require("./coopWormholeEntrances").apply(job.entrancePlan, { nowMs: job.nowMs });
  } catch (_error) {
    job.wormholes = null;
  }
  // A newly opened hole may lead into a system that had no sites yet. Seed it in the SAME pass instead
  // of a second full call, so a player never scans a hole and lands in an empty system.
  const destinations = (job.wormholes && Array.isArray(job.wormholes.destinationSystemIDs)
    ? job.wormholes.destinationSystemIDs
    : []).filter((systemID) => !job.systemIDs.includes(systemID));
  const fresh = destinations.filter((systemID) => !reconciledSystemIDs.has(systemID));
  if (fresh.length > 0) {
    job.systemIDs.push(...fresh);
    job.destinations.push(...fresh);
    return schedulePassSlice();
  }
  // A destination that still has no instance is retried on the next pass (bounded), so a hole never
  // leads into an empty system just because one seeding call missed.
  settlePendingDestinations(destinations);
  lastSummary = {
    status: "RECONCILED",
    systems: job.completed,
    systemIDs: job.systemIDs,
    created: job.created,
    desired: job.desired,
    materialized: job.spawned,
    anomalies: job.anomalies,
    wormholes: job.wormholes,
    destinationSites: job.destinations.length > 0
      ? { systems: job.destinations.length }
      : null,
    ...(job.reason ? { reason: job.reason } : {}),
  };
  passJob = null;
  console.log(`[CoopUniverseSites] systems=${lastSummary.systemIDs.length} desired=${lastSummary.desired} ` +
    `created=${lastSummary.created} spawned=${lastSummary.materialized} anomalies=${JSON.stringify(lastSummary.anomalies)} ` +
    `wormholes=${lastSummary.wormholes ? lastSummary.wormholes.openedCount : "-"} ` +
    `${JSON.stringify(lastSummary.wormholes && lastSummary.wormholes.skipped || {})}`);
  return lastSummary;
}

function materializeAwakeScenes(systemIDs) {
  let spawned = 0;
  const anomalies = {};
  try {
    const runtime = require("./runtime");
    const siteService = require("../services/dungeon/dungeonUniverseSiteService");
    const signatures = require("../services/exploration/signatures/signatureRuntime");
    const scenes = runtime && runtime.scenes instanceof Map ? runtime.scenes : null;
    if (!scenes) return { spawned, anomalies };
    for (const systemID of systemIDs) {
      const scene = scenes.get(Number(systemID));
      if (!scene) continue;
      try {
        const result = siteService.handleSceneCreated(scene, { force: true });
        spawned += (result && result.data && Array.isArray(result.data.spawned))
          ? result.data.spawned.length
          : 0;
      } catch (_error) {
        /* one bad scene must not stop the others */
      }
      try {
        anomalies[systemID] = signatures.buildSignalTrackerAnomalyEntries(systemID).length;
      } catch (_error) {
        anomalies[systemID] = -1;
      }
    }
  } catch (_error) {
    return { spawned, anomalies };
  }
  return { spawned, anomalies };
}

// One snapshot for every pending destination. getStateSnapshot deep-clones the
// whole dungeon state: measured live, 167 ms for 6471 instances, and the old
// per-system call inside settlePendingDestinations paid that ~38 times in one
// universe-site pass (6.3 s of a 16 s pass, from a CPU profile).
function countInstancesBySystem() {
  try {
    const state = require("../services/dungeon/dungeonRuntimeState");
    const snapshot = state.getStateSnapshot();
    const counts = new Map();
    for (const row of Object.values(snapshot.instancesByID || {})) {
      const systemID = Math.max(0, Number(row && row.solarSystemID) || 0);
      if (systemID > 0) counts.set(systemID, (counts.get(systemID) || 0) + 1);
    }
    return counts;
  } catch (_error) {
    return null;
  }
}

function countInstancesForSystem(systemID) {
  const counts = countInstancesBySystem();
  return counts ? (counts.get(Math.max(0, Number(systemID) || 0)) || 0) : -1;
}

function settlePendingDestinations(systemIDs) {
  const pending = (systemIDs || [])
    .map((value) => Math.max(0, Number(value) || 0))
    .filter((systemID) => systemID > 0);
  if (pending.length === 0) return;
  const counts = countInstancesBySystem();
  for (const systemID of pending) {
    const count = counts ? (counts.get(systemID) || 0) : -1;
    if (count > 0) {
      pendingDestinationSystemIDs.delete(systemID);
      continue;
    }
    const attempts = (pendingDestinationSystemIDs.get(systemID) || 0) + 1;
    if (attempts > MAX_DESTINATION_RETRIES) {
      pendingDestinationSystemIDs.delete(systemID);
      continue;
    }
    pendingDestinationSystemIDs.set(systemID, attempts);
  }
}

function reset() {
  if (passTimer) clearTimeout(passTimer);
  passTimer = null;
  passJob = null;
  lastReconcileAtMs = 0;
  reconciledSystemIDs.clear();
  pendingDestinationSystemIDs.clear();
  lastSummary = null;
}

module.exports = {
  MAX_SYSTEMS,
  SAMPLE_PER_BAND,
  sampleBands,
  isWormholeSystemID,
  liveSceneSystemIDs,
  RECONCILE_INTERVAL_MS,
  enabled,
  materializeAwakeScenes,
  reconcile,
  reset,
  systemIDsOf,
};
