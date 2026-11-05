import { test } from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { join } from "node:path";

const require = createRequire(import.meta.url);
if (!process.env.EVEJS_FORK_ROOT) process.env.EVEJS_FORK_ROOT = "C:/Games/EveCoop/upstream-evejs";
const fork = (process.env.EVEJS_FORK_ROOT || "C:/Games/EveCoop/upstream-evejs").trim();
const sp = (n) => join(fork, "Code/server/src/space", n);
const S = require(sp("coopEconomySnapshotSchema.js"));
const A = require(sp("coopEconomySnapshotAdapter.js"));

const valid = () => ({
  observedAt: 1000,
  expiresAt: 2000,
  sources: ["items", "wallet"],
  itemsByType: { a: 5 },
  incomingByType: { a: 1 },
  reservedByType: { a: 2 },
});

test("a complete snapshot is ok", () => {
  assert.deepEqual(S.validateSnapshot(valid(), { now: 1500 }), { ok: true, errors: [] });
});

test("missing time, expiry and sources are explicit errors", () => {
  const missing = S.validateSnapshot({ ...valid(), observedAt: undefined }, { now: 1500 });
  assert.ok(missing.errors.includes("MISSING_OBSERVED_AT"));
  const stale = S.validateSnapshot(valid(), { now: 5000 });
  assert.ok(stale.errors.includes("STALE"));
  const noSource = S.validateSnapshot({ ...valid(), sources: [] }, { now: 1500 });
  assert.ok(noSource.errors.includes("MISSING_SOURCE"));
});

test("contradictory reservation and bad quantities are errors", () => {
  const c = S.validateSnapshot({ ...valid(), reservedByType: { a: 9 } }, { now: 1500 });
  assert.ok(c.errors.includes("CONTRADICTORY"));
  const q = S.validateSnapshot({ ...valid(), itemsByType: { a: 1.5 } }, { now: 1500 });
  assert.ok(q.errors.includes("NEGATIVE_QUANTITY"));
});

test("createSnapshot freezes a valid snapshot and rejects an invalid one", () => {
  const snap = S.createSnapshot(valid());
  assert.equal(snap.version, 1);
  assert.equal(Object.isFrozen(snap), true);
  assert.throws(() => S.createSnapshot({}), TypeError);
});

test("the adapter merges verified readers and names unverified ones", () => {
  const snap = A.buildSnapshot({
    now: 5,
    ttlMs: 100,
    readers: [
      { id: "items", read: () => ({ itemsByType: { a: 5 } }) },
      { id: "wallet", read: () => { throw new Error("down"); } },
      { id: "jobs" },
    ],
  });
  assert.deepEqual(snap.sources, ["items"]);
  assert.deepEqual(snap.unverifiedSources, ["jobs", "wallet"]);
  assert.deepEqual(snap.itemsByType, { a: 5 });
  assert.deepEqual(snap.blockedReasons, ["UNVERIFIED_SOURCE"]);
  assert.equal(snap.observedAt, 5);
  assert.equal(snap.expiresAt, 105);
});

test("the adapter never invents a source or a zero", () => {
  const snap = A.buildSnapshot({});
  assert.deepEqual(snap.sources, []);
  assert.deepEqual(snap.itemsByType, {});
  assert.deepEqual(snap.blockedReasons, []);
});

// WAVE4-REGRESSION
test("IE-009 snapshot: the validator fails closed on null instead of throwing", () => {
  assert.equal(S.validateSnapshot(null).ok, false);
  assert.equal(S.validateSnapshot(undefined).ok, false);
  assert.equal(S.validateSnapshot([]).ok, false);
  assert.equal(S.validateSnapshot("x").ok, false);
});
