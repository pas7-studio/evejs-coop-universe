import { join } from "node:path";
import { test } from "node:test"
import assert from "node:assert/strict"
import { createRequire } from "node:module"
const require = createRequire(import.meta.url)
const M = require(join((process.env.EVEJS_FORK_ROOT || "C:/Games/EveCoop/upstream-evejs").trim(), "Code/server/src/space/coopEconomyRaceMatrix.js"))
const C = M.C || M
const { createLeases, RACE_CODE } = C

test("a lease is exclusive", () => {
  const leases = C.createLeases({ ttlTicks: 30, graceTicks: 5 })
  const r0 = leases.acquire({ key: "k1", ownerID: "a", tick: 0 })
  assert.equal(r0.code, RACE_CODE.ACQUIRED)
  assert.equal(leases.holderOf("k1"), "a")
  const r1 = leases.acquire({ key: "k1", ownerID: "b", tick: 1 })
  assert.equal(r1.ok, false)
  assert.equal(r1.code, RACE_CODE.LOCK_HELD)
  assert.equal(leases.holderOf("k1"), "a")
})

test("an expired lease is reclaimable only after ttl + grace, and only with evidence", () => {
  const L = C.createLeases({ ttlTicks: 30, graceTicks: 5 });
  assert.equal(L.acquire({ key: "k2", ownerID: "a", tick: 0 }).code, "ACQUIRED");
  // one tick past the ttl is still inside the grace: the owner may be slow, not gone
  assert.equal(L.reclaim({ key: "k2", ownerID: "b", tick: 31, evidence: "missed beats" }).code,
    "RECLAIM_REFUSED", "the grace period was bypassed by reclaim");
  assert.equal(L.holderOf("k2"), "a");
  // after ttl + grace the lease is dead, but taking it still needs evidence
  const noEvidence = L.reclaim({ key: "k2", ownerID: "b", tick: 36 });
  assert.equal(noEvidence.code, "EVIDENCE_REQUIRED", "a lease was taken without evidence");
  const taken = L.reclaim({ key: "k2", ownerID: "b", tick: 36, evidence: "31 beats missed" });
  assert.equal(taken.code, "RECLAIMED");
  assert.equal(L.holderOf("k2"), "b");
});
