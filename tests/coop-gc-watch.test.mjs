import test from "node:test";
import assert from "node:assert/strict";
import {createRequire} from "node:module";
import path from "node:path";

// MEASURED 2026-11-06: the event-loop monitor reported 1.6-3.8 s lags while the whole 46-phase world
// cycle was 226-1871 ms, and the lag record could only show the heap SIZE - never a GC duration - so
// "probably GC" stayed a guess. node:perf_hooks publishes every GC with its duration; this module keeps
// the last and the worst so the lag record can name the pause.
const forkRoot = process.env.EVEJS_FORK_ROOT || "C:/Games/EveCoop/upstream-evejs";
const require = createRequire(import.meta.url);
const gcWatch = require(path.join(forkRoot, "Code/server/src/space/coopGcWatch.js"));

test("a GC entry is recorded with its kind and duration", () => {
  gcWatch.reset();
  gcWatch.record({duration: 0.842, detail: {kind: 1}});
  const snapshot = gcWatch.snapshot();
  assert.equal(snapshot.last.kind, "scavenge", "kind 1 is a scavenge");
  assert.equal(snapshot.last.durationMs, 0.8);
  assert.equal(snapshot.count, 1);
});

test("the worst pause in the window is kept, not just the latest", () => {
  gcWatch.reset();
  gcWatch.record({duration: 0.4, detail: {kind: 1}});
  gcWatch.record({duration: 1.42, detail: {kind: 4}});
  gcWatch.record({duration: 0.2, detail: {kind: 1}});
  const snapshot = gcWatch.snapshot();
  assert.equal(snapshot.last.durationMs, 0.2, "the latest pause is the last one");
  assert.equal(snapshot.worst.durationMs, 1.4, "the worst pause survives later small ones");
  assert.equal(snapshot.worst.kind, "major", "kind 4 is a major collection");
  assert.equal(snapshot.count, 3);
});

test("a zero-length or malformed entry never becomes a pause", () => {
  gcWatch.reset();
  gcWatch.record({duration: 0, detail: {kind: 1}});
  gcWatch.record({});
  assert.equal(gcWatch.snapshot().count, 0);
  assert.equal(gcWatch.snapshot().last, null);
});

test("the memory usage record carries the GC snapshot", () => {
  const metrics = require(path.join(forkRoot, "Code/server/src/space/coopMemoryMetrics.js"));
  const usage = metrics.memoryUsage();
  assert.ok(usage.gc && typeof usage.gc === "object", "a lag record must be able to name the pause");
  assert.equal(typeof usage.gc.count, "number");
});
