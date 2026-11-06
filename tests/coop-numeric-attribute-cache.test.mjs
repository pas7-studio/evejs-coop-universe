import test from "node:test";
import assert from "node:assert/strict";
import {createRequire} from "node:module";
import path from "node:path";

// MEASURED 2026-11-06 with the live heap sampler on the play stack (owner docked, 60 s, 32 KB
// sampling): readShipBaseAttributeMap was 113 MB of garbage per minute and part of the 147 MB/min in
// buildShipResourceState was the same normalisation of static type dogma attributes. Both answers are
// computed from static tables, so they are cached per type and copied per call - the copy matters,
// because callers extend the map they receive.
const forkRoot = process.env.EVEJS_FORK_ROOT || "C:/Games/EveCoop/upstream-evejs";
const require = createRequire(import.meta.url);
const {createNumericAttributePairsCache} = require(
  path.join(forkRoot, "Code/server/src/services/fitting/numericAttributePairs.js"));

test("a type is normalised once and served from the cache afterwards", () => {
  const cache = createNumericAttributePairsCache();
  let calls = 0;
  const source = {"37": "100", "48": 250, "55": "not a number", junk: 5};
  const first = cache.pairsFor("base:1", () => { calls += 1; return source; });
  const second = cache.pairsFor("base:1", () => { calls += 1; return source; });
  assert.equal(calls, 1, "the static table is read once per type");
  assert.equal(first, second, "the same pairs array is reused");
  assert.deepEqual(first, [[37, 100], [48, 250]],
    "non-numeric and non-integer entries are dropped, exactly like the inline version");
});

test("every call gets its own map, because callers extend it", () => {
  const cache = createNumericAttributePairsCache();
  const pairs = cache.pairsFor("base:2", () => ({37: 100}));
  const first = cache.toMap(pairs);
  first[48] = 250;
  const second = cache.toMap(pairs);
  assert.deepEqual(second, {37: 100}, "a mutation of one answer must not leak into the next");
});

test("an attribute-less type is not remembered as attribute-less", () => {
  const cache = createNumericAttributePairsCache();
  let loaded = false;
  const empty = cache.pairsFor("base:3", () => (loaded ? {} : {}));
  assert.deepEqual(empty, []);
  loaded = true;
  const later = cache.pairsFor("base:3", () => ({37: 100}));
  assert.deepEqual(later, [[37, 100]],
    "a type whose static table appears later must still be able to answer");
});

test("a failing source answers empty instead of throwing, and the cache stays bounded", () => {
  const cache = createNumericAttributePairsCache({limit: 2});
  assert.deepEqual(cache.pairsFor("base:4", () => { throw new Error("STORE_DOWN"); }), []);
  for (const key of ["a", "b", "c"]) cache.pairsFor(key, () => ({37: 1}));
  assert.ok(cache.size <= 2, "the cache cannot grow with the number of types");
});
