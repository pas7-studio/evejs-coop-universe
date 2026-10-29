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
  for (const fn of ["listNativeEntitiesForSystem", "listNativeModulesForEntity",
    "listNativeCargoForEntity"]) {
    const text = body(fn);
    assert.match(text, /readCollectionWhere\(/, `${fn} must filter inside the store`);
    assert.doesNotMatch(text, /listNative(Entities|Modules|Cargo)\(\)\s*\.filter/,
      `${fn} must not clone the whole collection and then filter it`);
  }
  // And the helper really clones, exactly once per returned row.
  assert.match(body("readCollectionRow"), /cloneValue\(row\)/);
  assert.match(body("readCollectionWhere"), /cloneValue\(row\)/);
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
