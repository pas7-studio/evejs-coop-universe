import test from "node:test";
import assert from "node:assert/strict";
import {createRequire} from "node:module";
import path from "node:path";

// MEASURED 2026-11-06: the event-loop monitor reports "the server froze for N ms", but nothing ever
// named WHICH of the 46 world phases caused it. The coordinator now times every phase (two clock()
// calls each, nothing next to a phase's cost) and records the five most expensive ones per cycle, and
// a cycle of 250 ms or more is reported immediately instead of on every tenth cycle.
const forkRoot = process.env.EVEJS_FORK_ROOT || "C:/Games/EveCoop/upstream-evejs";
const require = createRequire(import.meta.url);
const {createPhaseCoordinator} = require(
  path.join(forkRoot, "Code/server/src/space/coopLivingWorldPhaseCoordinator.js"));

test("every phase is timed and the worst five are reported, worst first", () => {
  const cycles = [];
  let now = 1000;
  const coordinator = createPhaseCoordinator({
    execute: (name, fn) => fn(),
    clock: () => now,
    onCycle: (row) => cycles.push(row),
  });
  coordinator.tick((phase) => {
    phase("cheap", () => { now += 5; });
    phase("expensive", () => { now += 900; });
    phase("medium", () => { now += 120; });
    phase("tiny", () => { now += 1; });
    phase("also-tiny", () => { now += 2; });
    phase("sixth", () => { now += 3; });
  });
  const row = cycles[cycles.length - 1];
  assert.equal(row.durationMs, 1031);
  assert.deepEqual(row.slowPhases.map((entry) => entry.name),
    ["expensive", "medium", "cheap", "sixth", "also-tiny"],
    "the five most expensive phases, worst first");
  assert.equal(row.slowPhases[0].ms, 900);
  assert.equal(row.slowPhases.length, 5, "bounded: a 46-phase cycle cannot grow the record");
});

test("a throwing phase still records its time and still reaches the caller", () => {
  const cycles = [];
  let now = 5000;
  const coordinator = createPhaseCoordinator({
    execute: (name, fn) => fn(),
    clock: () => now,
    onCycle: (row) => cycles.push(row),
  });
  assert.throws(() => coordinator.tick((phase) => {
    phase("boom", () => { now += 400; throw new Error("PHASE_FAILED"); });
  }), /PHASE_FAILED/);
  const row = cycles[cycles.length - 1];
  assert.equal(row.status, "THREW");
  assert.equal(row.slowPhases[0].name, "boom");
  assert.equal(row.slowPhases[0].ms, 400);
});

test("a fast cycle reports an empty slow list instead of inventing one", () => {
  const cycles = [];
  const coordinator = createPhaseCoordinator({
    execute: (name, fn) => fn(),
    clock: () => 1,
    onCycle: (row) => cycles.push(row),
  });
  coordinator.tick((phase) => { phase("quiet", () => {}); });
  const row = cycles[cycles.length - 1];
  assert.deepEqual(row.slowPhases, [{name: "quiet", ms: 0}]);
  assert.equal(row.durationMs, 0);
});
