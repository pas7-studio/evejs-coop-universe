import { test } from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { join } from "node:path";

const require = createRequire(import.meta.url);
if (!process.env.EVEJS_FORK_ROOT) process.env.EVEJS_FORK_ROOT = "C:/Games/EveCoop/upstream-evejs";
const fork = process.env.EVEJS_FORK_ROOT.trim();
const sp = (n) => join(fork, "Code/server/src/space", n);

const Revalidate = require(sp("coopEconomyRevalidate.js"));
const Live = require(sp("coopEconomyLiveReadiness.js"));
const Scorecard = require(sp("coopEconomyAutonomyScorecard.js"));
const Destination = require(sp("coopEconomyDestination.js"));
const Repair = require(sp("coopEconomyRepairConsole.js"));
const Recovery = require(sp("coopEconomyRecovery.js"));

// IE-006 revalidate is the guard every executor runs before acting on a cached view. It used to
// read `before[field]` unconditionally, so a caller that could not read one side crashed instead
// of being told the state changed.
test("IE-006 revalidate: a missing side of the comparison fails closed", () => {
  assert.equal(Revalidate.revalidate({ before: null, after: { owner: 1 } }).ok, false);
  assert.equal(Revalidate.revalidate({ before: { owner: 1 }, after: null }).ok, false);
  assert.equal(Revalidate.revalidate({}).ok, false);
  assert.equal(Revalidate.revalidate({ before: { owner: 1 }, after: { owner: 2 } }).codes[0], "OWNER_CHANGED");
});

// IE-012: live readiness is the gate that keeps a manual module manual. An attestation that
// named no module matched an anonymous binding and went live.
test("IE-012 live readiness: an anonymous attestation cannot promote a binding, whitespace is not a review", () => {
  assert.equal(Live.assessLiveReadiness({
    binding: { supportsLiveRuntime: true },
    attestation: { reviewedBy: "x", reviewSHA: "y" },
  }).live, false);
  assert.equal(Live.assessLiveReadiness({
    binding: { id: "m", supportsLiveRuntime: true },
    attestation: { id: "m", reviewedBy: "  ", reviewSHA: "  " },
  }).live, false);
  assert.equal(Live.assessLiveReadiness({
    binding: { id: "m", supportsLiveRuntime: true },
    attestation: { id: "m", reviewedBy: "owner", reviewSHA: "c08736d" },
  }).live, true);
});

// IE-071: the scorecard measured who wrote each accepted file, but dropped the author's own
// accepted work entirely, so the ledger read as if every file came from an agent.
test("IE-071 scorecard: a rescue is never autonomous and every author is in the ledger", () => {
  const card = Scorecard.buildScorecard({ events: [
    { taskID: "a", kind: "PRODUCTION", actor: "ornith-a", loc: 10, accepted: true },
    { taskID: "b", kind: "PRODUCTION", actor: "ornith-b", loc: 10, accepted: true },
    { taskID: "b", kind: "RESCUE", actor: "deepseek", loc: 5, accepted: true },
    { taskID: "c", kind: "PRODUCTION", actor: "deepseek", loc: 7, accepted: true },
  ] });
  assert.equal(card.autonomousVerifiedTasks, 1);
  assert.equal(card.rescuedTasks, 1);
  assert.equal(card.deepseekRescueLOC, 5);
  assert.equal(card.deepseekAuthoredProductionLOC, 7);
  const authors = Object.fromEntries(card.files.map((f) => [f.taskID, f.author]));
  assert.equal(authors.c, "deepseek", "the author's own accepted work vanished from the ledger");
  assert.equal(authors.a, "ornith");
});

// IE-042: a station with revenue 0 for an empty hold is a destination a caller can act on,
// which is a lie; there is nothing to sell.
test("IE-042 destination: an empty hold has no destination", () => {
  const books = { 34: { buys: [{ order_id: 1, station_id: 600, price: 9, vol_remaining: 5 }] } };
  assert.deepEqual(Destination.rankStations({ cargo: [], candidates: [{ stationID: 600 }], books }).ranked, []);
  assert.equal(Destination.bestBuyAt(books[34], 600).price, 9);
});

// IE-061: a repair action that names no operation cannot be applied, audited or rolled back,
// and health is about the operation, not the presence of a journal.
test("IE-061 repair console: an action names its operation, health follows the operation", () => {
  assert.equal(Repair.act({ choice: "RECONCILE", evidence: "readback" }).ok, false);
  assert.equal(Repair.act({ choice: "RECONCILE", operationID: "op", evidence: "  " }).code, "EVIDENCE_REQUIRED");
  assert.equal(Repair.act({ choice: "RECONCILE", operationID: "op", evidence: "readback" }).ok, true);
  assert.equal(Repair.isHealthy({ journal: [{ receiptID: "r" }], operation: { state: "FAILED" } }), false);
  assert.equal(Repair.isHealthy({ journal: [{ receiptID: "r" }], operation: { state: "COMPLETED" } }), true);
});

// IE-065: recovery may sell capital, never mint it. A fractional or negative quantity silently
// changed the amount it claimed to recover.
test("IE-065 recovery: corrupt units are refused and nothing is minted", () => {
  for (const quantity of [-1, 1.5, "10", NaN]) {
    assert.equal(Recovery.buildRecoveryPlan({
      walletCents: 0, commitmentsCents: 10, escrowClaimsCents: 0,
      assets: [{ itemID: "i", quantity, unitValueCents: 10 }],
    }).ok, false, "quantity " + String(quantity) + " produced a plan");
  }
  const plan = Recovery.buildRecoveryPlan({
    walletCents: 0, commitmentsCents: 50, escrowClaimsCents: 0,
    assets: [{ itemID: "i", quantity: 10, unitValueCents: 10, escrowed: true }],
  });
  assert.equal(plan.mintedCents, 0);
  assert.ok((plan.sellCents || 0) === 0, "an escrowed asset was sold");
});
