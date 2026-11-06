import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

// MEASURED 2026-11-06: the event-loop monitor reports a lag with heap numbers only, so a 1.2 s stall
// could not be tied to any world work. The lag record now carries the last completed world cycle
// (sequence, durationMs, slowPhases), so the stall and the phase that preceded it are read together.
const forkRoot = process.env.EVEJS_FORK_ROOT || "C:/Games/EveCoop/upstream-evejs";
const runtime = fs.readFileSync(path.join(
  forkRoot, "Code/server/src/space/coopVirtualWorldRuntime.js"), "utf8");

test("the lag record carries the last world cycle", () => {
  const start = runtime.indexOf("createMonitor({");
  assert.ok(start > 0, "the monitor must be created");
  const body = runtime.slice(start, runtime.indexOf("loopMonitor.start()", start));
  assert.match(body, /memory:\(\)=>Object\.assign\(require\("\.\/coopMemoryMetrics"\)\.memoryUsage\(\)/,
    "the heap numbers must stay");
  assert.match(body, /worldCycle:livingWorldPhases\(\)\.last/,
    "a stall must name the cycle that preceded it");
});

test("livingWorldPhases still answers a shaped snapshot when the world never ticked", () => {
  const match = runtime.match(/function livingWorldPhases\(\)\{([^}]*)\}/);
  assert.ok(match, "livingWorldPhases must exist");
  assert.match(match[1], /active:false,sequence:0,last:null/,
    "an untouched world must answer last:null rather than undefined");
});
