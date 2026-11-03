import test from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import path from "node:path";

// "Where does the memory go?" must be answerable by a name, not by staring at a heap graph.
const forkRoot = process.env.EVEJS_FORK_ROOT || "C:/Games/EveCoop/upstream-evejs";
const require = createRequire(import.meta.url);
const memoryMetrics = require(
  path.join(forkRoot, "Code/server/src/space/coopMemoryMetrics.js"),
);
const loopMonitor = require(
  path.join(forkRoot, "Code/server/src/space/coopEventLoopMonitor.js"),
);

test("memory metrics are opt-in", () => {
  assert.equal(memoryMetrics.enabled({}), false);
  assert.equal(memoryMetrics.enabled({ EVEJS_COOP_MEMORY_METRICS: "1" }), true);
});

test("a sample reports megabytes and the registries that can grow", () => {
  const sample = memoryMetrics.sample();
  for (const key of ["rssMB", "heapUsedMB", "heapTotalMB", "externalMB"]) {
    assert.equal(typeof sample[key], "number", `${key} must be a number`);
  }
  assert.equal(typeof sample.registries, "object");
  // Outside the server the registries are not loaded, so a size may be null; inside it is a number.
  assert.ok(
    sample.registries.nativeWrecks === null || typeof sample.registries.nativeWrecks === "number",
    "a registry size is a number, or null when the registry is unavailable",
  );
});

test("per-phase retained heap is aggregated and reset per window", () => {
  const phases = memoryMetrics.createPhaseMemory();
  phases.note("npc-reconcile:30000142", 3 * 1048576);
  phases.note("npc-reconcile:30000142", 1048576);
  phases.note("universe-sites", -2 * 1048576);
  const top = phases.top(2);
  assert.equal(top[0].phase, "npc-reconcile:30000142");
  assert.equal(top[0].calls, 2);
  assert.equal(top[0].retainedMB, 4);
  assert.equal(top[1].retainedMB, -2);
  phases.reset();
  assert.deepEqual(phases.top(2), []);
});

test("the event-loop monitor reports only real stalls", () => {
  const reports = [];
  let nowMs = 1000;
  const monitor = loopMonitor.createMonitor({
    sampleMs: 1000,
    thresholdMs: 250,
    now: () => nowMs,
    observe: (event, detail) => reports.push({ event, ...detail }),
    memory: () => ({ heapUsedMB: 1200 }),
    setIntervalFn: () => ({ unref() {} }),
  });
  monitor.start();
  nowMs += 1050; // fired 50 ms late: noise, not a stall
  assert.equal(monitor.tick(), null);
  assert.equal(reports.length, 0);
  nowMs += 3000; // three seconds late: a real freeze
  const report = monitor.tick();
  assert.equal(report.lagMs, 2000, "lag is measured against the expected firing time");
  assert.equal(reports.length, 1);
  assert.equal(reports[0].event, "coop-event-loop-lag");
  assert.equal(reports[0].heapUsedMB, 1200);
});
