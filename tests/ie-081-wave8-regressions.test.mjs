import { test } from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { join } from "node:path";

const require = createRequire(import.meta.url);
if (!process.env.EVEJS_FORK_ROOT) throw new Error("EVEJS_FORK_ROOT is unset");
const sp = (n) => join(process.env.EVEJS_FORK_ROOT.trim(), "Code/server/src/space", n);
const Refinery = require(sp("coopEconomyRefineryQuote.js"));
const Competition = require(sp("coopEconomyOrderCompetition.js"));

// Found by wave 8 (module interaction). The refinery fee is money: a caller that retries the same
// operation after a timeout was charged again. The journal is keyed by the operation id AND the
// request AND the payment authority, so a genuine retry is free while a different request reusing
// an id (a fresh port) still runs.
test("IE-030 refinery: a retried operation is not charged twice", () => {
  const quote = { inputTypeID: "34", outputTypeID: "35", facilityID: "f-retry",
    inputQuantity: 10, outputQuantity: 9, feeCents: 10 };
  const debits = [];
  const port = { debit: () => { debits.push(1); return { ok: true, receiptID: "d1" }; } };
  const args = { operationID: "op-retry", quote, inputs: [{ typeID: "34", quantity: 10 }],
    walletCents: 100, facility: { facilityID: "f-retry", supportsFeePayment: true }, paymentPort: port };
  const first = Refinery.runRefinery(args);
  assert.equal(first.code, "REFINED");
  assert.equal(debits.length, 1);
  const replay = Refinery.runRefinery(args);
  assert.equal(replay.code, "ALREADY_REFINED", "the replay was " + replay.code);
  assert.equal(debits.length, 1, "the retry debited the wallet again");
  assert.equal(replay.debitReceiptID, first.debitReceiptID);
  // a different payment authority is a different request, not a retry
  const other = { debit: () => { debits.push(1); return { ok: true, receiptID: "d2" }; } };
  const fresh = Refinery.runRefinery({ ...args, paymentPort: other });
  assert.equal(fresh.code, "REFINED", "a different authority inherited the earlier outcome");
  assert.equal(debits.length, 2);
});

// Found by wave 8: maxPriceCents was validated as an integer and then never read, so an NPC that
// was willing to pay 50 matched an ask at 9000 against a cap of 100.
test("IE-046 competition: the price cap is enforced, not just accepted", () => {
  const base = { tick: 10, maxStepCents: 100, maxPriceCents: 100, minDelayTicks: 1,
    ordersThisTick: 0, maxOrdersPerTick: 5 };
  const npc = { corpID: "npc-1", priceCents: 50 };
  const capped = Competition.chooseFill({ ...base, npc, orders: [
    { orderID: "o1", ownerID: "p1", priceCents: 9000, quantity: 10 },
  ] });
  assert.equal(capped.code, "NO_MATCH", "an ask above the cap was matched: " + capped.code);
  assert.equal(capped.reason, "PRICE_CAP");
  const bidAbove = Competition.chooseFill({ ...base, npc: { corpID: "npc-1", priceCents: 500 }, orders: [
    { orderID: "o2", ownerID: "p1", priceCents: 10, quantity: 10 },
  ] });
  assert.notEqual(bidAbove.code, "MATCH", "a bid above the cap was sent as " + bidAbove.code);
  // the NPC only matches an ask it can beat: its own price must be below the ask
  const ok = Competition.chooseFill({ ...base, npc: { corpID: "npc-1", priceCents: 30 }, orders: [
    { orderID: "o3", ownerID: "p1", priceCents: 40, quantity: 10 },
  ] });
  assert.equal(ok.code, "MATCH", "a legal ask under the cap was refused");
  assert.equal(ok.priceCents, 40);
});
