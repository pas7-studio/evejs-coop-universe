import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

// MEASURED 2026-11-06 in the live server (inspector, no restart): the allocation sampler put
// 402 MB/min in listUniverseSeededPersistentSiteInstances and 189 MB/min in the per-instance family
// key read right after it, on an idle server with the owner docked. The cause is a per-family,
// per-band plan that listed ALL 8 491 universe-seeded instances (5.3 ms: walk, Map, sort) and only
// then filtered by a candidate system set it already had. Handing the candidates to the list makes
// it filter before the Map and the sort (measured ~1.5 ms) and cuts the rows the getSecurityBand()
// filter visits from 8 491 to a few hundred.
const forkRoot = process.env.EVEJS_FORK_ROOT || "C:/Games/EveCoop/upstream-evejs";
const source = fs.readFileSync(
  path.join(forkRoot, "Code/server/src/services/dungeon/dungeonUniverseRuntime.js"), "utf8");

function body(startMarker, endMarker) {
  const start = source.indexOf(startMarker);
  assert.ok(start > 0, "missing " + startMarker);
  const end = source.indexOf(endMarker, start);
  assert.ok(end > start, "missing " + endMarker);
  return source.slice(start, end);
}

test("the per-family plan hands its candidate systems to the universe list", () => {
  const fn = body("function listActiveRandomAllocatedInstances(", "function buildRandomAllocatedSystemPlanForBand(");
  assert.match(fn, /listUniverseSeededPersistentSiteInstances\(\[\.\.\.candidateSet\]\)/,
    "the list must be narrowed BEFORE it builds a Map and sorts 8 491 rows");
  assert.doesNotMatch(fn, /listUniverseSeededPersistentSiteInstances\(\)/,
    "an unfiltered 5.3 ms scan per family per band is what the heap sampler measured");
});

test("the candidate filter is still applied, so the narrowed list cannot widen the answer", () => {
  const fn = body("function listActiveRandomAllocatedInstances(", "function buildRandomAllocatedSystemPlanForBand(");
  assert.match(fn, /candidateSet\.has\(Math\.max\(0, toInt\(instance && instance\.solarSystemID, 0\)\)\)/,
    "an empty candidate list must still answer [] rather than every instance");
});
