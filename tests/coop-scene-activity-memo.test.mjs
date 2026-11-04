import test from "node:test";
import assert from "node:assert/strict";
import {createRequire} from "node:module";
import path from "node:path";

// MEASURED 2026-11-05 (live V8 profile, 2 219 s): npcSceneActivity.getSceneActivityState cost
// 22.86 s of CPU because every call walks every dynamic entity, every stargate and every NPC
// controller of a scene, and the scheduler calls it more than once per tick per scene. The
// memo below is the fix, extracted so it can be tested without the game store.
const forkRoot = process.env.EVEJS_FORK_ROOT || "C:/Games/EveCoop/upstream-evejs";
const require = createRequire(import.meta.url);
const {createSceneActivityMemo} = require(
  path.join(forkRoot, "Code/server/src/space/npc/sceneActivityMemo.js"));

test("the same stamp and session count reuse the answer; a new stamp recomputes", () => {
  const memo = createSceneActivityMemo();
  let calls = 0;
  const compute = (stamp, sessionCount) => {
    calls += 1;
    return {sceneNowMs: stamp, sessionCount, shouldTick: true, stampOfCall: calls};
  };
  const first = memo.get(1, 1000, 0, () => compute(1000, 0));
  const again = memo.get(1, 1000, 0, () => compute(1000, 0));
  assert.equal(calls, 1, "the second call inside the same tick is free");
  assert.equal(again, first, "and it is the very same answer object");
  const next = memo.get(1, 1016, 0, () => compute(1016, 0));
  assert.equal(calls, 2, "a new sim stamp recomputes");
  assert.equal(next.sceneNowMs, 1016);
});

test("a pilot arriving changes the answer even at the same stamp", () => {
  const memo = createSceneActivityMemo();
  const cold = memo.get(7, 5000, 0, () => ({sceneNowMs: 5000, sessionCount: 0, shouldTick: false}));
  assert.equal(cold.shouldTick, false);
  const warm = memo.get(7, 5000, 1, () => ({sceneNowMs: 5000, sessionCount: 1, shouldTick: true}));
  assert.equal(warm.shouldTick, true, "the session count is part of the key");
  assert.notEqual(warm, cold);
});

test("systems never share an answer, and the map stays bounded", () => {
  const memo = createSceneActivityMemo({limit: 4});
  for (let systemID = 1; systemID <= 10; systemID += 1) {
    const answer = memo.get(systemID, 900, 0,
      () => ({sceneNowMs: 900, sessionCount: 0, systemID}));
    assert.equal(answer.systemID, systemID);
  }
  assert.ok(memo.size <= 4, "the memo cannot grow with the number of systems");
  memo.clear();
  assert.equal(memo.size, 0);
});
