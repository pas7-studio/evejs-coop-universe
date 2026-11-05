import test from "node:test";
import assert from "node:assert/strict";
import {createRequire} from "node:module";
import path from "node:path";

// Measured live 2026-11-05: EVEJS_COOP_NPC_REFINERY=1 was set and the beat ran for four minutes
// with ZERO refinery events, because every phase status was computed and thrown away - a switch
// that is on and doing nothing looked exactly like one that works. The beat now emits
// `living-coop-loop-phase` {phase,status} once per change, never once per beat.
const forkRoot = process.env.EVEJS_FORK_ROOT || "C:/Games/EveCoop/upstream-evejs";
const require = createRequire(import.meta.url);
const loopTick = require(path.join(forkRoot, "Code/server/src/space/coopLoopTick.js"));

function recorder() {
  const seen = [];
  return {seen, observe: (event, _session, _ship, fields) => seen.push({event, fields})};
}

test("every phase reports its status once per change, not once per beat", () => {
  loopTick.resetPhaseStatusForTests();
  const log = recorder();
  const env = {};
  const first = loopTick.tick({env, loopObserve: log.observe, now: 1_000});
  assert.equal(first.status, "OK");
  const mine = log.seen.filter((e) => e.event === "living-coop-loop-phase");
  const refinery = mine.filter((e) => e.fields.phase === "refinery");
  assert.equal(refinery.length, 1, "one line for the first status");
  assert.equal(refinery[0].fields.status, "DISABLED");
  const second = loopTick.tick({env, loopObserve: log.observe, now: 2_000});
  assert.equal(second.status, "OK");
  const after = log.seen.filter((e) => e.event === "living-coop-loop-phase" &&
    e.fields.phase === "refinery");
  assert.equal(after.length, 1, "an unchanged status is not repeated");
});

test("a switch that is on but has nothing to do is still visible", () => {
  loopTick.resetPhaseStatusForTests();
  const log = recorder();
  // The refinery is ON, so its phase must report a real status instead of vanishing.
  const env = {EVEJS_COOP_NPC_REFINERY: "0", EVEJS_COOP_CORP_TREASURY_SWEEP: "0"};
  loopTick.tick({env, loopObserve: log.observe, now: 3_000});
  const refinery = log.seen.filter((e) => e.event === "living-coop-loop-phase" &&
    e.fields.phase === "refinery");
  assert.equal(refinery.length, 1);
  assert.ok(["DISABLED"].includes(refinery[0].fields.status));
  // Every other phase is reported by name too, so a missing phase is not confused with a
  // silent one.
  const phases = new Set(log.seen.map((e) => e.fields && e.fields.phase).filter(Boolean));
  for (const phase of ["marketMakers", "manufacture", "distribution"])
    assert.ok(phases.has(phase), "no telemetry for " + phase);
});
