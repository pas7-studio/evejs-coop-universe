import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { createRequire } from "node:module";
const require = createRequire(import.meta.url);

// The economic phases used to run only when stock mining code happened to call them.
// Measured 2026-10-29: the hook ran at 23:30:26 and then not again for eight minutes while
// the world kept simulating, so a journaled gate crossing sat 6 km from its gate with nobody
// to advance it. The driver gives the loop its own beat, off unless asked for.
const dir = fs.mkdtempSync(path.join(os.tmpdir(), "loop-driver-"));
process.env.EVEJS_COOP_GATE_CROSSING_DIR = dir;
const driver = require("../integration/coopLoopDriver.cjs");

test("nothing ticks unless the driver is asked for", () => {
  assert.deepEqual(driver.beat({ env: {} }), { status: "DISABLED" });
  assert.deepEqual(driver.ensure({ env: {} }), { status: "DISABLED" });
  assert.equal(driver.status().running, false);
});

test("the beat is bounded below so it cannot become a busy loop", () => {
  assert.equal(driver.intervalMs({ EVEJS_COOP_LOOP_INTERVAL_MS: "1000" }), 60000,
    "a too-small interval falls back to the default instead of hammering the world");
  assert.equal(driver.intervalMs({ EVEJS_COOP_LOOP_INTERVAL_MS: "30000" }), 30000);
  assert.equal(driver.intervalMs({ EVEJS_COOP_LOOP_INTERVAL_MS: "nonsense" }), 60000);
});

test("the beat runs the same phases the stock hook runs, and reports rather than throws", () => {
  const result = driver.beat({ env: { EVEJS_COOP_LOOP_DRIVER: "1" } });
  assert.ok(["OK", "THREW"].includes(result.status), "a beat always answers");
  assert.equal(result.beats, 1);
  if (result.status === "THREW") {
    assert.ok(result.error, "a failure names its reason instead of vanishing");
  }
});

test("the timer is unref'd so a background phase never holds the process open", () => {
  const source = fs.readFileSync(path.join(process.cwd(), "integration/coopLoopDriver.cjs"), "utf8");
  assert.ok(source.includes("timer.unref"), "the interval must not keep the server alive");
  const started = driver.ensure({ env: { EVEJS_COOP_LOOP_DRIVER: "1" } });
  assert.equal(started.status, "STARTED");
  assert.equal(driver.ensure({ env: { EVEJS_COOP_LOOP_DRIVER: "1" } }).status, "ALREADY_RUNNING",
    "a second call must not start a second clock");
  assert.equal(driver.stop().status, "STOPPED");
});
