import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

// MEASURED 2026-11-06 in the live server (inspector, no restart): the wormhole runtime state holds
// 41 825 pairs and ONE cloneRuntimeState costs 49.5 ms; the heap sampler charged 94 MB of garbage per
// minute to it. mutateState cloned the whole state before every mutation purely to keep the mirror
// pristine if the mutation failed - but the persisted table is the authority, so dropping the mirror
// (cache = null, reload on next read) gives the same guarantee for free.
const forkRoot = process.env.EVEJS_FORK_ROOT || "C:/Games/EveCoop/upstream-evejs";
const source = fs.readFileSync(path.join(
  forkRoot, "Code/server/src/services/exploration/wormholes/wormholeRuntimeState.js"), "utf8");

function block(startMarker, endMarker) {
  const start = source.indexOf(startMarker);
  assert.ok(start > 0, "missing " + startMarker);
  const end = source.indexOf(endMarker, start);
  assert.ok(end > start, "missing " + endMarker);
  return source.slice(start, end);
}

test("a mutation does not clone the whole state first", () => {
  const body = block("function mutateState(", "function getStateSnapshot(");
  assert.doesNotMatch(body, /cloneRuntimeState\(/,
    "41 825 pairs at 49.5 ms per clone is the 94 MB/min the sampler found");
  assert.match(body, /const current = loadState\(\);/,
    "the mutation runs against the live mirror");
});

test("a failed mutation drops the mirror so the next read reloads the authority", () => {
  const body = block("function mutateState(", "function getStateSnapshot(");
  assert.match(body, /catch \(error\) \{\s*cache = null;\s*throw error;/,
    "a throwing mutator must not leave a half-mutated mirror behind");
  assert.match(body, /if \(!success\) \{\s*cache = null;/,
    "a write that does not acknowledge must drop the mirror too");
});

test("the cloning accessor is still published for callers that mutate what they get", () => {
  assert.match(source, /function getStateSnapshot\(\) \{\s*return cloneRuntimeState\(loadState\(\)\);/);
});
