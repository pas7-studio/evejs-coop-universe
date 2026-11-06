import test from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

// The refinery stalled for a day on fees it had already paid.
//
// Measured live 2026-11-06: 10 778 `living-npc-refinery-blocked` events with
// `status NPC_CORPORATION_WALLET_SETTLEMENT_REQUIRED, feePayment OPERATION_ALREADY_COMMITTED`,
// the last real refine at 14:05 the day before, so ore had not become minerals for a day.
//
// Two ways to reach that state, both normal after a crash, and both were a permanent block:
//   * the charge was reserved and debited but the receipt file was never written;
//   * the ore stack's quantity changed after the charge, so the old quote is not the new one.
// The durable ledger and the durable receipt are the authorities here, never a second debit.
const require = createRequire(import.meta.url);
const forkRoot = process.env.EVEJS_FORK_ROOT || "C:/Games/EveCoop/upstream-evejs";
const { payFee } = require(path.join(forkRoot, "Code/server/src/space/coopNpcRefineryTick.js"));
const { keyFor } = require(path.join(forkRoot, "Code/server/src/space/coopNpcRefinery.js"));

const CORP = 1000129;
const STATION = 60000682;
const ORE_ITEM = 9988400113954;
const QUANTITY = 38999;
const AMOUNT = 15427.28;
const BEFORE = 2137829.35;
const AFTER = Math.round((BEFORE - AMOUNT) * 100) / 100;

function fixture({ receipt = "ok", committed = true, debited = true, amount = AMOUNT,
  beforeISK = BEFORE } = {}) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "coop-refinery-fee-"));
  const chargeID = keyFor(ORE_ITEM, QUANTITY);
  fs.writeFileSync(path.join(root, "refinery-budget.json"),
    JSON.stringify({ limitISK: 1000000, sinceAt: 0 }));
  const rows = [];
  if (committed) {
    rows.push({ type: "RESERVED", operationID: chargeID, amountISK: AMOUNT,
      corporationID: CORP, stationID: STATION, balanceBefore: beforeISK, at: 1 });
  }
  if (debited) {
    rows.push({ type: "DEBITED", operationID: chargeID, balanceAfter: AFTER, at: 2 });
  }
  fs.writeFileSync(path.join(root, "refinery-commitments.jsonl"),
    rows.map((row) => JSON.stringify(row)).join("\n") + (rows.length ? "\n" : ""));
  if (receipt !== "missing") {
    fs.mkdirSync(path.join(root, "refinery-fees"), { recursive: true });
    fs.writeFileSync(path.join(root, "refinery-fees", ORE_ITEM + ".json"), JSON.stringify({
      version: 1, status: "PAID", receiptID: ORE_ITEM,
      amountISK: receipt === "ok" ? AMOUNT : amount,
      corporationID: CORP, stationID: STATION, oreItemID: ORE_ITEM,
      beforeISK: BEFORE, afterISK: AFTER, at: 3,
    }));
  }
  // A readable wallet that can never be written: a replay must not debit anything.
  const corporationState = {
    getCorporationRuntime: () => ({ wallet: { divisions: { "1000": { balance: BEFORE } } } }),
    applyDelta: () => { throw Error("WALLET_DEBITED_ON_REPLAY"); },
  };
  const gameStore = { flushTableSync: () => { throw Error("WALLET_FLUSHED_ON_REPLAY"); } };
  return { root, gameStore, corporationState, chargeID };
}

function run(f, overrides = {}) {
  return payFee({ gameStore: f.gameStore, root: f.root, ownerID: CORP, stationID: STATION,
    oreItemID: ORE_ITEM, quantity: QUANTITY, operationID: f.chargeID, amountISK: AMOUNT,
    now: 1761390000000, corporationState: f.corporationState, fsApi: fs, ...overrides });
}

test("a fee that was already committed replays its durable receipt instead of blocking", () => {
  const f = fixture();
  const paid = run(f);
  assert.equal(paid.status, "PAID");
  assert.equal(paid.replay, true);
  assert.equal(paid.receipt.receiptID, ORE_ITEM);
  assert.equal(paid.receipt.amountISK, AMOUNT);
  assert.equal(paid.receipt.corporationID, CORP);
  assert.equal(paid.receipt.stationID, STATION);
});

test("a committed charge whose receipt was lost is rebuilt from the debit, never re-charged", () => {
  // The process died between the wallet debit and the receipt write. The ledger proves the money
  // left (balanceBefore - amount === balanceAfter), so the proof is rebuilt from it.
  const f = fixture({ receipt: "missing" });
  const paid = run(f);
  assert.equal(paid.status, "PAID");
  assert.equal(paid.rebuilt, true);
  assert.equal(paid.receipt.receiptID, ORE_ITEM);
  assert.equal(paid.receipt.beforeISK, BEFORE);
  assert.equal(paid.receipt.afterISK, AFTER);
  const written = JSON.parse(
    fs.readFileSync(path.join(f.root, "refinery-fees", ORE_ITEM + ".json"), "utf8"));
  assert.equal(written.status, "PAID");
  assert.equal(written.rebuiltFromCommitment, true);
});

test("a reservation with no debit and no receipt is named, never paid twice", () => {
  const f = fixture({ receipt: "missing", debited: false });
  const paid = run(f);
  assert.equal(paid.status, "FEE_ALREADY_COMMITTED_RECEIPT_MISMATCH");
  assert.equal(paid.iskCost, AMOUNT);
});

test("a debit that does not conserve the reservation is not turned into a receipt", () => {
  // balanceBefore - amount must equal balanceAfter; anything else means the ledger is not the
  // proof we are looking for, and guessing would hide a real accounting problem.
  const f = fixture({ receipt: "missing", beforeISK: BEFORE + 500 });
  const paid = run(f);
  assert.equal(paid.status, "FEE_ALREADY_COMMITTED_RECEIPT_MISMATCH");
});

test("a stale receipt for another operation is replaced by the one the ledger proves", () => {
  // The receipt file is named after the ORE STACK, so an older operation leaves an older amount in
  // it. The committed ledger for THIS operation is the authority, and the receipt is rewritten to it.
  const f = fixture({ receipt: "other", amount: AMOUNT - 100 });
  const paid = run(f);
  assert.equal(paid.status, "PAID");
  assert.equal(paid.receipt.amountISK, AMOUNT);
  const written = JSON.parse(
    fs.readFileSync(path.join(f.root, "refinery-fees", ORE_ITEM + ".json"), "utf8"));
  assert.equal(written.amountISK, AMOUNT);
});

test("an uncommitted fee still goes through the real wallet path", () => {
  const f = fixture({ committed: false, debited: false });
  const paid = run(f, { corporationState: {
    getCorporationRuntime: () => { throw Error("WALLET_READ_ON_FIRST_PAYMENT"); } } });
  assert.equal(paid.status, "CORP_WALLET_UNREADABLE");
});

test("the charge is keyed by the refine operation, not by the ore stack", () => {
  // A stack whose quantity changed after the payment must be able to pay for its NEW quote; keyed by
  // the item alone it could never pay again, which is what stuck the whole warehouse.
  assert.equal(keyFor(ORE_ITEM, QUANTITY), `coop-refine:v1:${ORE_ITEM}:${QUANTITY}`);
  const f = fixture({ committed: false, debited: false });
  const other = run(f, { quantity: 3, operationID: keyFor(ORE_ITEM, 3),
    corporationState: { getCorporationRuntime: () => { throw Error("WALLET_READ_NEW_CHARGE"); } } });
  assert.equal(other.status, "CORP_WALLET_UNREADABLE",
    "a new quantity is a new charge, so the wallet is consulted instead of replaying");
});

// The budget guard itself: a refusal is not a commitment, so a raised ceiling must let the same
// operation through. Before this, every operation refused while the scope was exhausted stayed
// refused forever and the warehouse could never be refined again.
const { reserve, readCommitments } = require(
  path.join(forkRoot, "Code/server/src/space/coopRefineryBudget.js"));

function budgetRoot() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "coop-refinery-reserve-"));
  fs.writeFileSync(path.join(root, "refinery-commitments.jsonl"), JSON.stringify({
    type: "REFUSED", operationID: "coop-refine:v1:1:2", amountISK: 500,
    reason: "SPEND_SCOPE_EXHAUSTED", at: 1 }) + "\n");
  return root;
}

test("a refused charge is retried once the ceiling allows it, without duplicate refusals", () => {
  const root = budgetRoot();
  const again = reserve(root, { operationID: "coop-refine:v1:1:2", amountISK: 500,
    limitISK: 0, now: 2, fsApi: fs });
  assert.equal(again.status, "SPEND_SCOPE_EXHAUSTED");
  assert.equal(readCommitments(root).rows.length, 1, "the refusal is history, not a counter");
  const paid = reserve(root, { operationID: "coop-refine:v1:1:2", amountISK: 500,
    corporationID: CORP, stationID: STATION, balanceBefore: 10000, limitISK: 1000,
    now: 3, fsApi: fs });
  assert.equal(paid.status, "RESERVED");
});

test("a real commitment still refuses a second charge", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "coop-refinery-reserve2-"));
  fs.writeFileSync(path.join(root, "refinery-commitments.jsonl"), JSON.stringify({
    type: "RESERVED", operationID: "coop-refine:v1:1:2", amountISK: 500,
    corporationID: CORP, stationID: STATION, balanceBefore: 10000, at: 1 }) + "\n");
  const second = reserve(root, { operationID: "coop-refine:v1:1:2", amountISK: 500,
    corporationID: CORP, stationID: STATION, balanceBefore: 10000, limitISK: 100000,
    now: 2, fsApi: fs });
  assert.equal(second.status, "OPERATION_ALREADY_COMMITTED");
});
