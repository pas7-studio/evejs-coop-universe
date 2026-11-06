import test from "node:test";
import assert from "node:assert/strict";
import {createRequire} from "node:module";
import path from "node:path";

// MEASURED 2026-11-06 with a live V8 profile of the play stack: npcSceneActivity's stargate
// deadline scan was ~100% of getSceneActivityState's cost (2.14 s of self time per 120 s plus
// 0.97 s in the memo closure), because it walked every static entity of a scene (up to ~3 800
// rows) to find a handful of stargates - and the scheduler asks hundreds of times a second.
// The selection is now cached per scene; the timestamps are still read live.
const forkRoot = process.env.EVEJS_FORK_ROOT || "C:/Games/EveCoop/upstream-evejs";
const require = createRequire(import.meta.url);
const {createStargateIndex} = require(
  path.join(forkRoot, "Code/server/src/space/npc/sceneStargateIndex.js"));

function scene(statics) {
  return {systemID: 30000144, staticEntities: statics};
}

test("only stargates are selected, and the list is reused inside the same scene", () => {
  const index = createStargateIndex();
  const gate = {kind: "stargate", itemID: 1, activationTransitionAtMs: 500};
  const station = {kind: "station", itemID: 2};
  const fake = scene([station, gate, {kind: "planet", itemID: 3}]);
  const first = index.stargatesOf(fake);
  assert.deepEqual(first, [gate]);
  assert.equal(index.stargatesOf(fake), first, "the same scene reuses the same list");
});

test("a replaced static array is rebuilt instead of answered from the old list", () => {
  const index = createStargateIndex();
  const fake = scene([{kind: "stargate", itemID: 1}]);
  const before = index.stargatesOf(fake);
  fake.staticEntities = [{kind: "stargate", itemID: 4}, {kind: "stargate", itemID: 5}];
  const after = index.stargatesOf(fake);
  assert.notEqual(after, before);
  assert.deepEqual(after.map((row) => row.itemID), [4, 5]);
});

test("the timestamps stay live: the cached list never freezes a deadline", () => {
  const index = createStargateIndex();
  const gate = {kind: "stargate", itemID: 1, activationTransitionAtMs: 1000};
  const fake = scene([gate]);
  index.stargatesOf(fake);
  gate.activationTransitionAtMs = 42;
  const deadlines = index.stargatesOf(fake).map((row) => row.activationTransitionAtMs);
  assert.deepEqual(deadlines, [42], "a changed transition is visible through the cached list");
});

test("a scene without statics answers null, never an invented list", () => {
  const index = createStargateIndex();
  assert.equal(index.stargatesOf(null), null);
  assert.equal(index.stargatesOf({}), null);
  assert.equal(index.stargatesOf({staticEntities: null}), null);
});
