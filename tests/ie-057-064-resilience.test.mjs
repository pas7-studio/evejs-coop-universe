import { test } from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { join } from "node:path";

const require = createRequire(import.meta.url);
if (!process.env.EVEJS_FORK_ROOT) throw new Error("EVEJS_FORK_ROOT is unset");
const fork = process.env.EVEJS_FORK_ROOT.trim();
const sp = (n) => join(fork, "Code/server/src/space", n);

const Risk = require(sp("coopEconomyRiskPolicy.js"));
const Backpressure = require(sp("coopEconomyBackpressure.js"));
const Recovery = require(sp("coopEconomyRecovery.js"));
const Coverage = require(sp("coopEconomyConservationCoverage.js"));
const Crash = require(sp("coopEconomyCrashWindows.js"));
const Race = require(sp("coopEconomyRaceMatrix.js"));
const Soak = require(sp("coopEconomySoak.js"));
const E2E = require(sp("coopEconomyClientE2E.js"));

test("IE-057 risk: a repeated fake incident raises nothing and spawns no extra security job", () => {
  const policy = Risk.createRiskPolicy({ minScore: 0, maxScore: 4, step: 1, cooldownTicks: 60 });
  assert.equal(policy.apply({ incidentID: "i0", routeID: "r1", kind: "LOSS", receiptID: "r", tick: 0 }).code, "UNKNOWN_ROUTE");
  assert.equal(policy.register({ routeID: "r1" }).code, "REGISTERED");
  const first = policy.apply({ incidentID: "i1", routeID: "r1", kind: "LOSS", receiptID: "rc-1", tick: 0 });
  assert.equal(first.code, "RISK_UPDATED");
  assert.equal(first.riskScore, 1);
  assert.equal(first.securityJobs, 1, "the first real loss gets one response");
  for (let i = 0; i < 20; i += 1) {
    assert.equal(policy.apply({ incidentID: "i1", routeID: "r1", kind: "LOSS", receiptID: "rc-1", tick: i + 1 }).code, "ALREADY_APPLIED");
  }
  assert.equal(policy.riskOf("r1"), 1, "twenty replays of one incident changed nothing");
  const insideWindow = policy.apply({ incidentID: "i2", routeID: "r1", kind: "ATTACK", receiptID: "rc-2", tick: 10 });
  assert.equal(insideWindow.securityJobs, 0, "a second incident inside the cooldown gets no new job");
  assert.equal(policy.apply({ incidentID: "i3", routeID: "r1", kind: "LOSS", receiptID: "rc-3", tick: 100 }).securityJobs, 1);
  for (let i = 0; i < 10; i += 1) policy.apply({ incidentID: "grow" + i, routeID: "r1", kind: "LOSS", receiptID: "rc", tick: 1000 + i });
  assert.equal(policy.riskOf("r1"), 4, "the score is clamped");
  assert.equal(policy.apply({ incidentID: "noev", routeID: "r1", kind: "LOSS", tick: 0 }).code, "EVIDENCE_REQUIRED");
});

test("IE-058 backpressure: no new active job without a real facility and nothing is deleted", () => {
  const bp = Backpressure.createBackpressure({ maxActive: 1, maxQueued: 1 });
  const ok = { facility: { facilityID: "f1", available: true }, warehouse: { capacityUnits: 10, usedUnits: 0 } };
  assert.equal(bp.admit({ operationID: "o1", ...ok }).state, "ACTIVE");
  assert.equal(bp.admit({ operationID: "o1", ...ok }).code, "ALREADY_KNOWN");
  assert.equal(bp.admit({ operationID: "o2", ...ok }).state, "QUEUED");
  assert.equal(bp.admit({ operationID: "o3", ...ok }).code, "QUEUE_FULL");
  const blocked = bp.admit({ operationID: "o4", facility: { facilityID: "f1", available: false }, warehouse: { capacityUnits: 10, usedUnits: 0 } });
  assert.equal(blocked.code, "FACILITY_UNAVAILABLE");
  assert.equal(blocked.state, "BLOCKED");
  const full = bp.admit({ operationID: "o5", facility: { facilityID: "f1", available: true }, warehouse: { capacityUnits: 10, usedUnits: 10 } });
  assert.equal(full.code, "WAREHOUSE_FULL");
  assert.equal(full.keptUnits, 10, "the stock is kept, not deleted to make room");
  assert.deepEqual(bp.counts(), { active: 1, queued: 1 });
  assert.equal(bp.complete({ operationID: "o1" }).code, "COMPLETED");
  assert.deepEqual(bp.counts(), { active: 0, queued: 1 });
});

test("IE-059 recovery: no fresh capital is minted and escrow claims survive liquidation", () => {
  const assets = [
    { itemID: "i1", quantity: 10, unitValueCents: 5 },
    { itemID: "i2", quantity: 10, unitValueCents: 100, escrowed: true },
  ];
  const fine = Recovery.buildRecoveryPlan({ walletCents: 100, commitmentsCents: 10, escrowClaimsCents: 50, assets });
  assert.equal(fine.code, "NOT_DISTRESSED");
  assert.equal(fine.mintedCents, 0);
  const plan = Recovery.buildRecoveryPlan({ walletCents: 0, commitmentsCents: 0, escrowClaimsCents: 50, assets });
  assert.equal(plan.code, "RECOVERY_PLAN");
  assert.equal(plan.sellCents, 50);
  assert.equal(plan.preservedEscrowCents, 1050, "the 50 cent claim plus the 1000 cent escrowed asset are untouchable");
  assert.equal(plan.mintedCents, 0);
  assert.deepEqual(plan.assets, [{ itemID: "i1", quantity: 10 }], "only the unreserved asset is sellable");
  const hopeless = Recovery.buildRecoveryPlan({ walletCents: 0, commitmentsCents: 10000, escrowClaimsCents: 50, assets });
  assert.equal(hopeless.code, "STILL_DISTRESSED");
  assert.equal(hopeless.mintedCents, 0, "distress never creates money");
  assert.equal(hopeless.preservedEscrowCents, 1050);
});

test("IE-060 conservation: an unknown source fails closed and duplicate custody blocks the scope", () => {
  const s = (units) => ({ units, sourceReceiptID: "src-" + units });
  assert.equal(Coverage.audit({ before: { mining: s(100) }, after: { mining: s(100) }, custody: [] }).code, "BALANCED");
  const unknown = Coverage.audit({ before: { mining: s(100) }, after: {}, custody: [] });
  assert.equal(unknown.code, "UNKNOWN_SOURCE");
  assert.equal(unknown.closed, true);
  assert.deepEqual(unknown.missing, ["mining"]);
  const noReceipt = Coverage.audit({ before: { wallet: { cents: 5 } }, after: { wallet: { cents: 5 } }, custody: [] });
  assert.equal(noReceipt.code, "UNKNOWN_SOURCE", "a balance without a native receipt is not evidence");
  const duplicate = Coverage.audit({
    before: { warehouse: s(10), cargo: s(10) },
    after: { warehouse: s(10), cargo: s(10) },
    custody: [{ cargoID: "c1", holderID: "h1" }, { cargoID: "c1", holderID: "h2" }],
  });
  assert.equal(duplicate.code, "DUPLICATE_CUSTODY");
  assert.equal(duplicate.blocksScope, true, "the whole scope is blocked, not just the entry");
  const imbalanced = Coverage.audit({ before: { mining: s(100) }, after: { mining: s(90) }, custody: [] });
  assert.equal(imbalanced.code, "IMBALANCE");
  assert.deepEqual(imbalanced.deltas, { mining: -10 });
});

test("IE-061 crash windows: every boundary restarts idempotently and nothing is swallowed", () => {
  const steps = {
    INTENT: () => ({ receiptID: "i" }),
    DEBIT: () => ({ receiptID: "d" }),
    CREDIT: () => ({ receiptID: "c" }),
    ESCROW: () => ({ receiptID: "e" }),
    FINALIZE: () => ({ receiptID: "f" }),
  };
  for (const window of Crash.CRASH_WINDOWS) {
    const result = Crash.runWindow({ window, operationID: "op-1", steps });
    for (const step of Crash.STEPS) {
      assert.equal(result.counts[step], 1, `${window}: ${step} ran exactly once`);
    }
    assert.deepEqual(result.doubled, [], `${window}: nothing was applied twice`);
    assert.ok(["RECOVERED", "RECOVERED_WITH_UNKNOWN"].includes(result.code), `${window}: ${result.code}`);
  }
  const dangerous = Crash.runWindow({ window: "AFTER_APPLY_BEFORE_DONE", operationID: "op-2", steps });
  assert.equal(dangerous.code, "RECOVERED_WITH_UNKNOWN", "an unrecorded effect is reported, not hidden");
  assert.deepEqual(dangerous.unknown, ["DEBIT"]);
  assert.equal(dangerous.counts.DEBIT, 1, "and it is never re-applied");
  assert.equal(Crash.runWindow({ window: "NOPE", operationID: "op-3", steps }).code, "INVALID_WINDOW");
});

test("IE-062 race matrix: one writer per key and a paused live owner is never stolen", () => {
  const leases = Race.createLeases({ ttlTicks: 30, graceTicks: 5 });
  assert.equal(leases.acquire({ key: "k1", ownerID: "w1", tick: 0 }).code, "ACQUIRED");
  assert.equal(leases.acquire({ key: "k1", ownerID: "w2", tick: 1 }).code, "LOCK_HELD");
  assert.equal(leases.acquire({ key: "k2", ownerID: "w2", tick: 1 }).code, "ACQUIRED", "different keys do not contend");
  // w1 is paused but still beating: a reclaim must be refused
  assert.equal(leases.heartbeat({ key: "k1", ownerID: "w1", tick: 30 }).code, "ALIVE");
  assert.equal(leases.reclaim({ key: "k1", ownerID: "w2", tick: 40, evidence: "looks idle" }).code, "RECLAIM_REFUSED");
  assert.equal(leases.holderOf("k1"), "w1");
  // a genuinely dead owner is reclaimable, but only with evidence
  assert.equal(leases.reclaim({ key: "k1", ownerID: "w2", tick: 200 }).code, "EVIDENCE_REQUIRED");
  assert.equal(leases.reclaim({ key: "k1", ownerID: "w2", tick: 200, evidence: "process gone, readback clean" }).code, "RECLAIMED");
  assert.equal(leases.holderOf("k1"), "w2");
  const swept = leases.sweep({ tick: 1000 });
  assert.deepEqual(swept.released.map((r) => r.key).sort(), ["k1", "k2"]);
  const matrix = Race.createLeases({ ttlTicks: 30 });
  const simulated = matrix.simulate({ writers: ["w1", "w2", "w3"], resourceKeys: ["a", "b"], tick: 0 });
  assert.equal(simulated.ok, true);
  assert.equal(simulated.code, "SINGLE_WRITER");
});

test("IE-063 soak: an accelerated deterministic world stays conserved and visible", () => {
  const a = Soak.runSoak({ ticks: 2000, seed: 7 });
  const b = Soak.runSoak({ ticks: 2000, seed: 7 });
  assert.equal(a.ok, true, JSON.stringify(a.failures));
  assert.equal(a.code, "SOAK_COMPLETE");
  assert.deepEqual(a.metrics, b.metrics, "the same seed produces the same world");
  assert.equal(a.materialBalance, 0, "no material was created or lost");
  assert.ok(a.leftoverUnits >= 0);
  assert.ok(a.leftoverUnits <= 10000, "stock never runs away");
  assert.equal(a.failures.length, 0);
  assert.equal(a.reset, false, "a soak never resets its own state");
  assert.equal(Soak.runSoak({ ticks: 0, seed: 1 }).code, "INVALID_SOAK");
  const other = Soak.runSoak({ ticks: 2000, seed: 8 });
  assert.notDeepEqual(other.metrics, a.metrics, "a different seed is a different world");
});

test("IE-064 client E2E: a simulation cannot substitute for the real pinned client gate", () => {
  const client = { kind: "eve-pinned-client", buildID: "build-1", sha256: "a".repeat(64), twoAccounts: true };
  const players = [{ playerID: "p1" }, { playerID: "p2" }];
  const receipts = [
    { step: "SUPPLY", receiptID: "r1" },
    { step: "DELIVERY", receiptID: "r2" },
    { step: "SALE", receiptID: "r3" },
  ];
  const truth = { wallet: { cents: 100 }, inventory: { units: 5 }, market: { units: 0, orders: 1 } };
  const ui = { playerID: "p1", walletCents: 100, inventoryUnits: 5, marketUnits: 0, marketOrders: 1 };

  const simulated = E2E.verifyE2E({ client: { kind: "simulation", buildID: "s", sha256: "b".repeat(64), twoAccounts: true }, players, ui, receipts, ...truth });
  assert.equal(simulated.code, "CLIENT_GATE_REQUIRED");
  assert.equal(simulated.simulated, false);

  const verified = E2E.verifyE2E({ client, players, ui, receipts, ...truth });
  assert.equal(verified.code, "E2E_VERIFIED");
  assert.deepEqual(verified.steps, ["SUPPLY", "DELIVERY", "SALE"]);

  const mismatch = E2E.verifyE2E({ client, players, ui: { ...ui, walletCents: 99 }, receipts, ...truth });
  assert.equal(mismatch.code, "UI_MISMATCH");
  assert.equal(mismatch.discrepancies[0].field, "walletCents");

  const shortChain = E2E.verifyE2E({ client, players, ui, receipts: [{ step: "SUPPLY", receiptID: "r1" }], ...truth });
  assert.deepEqual(shortChain.missing, ["DELIVERY", "SALE"]);
  assert.equal(E2E.notRun().code, "NOT_RUN");
});

// WAVE2-REGRESSION
test("IE-060 conservation: a scope changing from cents to units is not a balanced reading", () => {
  const r = Coverage.audit({
    before: { wallet: { cents: 100, sourceReceiptID: "w" }, warehouse: { units: 5, sourceReceiptID: "u" } },
    after: { wallet: { units: 100, sourceReceiptID: "w" }, warehouse: { units: 5, sourceReceiptID: "u" } },
    custody: [],
  });
  assert.equal(r.code, "UNKNOWN_SOURCE", "100 cents became 100 units without anyone noticing");
  assert.ok(r.missing.includes("wallet"));
});

test("IE-062 race: a negative tick is refused and cannot keep a dead lease alive", () => {
  const leases = Race.createLeases({ ttlTicks: 10 });
  assert.equal(leases.acquire({ key: "k", ownerID: "a", tick: -1 }).code, "INVALID_REQUEST");
  leases.acquire({ key: "k", ownerID: "a", tick: 100 });
  assert.equal(leases.sweep({ tick: -5 }).ok, false, "a negative sweep clock is refused");
  assert.equal(leases.holderOf("k"), "a", "the live holder survived the bad sweep");
});
