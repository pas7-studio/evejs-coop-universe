import { test } from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { join } from "node:path";

const require = createRequire(import.meta.url);
if (!process.env.EVEJS_FORK_ROOT) process.env.EVEJS_FORK_ROOT = "C:/Games/EveCoop/upstream-evejs";
const fork = process.env.EVEJS_FORK_ROOT.trim();
const sp = (n) => join(fork, "Code/server/src/space", n);
const B = require(sp("coopEconomyBudgetModel.js"));
const F = require(sp("coopEconomyFeasibility.js"));

test("spendable cash subtracts escrow, commitments and the reserve", () => {
  const r = B.spendableCash({ walletCents: 1000, escrowCents: 100, committedCents: 50, minReserveCents: 100 });
  assert.equal(r.cashAvailable, 750);
  assert.equal(r.reason, "OK");
});

test("fractional cents are invalid, not rounded", () => {
  const r = B.spendableCash({ walletCents: 1.5 });
  assert.equal(r.reason, "INVALID_CENTS");
  assert.equal(B.canSpend({ walletCents: 1.5 }, 1), false);
});

test("an over-committed wallet is zero spendable, never a negative number", () => {
  // The first version of this test asserted cashAvailable === -90. That number is unsafe: any caller that
  // adds it to another balance silently reduces that balance. Spendable cash is clamped to zero and the
  // reason carries the information instead.
  const r = B.spendableCash({ walletCents: 10, minReserveCents: 100 });
  assert.equal(r.cashAvailable, 0);
  assert.equal(r.reason, "NO_SPENDABLE_FUNDS");
  assert.equal(B.canSpend({ walletCents: 10, minReserveCents: 100 }, 1), false);
});

test("canSpend boundaries", () => {
  assert.equal(B.canSpend({ walletCents: 100 }, 100), true);
  assert.equal(B.canSpend({ walletCents: 100 }, 101), false);
  assert.equal(B.canSpend({ walletCents: 100 }, 0), false);
});

test("a fully provisioned path is feasible", () => {
  const r = F.assessFeasibility({
    blueprint: { typeID: 1, materials: { a: 5 } },
    materials: { a: 5 },
    jobSlots: 1,
    facility: { stationID: "s1", available: true },
  });
  assert.equal(r.feasible, true);
  assert.equal(r.status, "FEASIBLE");
  assert.deepEqual(r.reasons, []);
});

test("every missing precondition is named and the path is infeasible", () => {
  const r = F.assessFeasibility({
    blueprint: null,
    materials: { a: 1 },
    jobSlots: 0,
    facility: { stationID: "s1", available: false },
  });
  assert.equal(r.feasible, false);
  assert.equal(r.status, "INFEASIBLE");
  assert.deepEqual(r.reasons, ["BPO_MISSING", "FACILITY_UNAVAILABLE", "NO_JOB_SLOTS"]);
  const short = F.assessFeasibility({
    blueprint: { typeID: 1, materials: { a: 5 } },
    materials: { a: 1 },
    jobSlots: 2,
    facility: { stationID: "s1", available: true },
  });
  assert.deepEqual(short.reasons, ["INSUFFICIENT_MATERIALS"]);
});
