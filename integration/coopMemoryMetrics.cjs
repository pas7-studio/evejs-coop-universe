"use strict";
// Where does the memory really go?
//
// The server has no honest answer to that today: the heap jumped to 4.3 GB and the only visible symptom was an
// 8-second GC pause. A single RSS number is not a diagnosis. This module records, per world phase, how much heap
// that phase allocated and kept, and periodically writes the live size of every registry the world keeps in memory
// (native entities, controllers, wrecks, scenes, dungeon instances, identity links, caches), so growth can be
// attributed to a name instead of guessed from a graph.
//
// Opt-in: EVEJS_COOP_MEMORY_METRICS=1. Every sample goes through coopRuntimeProbe as "coop-memory-sample".
const enabled = (env = process.env) => String((env && env.EVEJS_COOP_MEMORY_METRICS) || "") === "1";

// The GC observer starts when this module is loaded (the runtime requires it at boot whether or not
// sampling is on), so a lag event can carry the pause that caused it instead of only the heap size.
const gcWatch = require("./coopGcWatch");
gcWatch.start();

function bytesToMb(bytes) {
  return Math.round((Number(bytes) || 0) / 1048576 * 10) / 10;
}

function memoryUsage() {
  const usage = typeof process.memoryUsage === "function" ? process.memoryUsage() : {};
  return {
    rssMB: bytesToMb(usage.rss),
    heapUsedMB: bytesToMb(usage.heapUsed),
    heapTotalMB: bytesToMb(usage.heapTotal),
    externalMB: bytesToMb(usage.external),
    arrayBuffersMB: bytesToMb(usage.arrayBuffers),
    gc: gcWatch.snapshot(),
  };
}

// Per-phase retained-heap deltas. "Retained" is the difference after the phase ran, so a phase that allocates and
// frees stays near zero while a phase that caches something shows up. Calls are bounded by the phase count, which
// is small (tens), and the totals are reset on every sample so the numbers always describe the last window.
function createPhaseMemory() {
  const totals = new Map();
  return {
    note(name, deltaBytes) {
      const key = String(name || "unknown");
      const entry = totals.get(key) || { calls: 0, retainedBytes: 0, peakBytes: 0 };
      entry.calls += 1;
      entry.retainedBytes += Number(deltaBytes) || 0;
      if (Number(deltaBytes) > entry.peakBytes) entry.peakBytes = Number(deltaBytes) || 0;
      totals.set(key, entry);
    },
    top(limit = 8) {
      return [...totals.entries()]
        .map(([phase, entry]) => ({
          phase,
          calls: entry.calls,
          retainedMB: bytesToMb(entry.retainedBytes),
          peakMB: bytesToMb(entry.peakBytes),
        }))
        .sort((left, right) => right.retainedMB - left.retainedMB)
        .slice(0, Math.max(1, limit));
    },
    reset() {
      totals.clear();
    },
  };
}

function countOf(loader) {
  try {
    const value = loader();
    if (typeof value === "number") return value;
    if (Array.isArray(value)) return value.length;
    if (value && typeof value.size === "number") return value.size;
    if (value && typeof value === "object") return Object.keys(value).length;
    return 0;
  } catch (_error) {
    return null;
  }
}

// The registries that own long-lived records. A leak in this world is almost always one of these growing past what
// the live world actually needs (a wreck per kill, a controller per spawn, a scene per visited system).
function registrySizes() {
  const path = require("path");
  const space = __dirname;
  return {
    // Counters, not listers: each lister deep-clones its whole collection, and this sampler runs
    // once a minute for a number.
    nativeEntities: countOf(() => require(path.join(space, "npc/nativeNpcStore")).countNativeEntities()),
    nativeControllers: countOf(() => require(path.join(space, "npc/nativeNpcStore")).countNativeControllers()),
    nativeWrecks: countOf(() => require(path.join(space, "npc/nativeNpcStore")).countNativeWrecks()),
    scenes: countOf(() => {
      const runtime = require(path.join(space, "runtime"));
      return runtime && runtime.scenes instanceof Map ? runtime.scenes.size : 0;
    }),
    dungeonInstances: countOf(() => {
      const state = require(path.join(space, "..", "services/dungeon/dungeonRuntimeState"));
      // getStateSnapshot() deep-clones all ~8 700 instances (~1.5 s); the count does not.
      return typeof state.getInstanceCount === "function" ? state.getInstanceCount() : 0;
    }),
    identityLinks: countOf(() => {
      const registry = require(path.join(space, "coopIdentityRegistry"));
      return registry && typeof registry.snapshot === "function" ? Object.keys(registry.snapshot().links || {}).length : 0;
    }),
    warFleetHulls: countOf(() => {
      const registry = require(path.join(space, "coopWarFleetRegistry"));
      return registry && typeof registry.snapshot === "function" ? Object.keys(registry.snapshot().hulls || {}).length : 0;
    }),
  };
}

function sample({ phaseMemory = null, top = 8 } = {}) {
  return {
    ...memoryUsage(),
    registries: registrySizes(),
    phases: phaseMemory && typeof phaseMemory.top === "function" ? phaseMemory.top(top) : [],
  };
}

module.exports = {
  enabled,
  createPhaseMemory,
  memoryUsage,
  registrySizes,
  sample,
  bytesToMb,
};
