import test from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const { createCache } = require("../integration/coopNativeReadCache.cjs");

function fixture() {
  const calls = { entities: 0, cargo: 0 };
  let clock = 1000;
  const cache = createCache({
    listNativeEntities: () => {
      calls.entities += 1;
      return [
        { itemID: 11, corporationID: 500001, systemID: 30000142 },
        { itemID: 12, corporationID: 500004, systemID: 30000142 },
      ];
    },
    listNativeCargo: () => {
      calls.cargo += 1;
      return [
        { entityID: 11, typeID: 34, quantity: 100 },
        { entityID: 11, typeID: 35, quantity: 5 },
        { entityID: 12, typeID: 34, quantity: 7 },
      ];
    },
    ttlMs: 200,
    now: () => clock,
  });
  return { cache, calls, advance: (ms) => { clock += ms; } };
}

test("one bulk entity read serves every lookup inside the TTL", () => {
  const { cache, calls } = fixture();
  for (let i = 0; i < 50; i += 1) {
    assert.equal(cache.entityByID(11).corporationID, 500001);
    assert.equal(cache.entityByID(12).corporationID, 500004);
  }
  assert.equal(calls.entities, 1, "the collection must be read once, not once per lookup");
  assert.equal(cache.snapshot().entityHits, 100);
});

test("the cache expires after the TTL so a respawn is not served stale forever", () => {
  const { cache, calls, advance } = fixture();
  cache.entityByID(11);
  assert.equal(calls.entities, 1);
  advance(199);
  cache.entityByID(11);
  assert.equal(calls.entities, 1, "inside the window it is still the same read");
  advance(2);
  cache.entityByID(11);
  assert.equal(calls.entities, 2, "past the window the store is read again");
});

test("invalidate forces the next read", () => {
  const { cache, calls } = fixture();
  cache.entityByID(11);
  cache.invalidate();
  cache.entityByID(11);
  assert.equal(calls.entities, 2);
});

test("unknown ids are a miss, never a fabricated entity", () => {
  const { cache } = fixture();
  assert.equal(cache.entityByID(999), null);
  assert.equal(cache.entityByID(0), null);
  assert.equal(cache.entityByID("nonsense"), null);
  assert.equal(cache.snapshot().entityMisses, 1);
});

test("cargo is grouped per entity and read once per window", () => {
  const { cache, calls } = fixture();
  assert.equal(cache.cargoForEntity(11).length, 2);
  assert.equal(cache.cargoForEntity(12).length, 1);
  assert.equal(cache.cargoForEntity(404).length, 0);
  assert.equal(calls.cargo, 1);
  assert.equal(cache.allCargoRows().length, 3);
  assert.equal(calls.cargo, 1, "allCargoRows reuses the same window");
});

test("a missing store function degrades to empty, not a throw", () => {
  const cache = createCache({});
  assert.equal(cache.entityByID(11), null);
  assert.deepEqual(cache.allCargoRows(), []);
});
