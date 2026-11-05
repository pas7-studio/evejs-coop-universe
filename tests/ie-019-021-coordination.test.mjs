import { test } from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { join } from "node:path";

const require = createRequire(import.meta.url);
if (!process.env.EVEJS_FORK_ROOT) process.env.EVEJS_FORK_ROOT = "C:/Games/EveCoop/upstream-evejs";
const fork = (process.env.EVEJS_FORK_ROOT || "C:/Games/EveCoop/upstream-evejs").trim();
const sp = (n) => join(fork, "Code/server/src/space", n);
const Reservations = require(sp("coopEconomyReservations.js"));
const Funds = require(sp("coopEconomyFundsGateway.js"));
const Graph = require(sp("coopEconomyOperationGraph.js"));

test("reservations: one unit is never promised twice", () => {
  const r = Reservations.createReservations();
  assert.equal(r.reserve("k", "op1", 6, 10).code, "RESERVED");
  assert.equal(r.reserve("k", "op2", 5, 10).code, "INSUFFICIENT_AVAILABLE");
  assert.equal(r.reserve("k", "op2", 4, 10).code, "RESERVED");
  assert.equal(r.reservedFor("k"), 10);
});

test("reservations: repeat is idempotent, release only removes its own", () => {
  const r = Reservations.createReservations();
  r.reserve("k", "op1", 3, 10);
  assert.equal(r.reserve("k", "op1", 3, 10).code, "ALREADY_RESERVED");
  assert.equal(r.reservedFor("k"), 3);
  assert.equal(r.release("k", "nope"), false);
  assert.equal(r.release("k", "op1"), true);
  assert.equal(r.reservedFor("k"), 0);
  assert.equal(r.reserve("k", "op1", 0, 10).code, "INVALID_QUANTITY");
});

test("funds: a commitment without escrow proof is QUOTED, never FUNDED", () => {
  const g = Funds.createGateway();
  assert.equal(g.commit({ operationID: "o1", cents: 100, walletCents: 150 }).status, "QUOTED");
  assert.equal(g.statusOf("o1"), "QUOTED");
  assert.equal(g.fundedCents(), 0);
  assert.equal(g.committedCents(), 100);
});

test("funds: total commitments cannot exceed the wallet", () => {
  const g = Funds.createGateway();
  g.commit({ operationID: "o1", cents: 100, walletCents: 150 });
  assert.equal(g.commit({ operationID: "o2", cents: 100, walletCents: 150 }).status, "INSUFFICIENT_FUNDS");
  assert.equal(g.commit({ operationID: "o3", cents: 10, walletCents: 150, escrowProof: true }).status, "FUNDED");
  assert.equal(g.fundedCents(), 10);
  assert.equal(g.commit({ operationID: "o1", cents: 100, walletCents: 150 }).duplicate, true);
  assert.equal(g.release("o1"), true);
  assert.equal(g.committedCents(), 10);
});

test("graph: dependencies come first and cycles are refused", () => {
  const g = Graph.createGraph();
  g.add({ operationID: "b", resourceKeys: ["i"], dependencies: ["a"] });
  g.add({ operationID: "a", resourceKeys: ["i"], dependencies: [] });
  assert.deepEqual(g.order(), { ok: true, code: "OK", order: ["a", "b"] });
  assert.deepEqual(g.dependentsOf("a"), ["b"]);
  assert.equal(g.add({ operationID: "a", resourceKeys: [], dependencies: [] }).code, "DUPLICATE_OPERATION");
});

test("graph: unknown dependency and cycle are explicit failures", () => {
  const g = Graph.createGraph();
  g.add({ operationID: "a", resourceKeys: [], dependencies: ["ghost"] });
  assert.deepEqual(g.order(), { ok: false, code: "UNKNOWN_DEPENDENCY", missing: ["ghost"] });
  const c = Graph.createGraph();
  c.add({ operationID: "x", resourceKeys: [], dependencies: ["y"] });
  c.add({ operationID: "y", resourceKeys: [], dependencies: ["x"] });
  assert.equal(c.order().code, "CYCLE");
});
