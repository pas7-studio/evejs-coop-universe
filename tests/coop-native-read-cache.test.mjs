// Regression: `listNativeEntities()` publishes the id as `entityID`; only the
// per-entity read uses `itemID`. The read cache indexed on `itemID` alone, so
// every lookup was a miss, `evaluatePair` answered
// NATIVE_STORE_IDENTITY_MISMATCH for every war pair, and no hostile NPC
// engagement was ever authorised - an accepted attack order never became a
// target and no damage was possible.
import test from "node:test";
import assert from "node:assert/strict";
import { createCache } from "../integration/coopNativeReadCache.cjs";

test("indexes native entity rows published with entityID", () => {
  const cache = createCache({
    listNativeEntities: () => [
      { entityID: 980000033113, corporationID: 1000035, systemID: 30045344 },
      { entityID: 980000023574, corporationID: 1000120, systemID: 30045344 },
    ],
    listNativeCargo: () => [],
    ttlMs: 10000,
    now: () => 1000,
  });
  const row = cache.entityByID(980000033113);
  assert.ok(row);
  assert.equal(row.corporationID, 1000035);
  assert.equal(cache.entityByID(980000023574).systemID, 30045344);
  assert.equal(cache.entityByID(1), null);
});

test("still accepts rows published with itemID", () => {
  const cache = createCache({
    listNativeEntities: () => [{ itemID: 42, corporationID: 1000125 }],
    listNativeCargo: () => [],
    ttlMs: 10000,
    now: () => 1000,
  });
  assert.equal(cache.entityByID(42).corporationID, 1000125);
});

test("a rebuild after invalidate picks up a newly spawned hull", () => {
  let rows = [{ entityID: 1, corporationID: 1000035 }];
  const cache = createCache({
    listNativeEntities: () => rows,
    listNativeCargo: () => [],
    ttlMs: 10000,
    now: () => 1000,
  });
  assert.equal(cache.entityByID(2), null);
  rows = [...rows, { entityID: 2, corporationID: 1000120 }];
  cache.invalidate();
  assert.equal(cache.entityByID(2).corporationID, 1000120);
});
