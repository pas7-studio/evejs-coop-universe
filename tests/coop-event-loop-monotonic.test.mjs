import test from "node:test";
import assert from "node:assert/strict";
import {createRequire} from "node:module";
import fs from "node:fs";
import path from "node:path";

// MEASURED 2026-11-06 inside the play-stack container: Date.now() stepped BACKWARDS by 2 277 ms in a
// single 20 s window (18 466 ms of wall time vs 20 743 ms of monotonic time) and by 2 342 ms in a 30 s
// window. A wall clock that steps makes the lag number either invented or hidden, and the event-loop
// monitor was built on it. The lag math now runs on performance.now() (monotonic); the event's `at`
// stays a real epoch timestamp so the log is still readable.
const forkRoot = process.env.EVEJS_FORK_ROOT || "C:/Games/EveCoop/upstream-evejs";
const require = createRequire(import.meta.url);
const monitorPath = path.join(forkRoot, "Code/server/src/space/coopEventLoopMonitor.js");
const monitorSource = fs.readFileSync(monitorPath, "utf8");
const {createMonitor} = require(monitorPath);

function harness(clock) {
  const reports = [];
  const monitor = createMonitor({
    sampleMs: 1000,
    thresholdMs: 250,
    observe: (event, detail) => reports.push({event, detail}),
    now: () => clock.value,
    setIntervalFn: () => ({unref() {}}),
  });
  monitor.start();
  return {monitor, reports};
}

test("a genuinely late timer is reported with its real lag", () => {
  const clock = {value: 0};
  const {monitor, reports} = harness(clock);
  clock.value = 1000; // on time
  monitor.tick();
  clock.value = 3400; // 1400 ms late for the tick due at 2000
  const report = monitor.tick();
  assert.equal(report.lagMs, 1400);
  assert.equal(reports.length, 1);
  assert.equal(reports[0].event, "coop-event-loop-lag");
});

test("the lag math runs on a monotonic clock, never on Date.now()", () => {
  assert.match(monitorSource, /performance\.now\(\)/,
    "performance.now() is the only clock that cannot step");
  assert.match(monitorSource, /now = monotonicNow/, "the default clock is the monotonic one");
  assert.doesNotMatch(monitorSource, /now = \(\) => Date\.now\(\)/,
    "a wall clock as the default is exactly the bug that was measured");
});

test("the reported timestamp stays a real epoch value, not a monotonic one", () => {
  const clock = {value: 0};
  const {monitor} = harness(clock);
  monitor.tick();
  clock.value = 2000;
  const report = monitor.tick();
  assert.ok(report.at > 1700000000000, "the event must carry a readable epoch time");
  assert.match(monitorSource, /const report = \{ lagMs, at: Date\.now\(\)/,
    "the epoch timestamp is written explicitly next to the monotonic lag");
});
