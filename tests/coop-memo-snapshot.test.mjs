import test from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import path from "node:path";

// Live regression 2026-11-03: the garrison phase threw "Cannot assign to read
// only property 'snapshot'" on every tick, so no war garrison was ever refilled.
// The memo wrapper was built with Object.create(frozenRegistry) and then assigned
// `snapshot`, which strict mode refuses when the inherited property is read-only.
const forkRoot = process.env.EVEJS_FORK_ROOT || "C:/Games/EveCoop/upstream-evejs";
const require = createRequire(import.meta.url);
const { wrapSnapshot } = require(
  path.join(forkRoot, "Code/server/src/space/coopMemoSnapshot.js"));

test("a frozen registry can still be memo-wrapped", () => {
  const registry = Object.freeze({
    snapshot: () => ({ hulls: { a: 1 } }),
    claim: () => "claimed",
    execute: () => "executed",
  });
  const wrapper = wrapSnapshot(registry, (source) => source.snapshot());

  assert.notEqual(wrapper, registry);
  assert.deepEqual(wrapper.snapshot(), { hulls: { a: 1 } });
  // the rest of the registry still answers through the copy
  assert.equal(wrapper.claim(), "claimed");
  assert.equal(wrapper.execute(), "executed");
  // and the source is untouched
  assert.equal(Object.isFrozen(registry), true);
});

test("the wrapper caches through the caller's reader, not by itself", () => {
  let reads = 0;
  const registry = Object.freeze({ snapshot: () => ({ n: ++reads }) });
  const wrapper = wrapSnapshot(registry, (source) => source.snapshot());

  assert.deepEqual(wrapper.snapshot(), { n: 1 });
  assert.deepEqual(wrapper.snapshot(), { n: 2 });
  assert.equal(reads, 2);
});

test("a throwing or missing snapshot never takes the caller down", () => {
  const throwing = wrapSnapshot(Object.freeze({
    snapshot: () => { throw new Error("boom"); },
  }), (source) => source.snapshot());
  assert.deepEqual(throwing.snapshot(), {});

  const missing = wrapSnapshot(Object.freeze({ claim: () => 1 }), (source) => source.snapshot());
  assert.deepEqual(missing.snapshot(), {});
  assert.equal(missing.claim(), 1);
});
