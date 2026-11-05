import { test } from "node:test";
import assert from "node:assert/strict";
import path from "node:path";
import { createRequire } from "node:module";

// Finding 3 (independent review of 15c374a): audit({}) has no measured scope at all, and returns
// BALANCED. An audit that measured nothing must never be evidence that nothing is missing.
const require = createRequire(import.meta.url);
const root = process.env.EVEJS_FORK_ROOT || "C:/Games/EveCoop/upstream-evejs";
const Coverage = require(path.join(root, "Code/server/src/space/coopEconomyConservationCoverage.js"));

const s = (units, id) => ({ units, sourceReceiptID: id || "src-" + units });

test("an audit with no measured scope is not BALANCED", () => {
  const empty = Coverage.audit({});
  assert.equal(empty.ok, false, "an audit that measured nothing passed as BALANCED");
  assert.equal(empty.code, "INCOMPLETE_SCOPE");
  const half = Coverage.audit({ before: {}, after: {}, custody: [] });
  assert.equal(half.ok, false, "empty before/after maps passed as BALANCED");
});

test("a required scope that was not measured fails the audit", () => {
  const result = Coverage.audit({
    before: { mining: s(100) },
    after: { mining: s(100) },
    custody: [],
    requiredScopes: ["mining", "market", "wallet"],
  });
  assert.equal(result.ok, false);
  assert.equal(result.code, "INCOMPLETE_SCOPE");
  assert.deepEqual(result.missing.sort(), ["market", "wallet"]);
});

test("a complete required scope can still balance", () => {
  const result = Coverage.audit({
    before: { mining: s(100), market: s(3) },
    after: { mining: s(100), market: s(3) },
    custody: [],
    requiredScopes: ["mining", "market"],
  });
  assert.equal(result.code, "BALANCED");
  assert.equal(result.ok, true);
});

test("a single measured scope still balances when it is the whole declared scope", () => {
  const result = Coverage.audit({ before: { mining: s(10) }, after: { mining: s(10) }, custody: [] });
  assert.equal(result.code, "BALANCED");
});
