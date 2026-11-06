import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

// MEASURED 2026-11-06 with the live heap sampler (idle play stack, 60 s, 32 KB): 92 MB of garbage per
// minute was charged to wormholeRuntimeState.cloneRuntimeState, because the signature count pass deep
// cloned the ENTIRE wormhole state just to iterate its pairs. The module already publishes
// getStateView() - the same state without the copy - and every other read-only consumer uses it.
const forkRoot = process.env.EVEJS_FORK_ROOT || "C:/Games/EveCoop/upstream-evejs";
const cacheMgr = fs.readFileSync(path.join(
  forkRoot, "Code/server/src/services/dungeon/dungeonInstanceCacheMgrService.js"), "utf8");
const stateModule = fs.readFileSync(path.join(
  forkRoot, "Code/server/src/services/exploration/wormholes/wormholeRuntimeState.js"), "utf8");

test("the signature count pass reads the view, not a deep clone of the whole state", () => {
  const start = cacheMgr.indexOf("function addVisibleWormholeSignatureCounts(");
  assert.ok(start > 0, "the count pass must exist");
  const body = cacheMgr.slice(start, cacheMgr.indexOf("function buildSignatureCountDict("));
  assert.match(body, /getStateView\(\)/,
    "a read-only loop must use the published view");
  assert.doesNotMatch(body, /=\s*wormholeRuntimeState\.getStateSnapshot\(\)/,
    "getStateSnapshot() deep clones every pair and endpoint for a loop that only reads");
});

test("the view really is copy-free and the snapshot still exists for writers", () => {
  assert.match(stateModule, /function getStateView\(\) \{\s*return loadState\(\);/,
    "the view must hand back the live state, not a clone");
  assert.match(stateModule, /function getStateSnapshot\(\) \{\s*return cloneRuntimeState\(loadState\(\)\);/,
    "the cloning accessor stays for callers that mutate what they get");
});
