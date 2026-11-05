import { test } from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { join } from "node:path";

const require = createRequire(import.meta.url);
if (!process.env.EVEJS_FORK_ROOT) process.env.EVEJS_FORK_ROOT = "C:/Games/EveCoop/upstream-evejs";
const fork = (process.env.EVEJS_FORK_ROOT || "C:/Games/EveCoop/upstream-evejs").trim();
const sp = (n) => join(fork, "Code/server/src/space", n);
const C = require(sp("coopEconomyPathComparator.js"));
const S = require(sp("coopEconomyStrategyState.js"));
const H = require(sp("coopEconomyHysteresis.js"));

test("the cheapest feasible path wins and infeasible options never rank", () => {
  const r = C.compareOptions([
    { kind: "MINE", landedCostCents: 900, feasible: false },
    { kind: "BUY", landedCostCents: 1200, feasible: true },
    { kind: "MANUFACTURE", landedCostCents: 1000, feasible: true },
  ]);
  assert.equal(r.best.kind, "MANUFACTURE");
  assert.deepEqual(r.ranked.map((o) => o.kind), ["MANUFACTURE", "BUY"]);
  assert.deepEqual(r.rejected, [{ kind: "MINE", reason: "INFEASIBLE" }]);
});

test("nothing feasible means no best, and bad options are rejected", () => {
  assert.equal(C.compareOptions([{ kind: "BUY", landedCostCents: 10, feasible: false }]).best, null);
  assert.equal(C.compareOptions([]).best, null);
  const r = C.compareOptions([
    { kind: "SHIP", feasible: true },
    { kind: "BUY", landedCostCents: 1.5, feasible: true },
  ]);
  assert.deepEqual(r.rejected.map((x) => x.reason).sort(), ["INVALID_COST", "INVALID_COST"]);
});

test("strategy never spends without money", () => {
  assert.deepEqual(S.chooseIntent({ onHand: 0, reorderPoint: 10, maxStock: 100, cashAvailable: 0, canBuy: true }),
    { intent: "HOLD", reasons: ["INSUFFICIENT_FUNDS"] });
  assert.deepEqual(S.chooseIntent({ onHand: 0, reorderPoint: 10, maxStock: 100, cashAvailable: 500, canBuy: true }),
    { intent: "BUY", reasons: ["BELOW_REORDER"] });
});

test("strategy sells a real surplus and holds a healthy stock", () => {
  assert.deepEqual(S.chooseIntent({ onHand: 150, reorderPoint: 10, maxStock: 100, cashAvailable: 50 }),
    { intent: "SELL", reasons: ["OVERSTOCK"] });
  assert.deepEqual(S.chooseIntent({ onHand: 10, reorderPoint: 10, maxStock: 100, cashAvailable: 50 }),
    { intent: "HOLD", reasons: ["OK"] });
});

test("mining is chosen only when buying is impossible, otherwise the plan says no path", () => {
  assert.equal(S.chooseIntent({ onHand: 0, reorderPoint: 10, maxStock: 100, cashAvailable: 50, canMine: true }).intent, "MINE");
  assert.deepEqual(S.chooseIntent({ onHand: 0, reorderPoint: 10, maxStock: 100, cashAvailable: 50 }),
    { intent: "HOLD", reasons: ["NO_FEASIBLE_PATH", "NO_SELLER"] });
});

test("hysteresis: urgent events, unchanged intents and young decisions", () => {
  const base = { lastDecisionAt: 0, now: 1000, minDecisionAgeMs: 60000, lastIntent: "BUY", nextIntent: "MINE" };
  assert.deepEqual(H.shouldReplan({ ...base, urgency: true, nextIntent: "BUY" }),
    { replan: true, reason: "URGENT_EVENT" });
  assert.deepEqual(H.shouldReplan({ ...base, nextIntent: "BUY" }), { replan: false, reason: "SAME_INTENT" });
  assert.deepEqual(H.shouldReplan(base), { replan: false, reason: "MIN_DECISION_AGE" });
  assert.deepEqual(H.shouldReplan({ ...base, now: 100000 }), { replan: true, reason: "REPLAN" });
});

