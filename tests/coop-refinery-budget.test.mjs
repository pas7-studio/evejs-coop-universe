import test from "node:test";
import assert from "node:assert/strict";
import {createRequire} from "node:module";
import path from "node:path";
import fs from "node:fs";
import os from "node:os";

// L7-D durability. Each case is a crash boundary from review/L8-SPECS.md: the money must never move
// outside the cap, and an interrupted charge must be decidable from the balance afterwards.
const forkRoot = process.env.EVEJS_FORK_ROOT || "C:/Games/EveCoop/upstream-evejs";
const require = createRequire(import.meta.url);
const B = require(path.join(forkRoot, "Code/server/src/space/coopRefineryBudget.js"));

const OWNER = 1000129;
const STATION = 60000682;
const root = () => fs.mkdtempSync(path.join(os.tmpdir(), "l7d-"));
const withRoot = (fn) => {
  const dir = root();
  try { fn(dir); } finally { fs.rmSync(dir, {recursive: true, force: true}); }
};

test("no budget file means no spending, whatever the flag says", () => withRoot((dir) => {
  assert.equal(B.readBudget(dir, {fsApi: fs}).status, "ABSENT");
  const answer = B.reserve(dir, {operationID: "op-a", amountISK: 10, corporationID: OWNER,
    stationID: STATION, balanceBefore: 1000, limitISK: 0, sinceAt: 1, now: 1, fsApi: fs});
  assert.equal(answer.status, "SPEND_SCOPE_EXHAUSTED");
  assert.equal(B.spent(dir, {fsApi: fs}).spentISK, 0);
}));

test("a corrupt budget is reported, not ignored", () => withRoot((dir) => {
  fs.writeFileSync(path.join(dir, "refinery-budget.json"), "{ nope", "utf8");
  assert.equal(B.readBudget(dir, {fsApi: fs}).status, "BUDGET_UNREADABLE");
}));

test("a 50 000 cap admits 30 000 and refuses the next 30 000", () => withRoot((dir) => {
  B.setBudget(dir, {corporationID: OWNER, stationID: STATION, limitISK: 50000, sinceAt: 1,
    setBy: "operator", now: 1, fsApi: fs});
  const first = B.reserve(dir, {operationID: "op-1", amountISK: 30000, corporationID: OWNER,
    stationID: STATION, balanceBefore: 100000, limitISK: 50000, sinceAt: 1, now: 2, fsApi: fs});
  assert.equal(first.status, "RESERVED");
  const second = B.reserve(dir, {operationID: "op-2", amountISK: 30000, corporationID: OWNER,
    stationID: STATION, balanceBefore: 70000, limitISK: 50000, sinceAt: 1, now: 3, fsApi: fs});
  assert.equal(second.status, "SPEND_SCOPE_EXHAUSTED");
  assert.equal(B.spent(dir, {fsApi: fs}).spentISK, 30000);
}));

test("one operationID cannot be charged twice", () => withRoot((dir) => {
  B.setBudget(dir, {corporationID: OWNER, stationID: STATION, limitISK: 100000, sinceAt: 1,
    setBy: "operator", now: 1, fsApi: fs});
  const first = B.reserve(dir, {operationID: "op-dup", amountISK: 1000, corporationID: OWNER,
    stationID: STATION, balanceBefore: 5000, limitISK: 100000, sinceAt: 1, now: 2, fsApi: fs});
  assert.equal(first.status, "RESERVED");
  const again = B.reserve(dir, {operationID: "op-dup", amountISK: 1000, corporationID: OWNER,
    stationID: STATION, balanceBefore: 4000, limitISK: 100000, sinceAt: 1, now: 3, fsApi: fs});
  assert.equal(again.status, "OPERATION_ALREADY_COMMITTED");
}));

test("crash after RESERVED, before the debit: recovery voids it", () => withRoot((dir) => {
  B.reserve(dir, {operationID: "op-c2", amountISK: 2500, corporationID: OWNER, stationID: STATION,
    balanceBefore: 8000, limitISK: 100000, sinceAt: 1, now: 1, fsApi: fs});
  const recovered = B.recover(dir, {balanceNow: 8000, corporationID: OWNER, now: 9, fsApi: fs});
  assert.deepEqual(recovered.voided, ["op-c2"]);
  assert.equal(B.spent(dir, {fsApi: fs}).spentISK, 0, "a voided reservation is not money spent");
}));

test("crash after the debit, before DEBITED: recovery proves the money moved", () => withRoot((dir) => {
  B.reserve(dir, {operationID: "op-c3", amountISK: 2500, corporationID: OWNER, stationID: STATION,
    balanceBefore: 8000, limitISK: 100000, sinceAt: 1, now: 1, fsApi: fs});
  const recovered = B.recover(dir, {balanceNow: 5500, corporationID: OWNER, now: 9, fsApi: fs});
  assert.deepEqual(recovered.debited, ["op-c3"]);
  assert.equal(B.spent(dir, {fsApi: fs}).spentISK, 2500, "the recovered debit still counts");
}));

test("recovery is idempotent and never writes a second debit", () => withRoot((dir) => {
  B.reserve(dir, {operationID: "op-i", amountISK: 1000, corporationID: OWNER, stationID: STATION,
    balanceBefore: 9000, limitISK: 100000, sinceAt: 1, now: 1, fsApi: fs});
  assert.equal(B.commit(dir, {operationID: "op-i", balanceAfter: 8000, now: 2, fsApi: fs}).status, "COMMITTED");
  B.recover(dir, {balanceNow: 8000, corporationID: OWNER, now: 3, fsApi: fs});
  B.recover(dir, {balanceNow: 8000, corporationID: OWNER, now: 4, fsApi: fs});
  const rows = B.readCommitments(dir, {fsApi: fs}).rows;
  assert.equal(rows.filter((row) => row.operationID === "op-i" && row.type === "DEBITED").length, 1);
  assert.equal(rows.filter((row) => row.operationID === "op-i" && row.type === "VOID").length, 0);
}));

test("an unprovable balance is UNCERTAIN and keeps counting until an operator resolves it", () => withRoot((dir) => {
  B.reserve(dir, {operationID: "op-u", amountISK: 2500, corporationID: OWNER, stationID: STATION,
    balanceBefore: 8000, limitISK: 100000, sinceAt: 1, now: 1, fsApi: fs});
  const recovered = B.recover(dir, {balanceNow: 12000, corporationID: OWNER, now: 9, fsApi: fs});
  assert.deepEqual(recovered.uncertain, ["op-u"]);
  assert.equal(B.spent(dir, {fsApi: fs}).spentISK, 2500);
  assert.equal(B.resolveUncertain(dir, {operationID: "op-u", verdict: "DEBITED",
    actor: "operator", now: 10, fsApi: fs}).status, "RESOLVED");
}));

test("the budget file is never rewritten by a charge", () => withRoot((dir) => {
  B.setBudget(dir, {corporationID: OWNER, stationID: STATION, limitISK: 50000, sinceAt: 1,
    setBy: "operator", now: 1, fsApi: fs});
  const before = fs.readFileSync(path.join(dir, "refinery-budget.json"), "utf8");
  B.reserve(dir, {operationID: "op-b", amountISK: 1000, corporationID: OWNER, stationID: STATION,
    balanceBefore: 9000, limitISK: 50000, sinceAt: 1, now: 2, fsApi: fs});
  assert.equal(fs.readFileSync(path.join(dir, "refinery-budget.json"), "utf8"), before,
    "a charge must not reset or renew the budget");
}));
