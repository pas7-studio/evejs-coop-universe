import test from "node:test";
import assert from "node:assert/strict";
import {createRequire} from "node:module";
import path from "node:path";

// MEASURED 2026-11-06 in the live server (inspector, no restart): the read cache rebuilt its cargo
// window 30 times a minute while the owner was docked - exactly the 2 s TTL - and every rebuild paid
// peekNativeCargo() 6.4 ms for 16 988 rows (Object.values + a full sort) plus peekNativeEntities()
// 4.4 ms for 8 544 rows. The sort is not load-bearing: the cache indexes rows into Maps by
// owner/cargoID/haul key, and the only caller that takes `hits[0]`/`matches[0]`
// (coopHaulCargoAdoption) does so only when exactly ONE row matches.
const forkRoot = process.env.EVEJS_FORK_ROOT || "C:/Games/EveCoop/upstream-evejs";
const require = createRequire(import.meta.url);
const {createCache} = require(path.join(forkRoot, "Code/server/src/space/coopNativeReadCache.js"));

const entity = (entityID, systemID = 30000144) => ({entityID, systemID, kind: "ship"});
const cargo = (cargoID, entityID, extra = {}) => ({cargoID, entityID, typeID: 34, quantity: 100, ...extra});

function fixture() {
  const entities = [entity(3), entity(1), entity(2)];
  const cargoRows = [
    cargo(30, 2, {coopHaulSystemID: 30000144, coopHaulFleetID: 7}),
    cargo(10, 1, {coopHaulSystemID: 30000144, coopHaulFleetID: 7}),
    cargo(20, 1),
  ];
  const cache = createCache({
    listNativeEntities: () => entities,
    listNativeCargo: () => cargoRows,
    ttlMs: 60000,
  });
  return {cache, entities, cargoRows};
}

test("the cache indexes rows by id whatever order the store enumerates them in", () => {
  const {cache} = fixture();
  assert.equal(cache.entityByID(1).entityID, 1);
  assert.equal(cache.entityByID(2).entityID, 2);
  assert.deepEqual(cache.cargoForEntity(1).map((row) => row.cargoID).sort(), [10, 20]);
});

test("the haul index is built from the same single pass and keeps its own order", () => {
  const {cache} = fixture();
  const rows = cache.haulRows(30000144, 7);
  assert.deepEqual(rows.map((row) => row.cargoID).sort(), [10, 30]);
  assert.equal(cache.cargoIDCount(20), 1);
});

test("a write is visible after invalidate, and the counter records it", () => {
  const {cache, cargoRows} = fixture();
  assert.equal(cache.cargoForEntity(1).length, 2);
  cargoRows.push(cargo(40, 1));
  assert.equal(cache.cargoForEntity(1).length, 2, "still the cached window");
  cache.invalidate();
  assert.equal(cache.cargoForEntity(1).length, 3, "the write is visible after invalidation");
  assert.equal(cache.snapshot().invalidations, 1, "the rebuild rate must be measurable in combat");
});
