import { test } from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { join } from "node:path";

const require = createRequire(import.meta.url);
if (!process.env.EVEJS_FORK_ROOT) throw new Error("EVEJS_FORK_ROOT is unset");
const fork = process.env.EVEJS_FORK_ROOT.trim();
const sp = (n) => join(fork, "Code/server/src/space", n);

const WorkOrder = require(sp("coopEconomyWorkOrder.js"));
const Reservations = require(sp("coopEconomyReservations.js"));
const Funds = require(sp("coopEconomyFundsGateway.js"));
const Graph = require(sp("coopEconomyOperationGraph.js"));
const Outcomes = require(sp("coopEconomyNativeOutcomes.js"));
const Revalidate = require(sp("coopEconomyRevalidate.js"));
const Quarantine = require(sp("coopEconomyQuarantine.js"));

// IE-026: the coordination pieces must compose into one safe lifecycle without any native write.
test("a work order walks the lifecycle and blocks on an unknown outcome", () => {
  const wo = {
    operationID: "op-manufacture-1",
    corpID: "corp-a",
    phase: "NEED_IDENTIFIED",
    quantity: 10,
    resourceKeys: ["item:34@station-1"],
  };
  assert.deepEqual(WorkOrder.validateWorkOrder(wo), { ok: true, errors: [] });

  let current = WorkOrder.transition(wo, "PLANNED");
  current = WorkOrder.transition(current, "RESERVED");

  const reservations = Reservations.createReservations();
  assert.equal(reservations.reserve("item:34@station-1", current.operationID, 10, 10).code, "RESERVED");
  // a second order cannot take the same units
  assert.equal(reservations.reserve("item:34@station-1", "op-other", 1, 10).code, "INSUFFICIENT_AVAILABLE");

  const funds = Funds.createGateway();
  assert.equal(
    funds.commit({ operationID: current.operationID, cents: 500, walletCents: 1000 }).status,
    "QUOTED",
  );
  assert.equal(funds.fundedCents(), 0, "no escrow proof means no funded liability");

  current = WorkOrder.transition(current, "EXECUTING");
  const outcome = Outcomes.classifyOutcome({ threw: true, errorCode: "TIMEOUT" });
  assert.equal(outcome.outcome, "UNKNOWN");

  // an unknown outcome must not be retried: the order goes to reconciliation and the resource is locked
  current = WorkOrder.transition(current, "OUTCOME_UNKNOWN");
  const quarantine = Quarantine.createQuarantine();
  quarantine.quarantine({ operationID: current.operationID, resourceKeys: current.resourceKeys, reason: outcome.code });
  assert.equal(quarantine.isBlocked("item:34@station-1"), true);
  assert.equal(reservations.release("item:34@station-1", "op-other"), false);
});

test("revalidation catches an owner change before the order can complete", () => {
  const before = { owner: "corp-a", location: "hangar-1", version: 7 };
  const after = { owner: "corp-b", location: "hangar-1", version: 7 };
  const check = Revalidate.revalidate({ before, after });
  assert.equal(check.ok, false);
  assert.deepEqual(check.codes, ["OWNER_CHANGED"]);
});

test("the operation graph orders a real dependency chain and refuses a cycle", () => {
  const g = Graph.createGraph();
  g.add({ operationID: "mine", resourceKeys: ["asteroid:1"], dependencies: [] });
  g.add({ operationID: "haul", resourceKeys: ["cargo:9"], dependencies: ["mine"] });
  g.add({ operationID: "refine", resourceKeys: ["item:34"], dependencies: ["haul"] });
  assert.deepEqual(g.order().order, ["mine", "haul", "refine"]);
  g.add({ operationID: "mine", resourceKeys: [], dependencies: ["refine"] });
  assert.equal(g.order().ok, true, "a duplicate add is refused, so the graph stays acyclic");
});

test("a quarantined key stays blocked until authoritative evidence resolves it", () => {
  const q = Quarantine.createQuarantine();
  q.quarantine({ operationID: "op-x", resourceKeys: ["wallet:corp-a"], reason: "ACK_LOST" });
  assert.deepEqual(q.blockingKeys(), ["wallet:corp-a"]);
  assert.equal(q.resolve("op-x", "").code, "EVIDENCE_REQUIRED");
  assert.equal(q.isBlocked("wallet:corp-a"), true);
  assert.equal(q.resolve("op-x", "wallet readback 5000 cents, no debit").code, "RESOLVED");
  assert.equal(q.isBlocked("wallet:corp-a"), false);
  assert.deepEqual(q.resolved(), ["op-x"]);
});
