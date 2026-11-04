// FW-097 guard: a per-entity read must not clone the whole world.
//
// Measured 2026-10-29 with a CPU profile taken on the LIVE play server (inspector
// started with SIGUSR1; 9 s window, 12 164 samples, 500 us interval):
//
//   7 374 ms  cloneValue        nativeNpcStore.js:54    <-- 82 % of the process
//   1 009 ms  listNativeCargo   nativeNpcStore.js:277
//
// Cause: getNativeEntity(id) and listNativeCargoForEntity(id) deep-cloned the ENTIRE
// collection and only then picked the row they were asked for, and the A-Life haul
// pass calls the latter once per miner per tick.
//
// The fix is pinned here at source level, the way the allocator fix is pinned,
// because the store talks to the live gameStore: what matters is that a per-entity
// read scans the cache and clones ONLY the rows it returns, while still never
// handing out a cache reference (database.read returns the live cache object).
import test from "node:test";
import assert from "node:assert/strict";
import { engineSource, skipWithoutEngine } from "./_support/engineCheckout.mjs";

const source = engineSource("server/src/space/npc/nativeNpcStore.js");
const skipped = skipWithoutEngine(test, source);

const body = (name) => {
  const start = source.indexOf(`function ${name}(`);
  assert.ok(start > 0, `${name} must exist in the deployed store`);
  const end = source.indexOf("\n}", start);
  return source.slice(start, end > 0 ? end : source.length);
};

test("per-entity reads scan the cache and clone only the rows they return", { skip: skipped }, () => {
  assert.match(body("getNativeEntity"), /readCollectionRow\(/,
    "getNativeEntity must read ONE row, not clone the whole entity collection");
  // Two acceptable implementations, both of which keep the property that matters: the row is
  // selected inside the store (by entity) and only the returned rows are cloned.
  //   readCollectionWhere - a scan, used where an index would be wasted;
  //   cachedRowsForEntity - the per-entity index added later for the per-tick haul pass.
  for (const fn of ["listNativeEntitiesForSystem", "listNativeModulesForEntity",
    "listNativeCargoForEntity"]) {
    const text = body(fn);
    assert.match(text, /readCollectionWhere\(|cachedRowsForEntity\(/,
      `${fn} must filter inside the store`);
    assert.doesNotMatch(text, /listNative(Entities|Modules|Cargo)\(\)\s*\.filter/,
      `${fn} must not clone the whole collection and then filter it`);
  }
  // And the helpers really clone, exactly once per returned row - never a cache reference.
  assert.match(body("readCollectionRow"), /cloneValue\(row\)/);
  assert.match(body("readCollectionWhere"), /cloneValue\(row\)/);
  const indexed = body("cachedRowsForEntity");
  assert.match(indexed, /cloneValue\(row\)/, "the indexed read clones what it returns");
  assert.doesNotMatch(indexed, /readCollection\(/, "the indexed read never clones the table");
  const indexer = body("entityIndexFor");
  assert.match(indexer, /entityRowIndex/, "the entity index is cached, not rebuilt per call");
  assert.match(indexer, /row\.entityID/, "and it buckets rows by their own entityID");
});

test("the cache is still protected: bulk reads and returned rows are clones", { skip: skipped }, () => {
  assert.match(body("readCollection"), /cloneValue\(rawCollection\(/,
    "readCollection must keep returning a clone of the cache");
  const row = body("readCollectionRow");
  assert.doesNotMatch(row, /return row;/, "never hand out the cache object itself");
  // The historical ordering of the full list calls is preserved.
  assert.match(body("listNativeEntitiesForSystem"), /entityID \|\| 0\) - Number\(right\.entityID/);
  assert.match(body("listNativeCargoForEntity"), /cargoID \|\| 0\) - Number\(right\.cargoID/);
});
