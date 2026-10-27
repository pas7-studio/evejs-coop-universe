import test from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const { createMetrics, enabled, timePhase } = require("../integration/coopPerfMetrics.cjs");

test("percentiles come from the real samples", () => {
  const m = createMetrics({ window: 100, now: () => 0 });
  for (const ms of [1, 2, 3, 4, 5]) m.observe("phase-a", ms);
  const [row] = m.snapshot();
  assert.equal(row.phase, "phase-a");
  assert.equal(row.count, 5);
  assert.equal(row.avgMs, 3);
  assert.equal(row.p50Ms, 3);
  assert.equal(row.maxMs, 5);
});

test("the ring buffer is bounded so instrumentation cannot leak", () => {
  const m = createMetrics({ window: 3, now: () => 0 });
  for (let i = 0; i < 100; i += 1) m.observe("phase-b", i);
  const [row] = m.snapshot();
  assert.equal(row.count, 100, "count is cumulative");
  assert.equal(row.samples, 3, "only the window is retained");
});

test("rows are ordered by average cost, which is what an optimisation targets", () => {
  const m = createMetrics({ window: 10, now: () => 0 });
  m.observe("cheap", 1);
  m.observe("expensive", 50);
  m.observe("middle", 10);
  assert.deepEqual(m.snapshot().map((r) => r.phase), ["expensive", "middle", "cheap"]);
  assert.deepEqual(m.top(2).map((r) => r.phase), ["expensive", "middle"]);
});

test("non-numeric or negative durations are ignored instead of poisoning the average", () => {
  const m = createMetrics({ window: 10, now: () => 0 });
  m.observe("phase-c", 4);
  m.observe("phase-c", Number.NaN);
  m.observe("phase-c", -1);
  m.observe("phase-c", "nope");
  assert.equal(m.snapshot()[0].count, 1);
});

test("timePhase rethrows the original error unchanged and is inert when disabled", () => {
  const previous = process.env.EVEJS_COOP_PERF_METRICS;
  try {
    process.env.EVEJS_COOP_PERF_METRICS = "0";
    assert.equal(enabled(), false);
    assert.equal(timePhase("x", () => 7), 7);
    process.env.EVEJS_COOP_PERF_METRICS = "1";
    assert.equal(enabled(), true);
    assert.equal(timePhase("x", () => 7), 7);
    assert.throws(() => timePhase("boom", () => { throw new Error("real failure"); }), /real failure/);
  } finally {
    if (previous === undefined) delete process.env.EVEJS_COOP_PERF_METRICS;
    else process.env.EVEJS_COOP_PERF_METRICS = previous;
  }
});
