import test from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";
const require = createRequire(import.meta.url);
const { reconcileFreight } = require("../scripts/freight-check.cjs");

// A freight row must have a real settlement behind it. Measured 2026-10-30: the ledger showed
// 6 trips and 327 363 ISK, and every one of them had to be provable from the events file.
test("a row with a settlement behind it reconciles", () => {
  const answer = reconcileFreight([{ haulerID: 1 }, { haulerID: 1 }],
    [{ haulerID: 1, status: "SOLD" }, { haulerID: 1, status: "SOLD" }]);
  assert.equal(answer.ok, true);
});

test("a row without a settlement is named, not averaged away", () => {
  const answer = reconcileFreight([{ haulerID: 7 }, { haulerID: 7 }], [{ haulerID: 7, status: "SOLD" }]);
  assert.equal(answer.ok, false);
  assert.deepEqual(answer.problems, [{ haulerID: 7, rows: 2, settlements: 1,
    reason: "FREIGHT_ROW_WITHOUT_SETTLEMENT" }]);
});

test("a failed settlement does not back a paid trip", () => {
  const answer = reconcileFreight([{ haulerID: 9 }],
    [{ haulerID: 9, status: "NOT_SOLD" }, { haulerID: 9, status: "SOLD" }]);
  assert.equal(answer.ok, false, "NOT_SOLD alone never justifies a row");
});
