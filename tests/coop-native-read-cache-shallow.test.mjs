import test from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import path from "node:path";
import fs from "node:fs";

// The native read cache exists because the pinned store re-reads and deep-clones
// a whole collection per call. A 60 s CPU profile of the live server put 3.8 s
// in that clone path alone (plan -> allCargoRows -> listNativeCargo ->
// readCollection), paid once per cache window. The cache now reads the store's
// non-cloning enumeration and shallow-copies each row itself.
const forkRoot = process.env.EVEJS_FORK_ROOT || "C:/Games/EveCoop/upstream-evejs";
const require = createRequire(import.meta.url);
const { createCache } = require(
  path.join(forkRoot, "Code/server/src/space/coopNativeReadCache.js"));

test("cargo rows are shallow copies, so a read-only planner cannot mutate the store", () => {
  const source = [{ cargoID: 1, entityID: 500, ownerID: 7, quantity: 100 }];
  const cache = createCache({
    listNativeEntities: () => [],
    listNativeCargo: () => source,
    ttlMs: 10000,
    now: () => 1000,
  });

  const rows = cache.allCargoRows();
  assert.equal(rows.length, 1);
  assert.notEqual(rows[0], source[0]);
  rows[0].entityID = 999;
  assert.equal(source[0].entityID, 500);
  assert.equal(cache.cargoForEntity(500)[0].cargoID, 1);
});

test("one build serves every reader inside the cache window", () => {
  let builds = 0;
  const cache = createCache({
    listNativeEntities: () => [],
    listNativeCargo: () => {
      builds += 1;
      return [{ cargoID: 2, entityID: 501 }];
    },
    ttlMs: 10000,
    now: () => 1000,
  });
  cache.allCargoRows();
  cache.cargoForEntity(501);
  cache.allCargoRows();
  assert.equal(builds, 1);
  assert.equal(cache.snapshot().cargoBuilds, 1);
});

test("the haul index visits only this slot's rows but still counts duplicates globally", () => {
  const source = [
    { cargoID: 10, entityID: 0, coopHaulSystemID: 30000144, coopHaulFleetID: 7 },
    { cargoID: 11, entityID: 0, coopHaulSystemID: 30000144, coopHaulFleetID: 8 },
    { cargoID: 12, entityID: 0 },
    { cargoID: 12, entityID: 0 },
  ];
  const cache = createCache({
    listNativeEntities: () => [],
    listNativeCargo: () => source,
    ttlMs: 10000,
    now: () => 1000,
  });

  assert.deepEqual(cache.haulRows(30000144, 7).map((row) => row.cargoID), [10]);
  assert.deepEqual(cache.haulRows(30000144, 8).map((row) => row.cargoID), [11]);
  assert.deepEqual(cache.haulRows(30000144, 9), []);
  assert.equal(cache.cargoIDCount(10), 1);
  assert.equal(cache.cargoIDCount(12), 2);
  assert.equal(cache.cargoIDCount(999), 0);
});

test("the haul planner uses the index when the pinned store provides it", () => {
  const source = fs.readFileSync(
    path.join(forkRoot, "Code/server/src/space/coopHaulCargoAdoption.js"), "utf8");
  assert.match(source, /haulRows\(/);
  assert.match(source, /cargoIDCount/);
  assert.match(source, /NATIVE_CARGO_ID_COLLISION/,
    "the fast path must still refuse a duplicated original cargoID");
});

test("entity rows are shallow copies too, so war combat cannot mutate the store", () => {
  const source = [{ entityID: 42, corporationID: 1000035, hp: 100 }];
  const cache = createCache({
    listNativeEntities: () => source,
    listNativeCargo: () => [],
    ttlMs: 10000,
    now: () => 1000,
  });
  const row = cache.entityByID(42);
  assert.notEqual(row, source[0]);
  row.hp = 0;
  assert.equal(source[0].hp, 100);
});

test("the store tells the read cache about every write, so the TTL is a backstop", () => {
  const store = fs.readFileSync(
    path.join(forkRoot, "Code/server/src/space/npc/nativeNpcStore.js"), "utf8");
  assert.match(store, /invalidateCoopReadCache\(\)/,
    "a store write must drop the read cache, otherwise freshness depends on the TTL alone");
  const writes = store.match(/success !== false\) invalidateCoopReadCache\(\);/g) || [];
  assert.equal(writes.length, 2, "both writeCollectionRow and removeCollectionRow must invalidate");
  const cache = fs.readFileSync(
    path.join(forkRoot, "Code/server/src/space/coopNativeReadCache.js"), "utf8");
  assert.match(cache, /\|\| 2000\)/, "with invalidation in place the cache window is 2 s, not 200 ms");
});

test("the live cache is wired to the store's non-cloning enumerations", () => {  const source = fs.readFileSync(
    path.join(forkRoot, "Code/server/src/space/coopNativeReadCache.js"), "utf8");
  assert.match(source, /peekNativeCargo/,
    "nativeCache() must prefer peekNativeCargo, or every cache window deep-clones the cargo table");
  assert.match(source, /peekNativeEntities/,
    "nativeCache() must prefer peekNativeEntities, or every cache window deep-clones every NPC entity");
  const store = fs.readFileSync(
    path.join(forkRoot, "Code/server/src/space/npc/nativeNpcStore.js"), "utf8");
  assert.match(store, /function peekNativeCargo\(/);
  assert.match(store, /function peekNativeEntities\(/);
  assert.match(store, /^ {2}peekNativeCargo,$/m, "peekNativeCargo must be exported");
  assert.match(store, /^ {2}peekNativeEntities,$/m, "peekNativeEntities must be exported");
});
