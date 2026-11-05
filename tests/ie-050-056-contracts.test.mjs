import { test } from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { join } from "node:path";

const require = createRequire(import.meta.url);
if (!process.env.EVEJS_FORK_ROOT) process.env.EVEJS_FORK_ROOT = "C:/Games/EveCoop/upstream-evejs";
const fork = (process.env.EVEJS_FORK_ROOT || "C:/Games/EveCoop/upstream-evejs").trim();
const sp = (n) => join(fork, "Code/server/src/space", n);

const Contract = require(sp("coopEconomyProcurementContract.js"));
const Board = require(sp("coopEconomyContractBoard.js"));
const Acceptance = require(sp("coopEconomyDeliveryAcceptance.js"));
const Settlement = require(sp("coopEconomyContractSettlement.js"));
const Offer = require(sp("coopEconomyOfferSelection.js"));
const Split = require(sp("coopEconomySplitContract.js"));
const Reputation = require(sp("coopEconomyReputation.js"));

const baseContract = {
  contractID: "k1",
  typeID: "35",
  stationID: "s1",
  quantity: 10,
  unitPriceCents: 5,
  expiryTick: 100,
  buyerCorpID: "corp-a",
  supplierID: "player-1",
};

test("IE-050 contract: no contract opens before the funds are reserved", () => {
  const quoteOnly = Contract.openContract({ ...baseContract, contractID: "k-quote", funding: { funded: false, reservedCents: 50 } });
  assert.equal(quoteOnly.ok, false);
  assert.equal(quoteOnly.code, "NOT_FUNDED");
  assert.equal(quoteOnly.status, "UNPAID", "a quote is shown as unpaid, never as funded");
  assert.equal(Contract.open("k-quote"), null, "and nothing was opened");

  const underfunded = Contract.openContract({ ...baseContract, contractID: "k-short", funding: { funded: true, reservedCents: 49, receiptID: "esc-1" } });
  assert.equal(underfunded.code, "NOT_FUNDED", "49 cents cannot back a 50 cent liability");
  assert.equal(
    Contract.openContract({ ...baseContract, contractID: "k-noreceipt", funding: { funded: true, reservedCents: 50 } }).code,
    "NOT_FUNDED",
    "a claimed escrow without a native receipt is not funding",
  );

  const opened = Contract.openContract({ ...baseContract, funding: { funded: true, reservedCents: 50, receiptID: "esc-1" } });
  assert.equal(opened.code, "OPEN");
  assert.equal(opened.status, "FUNDED");
  assert.equal(opened.liabilityCents, 50);
  assert.equal(Contract.open("k1").fundingReceiptID, "esc-1");
  assert.equal(Contract.expire("k1", 101).status, "EXPIRED");
  assert.equal(Contract.open("k1").status, "EXPIRED");
});

test("IE-051 board: only funded contracts are listed and only supported channels can accept", () => {
  const board = Board.createBoard();
  assert.equal(board.publish({ contractID: "k2", typeID: "35", stationID: "s1", quantity: 1, unitPriceCents: 1, expiryTick: 100, status: "QUOTED" }).code, "NOT_FUNDED");
  board.publish({ contractID: "k1", typeID: "35", stationID: "s1", quantity: 10, unitPriceCents: 5, expiryTick: 100, status: "FUNDED" });
  board.publish({ contractID: "k0", typeID: "35", stationID: "s1", quantity: 10, unitPriceCents: 5, expiryTick: 20, status: "FUNDED" });
  const visible = board.list({ viewerID: "player-1", tick: 30 });
  assert.deepEqual(visible.map((c) => c.contractID), ["k1"], "the expired contract is gone and the unpaid one never existed");
  assert.equal(board.accept({ contractID: "k1", playerID: "player-1", channelID: "console", requestID: "r1", tick: 30 }).code, "UNSUPPORTED_CHANNEL");
  const accepted = board.accept({ contractID: "k1", playerID: "player-1", channelID: "jobBoard", requestID: "r1", tick: 30 });
  assert.equal(accepted.code, "ACCEPTED");
  assert.equal(accepted.channelID, "jobBoard");
  assert.ok(accepted.leaseID.startsWith("lease:"));
  assert.equal(board.accept({ contractID: "k1", playerID: "player-2", channelID: "jobBoard", requestID: "r2", tick: 30 }).code, "ALREADY_ACCEPTED");
  assert.equal(board.accept({ contractID: "ghost", playerID: "player-1", channelID: "jobBoard", requestID: "r3", tick: 30 }).code, "UNKNOWN_CONTRACT");
});

test("IE-052 delivery: a client flag without an item write is rejected", () => {
  const contract = { contractID: "k1", typeID: "35", stationID: "s1", quantity: 10, supplierID: "player-1" };
  const delivery = { receiptID: "r-1", itemID: "it-1", typeID: "35", quantity: 4, stationID: "s1", ownerID: "player-1", deliveredFlag: true };
  const itemStore = { read: () => ({ itemID: "it-1", typeID: "35", stationID: "s1", quantity: 4 }) };
  const a = Acceptance.createAcceptance();
  assert.equal(a.accept({ contract, delivery: { ...delivery, receiptID: undefined, itemID: undefined }, itemStore }).code, "CLIENT_FLAG_ONLY");
  assert.equal(a.accept({ contract, delivery: { ...delivery, stationID: "s9" }, itemStore }).field, "stationID");
  assert.equal(a.accept({ contract, delivery: { ...delivery, ownerID: "someone-else" }, itemStore }).field, "ownerID");
  const ok = a.accept({ contract, delivery, itemStore });
  assert.equal(ok.code, "ACCEPTED");
  assert.equal(ok.quantity, 4);
  assert.equal(a.accept({ contract, delivery, itemStore }).code, "ALREADY_ACCEPTED", "one receipt, one credit");
  assert.equal(
    a.accept({ contract, delivery: { ...delivery, receiptID: "r-2", itemID: "it-2" }, itemStore: { read: () => ({ typeID: "35", stationID: "s1", quantity: 1 }) } }).code,
    "ITEM_NOT_FOUND",
    "the native item store must actually hold the delivered quantity",
  );
});

test("IE-053 settlement: a payout never exceeds the funded liability and one fill pays once", () => {
  let credits = 0;
  const walletPort = { credit: () => { credits += 1; return { receiptID: "pay-1" }; } };
  const s = Settlement.createContractSettlement();
  const partial = s.settle({ contractID: "k1", playerID: "player-1", deliveredQuantity: 7, contractQuantity: 10, unitPriceCents: 10, feeCents: 5, capCents: 60, walletPort });
  assert.equal(partial.code, "SETTLED");
  assert.equal(partial.paidQuantity, 7);
  assert.equal(partial.netCents, 60, "70 - 5 = 65 is capped to the funded 60");
  assert.equal(partial.refundCents, 30, "the three undelivered units are refunded, not paid out");
  const replay = s.settle({ contractID: "k1", playerID: "player-1", deliveredQuantity: 7, contractQuantity: 10, unitPriceCents: 10, feeCents: 5, capCents: 60, walletPort });
  assert.equal(replay.code, "ALREADY_SETTLED");
  assert.equal(credits, 1, "an ACK lost replay cannot transfer twice");
  assert.equal(s.settle({ contractID: "k2", playerID: "player-1", deliveredQuantity: 99, contractQuantity: 10, unitPriceCents: 10, feeCents: 0, capCents: 1000, walletPort }).netCents, 100, "over-delivery is capped by the contract quantity");
  assert.equal(s.settle({ contractID: "k3", playerID: "player-1", deliveredQuantity: 1, contractQuantity: 1, unitPriceCents: 1, feeCents: 0, capCents: 1, walletPort: {} }).code, "NATIVE_AUTHORITY_UNAVAILABLE");
});

test("IE-053 settlement: a receiptless payout is sticky", () => {
  let credits = 0;
  const s = Settlement.createContractSettlement();
  const unknown = s.settle({ contractID: "k4", playerID: "player-1", deliveredQuantity: 1, contractQuantity: 1, unitPriceCents: 10, feeCents: 0, capCents: 100, walletPort: { credit: () => { credits += 1; throw new Error("ack lost"); } } });
  assert.equal(unknown.code, "SETTLEMENT_UNKNOWN");
  assert.equal(s.settle({ contractID: "k4", playerID: "player-1", deliveredQuantity: 1, contractQuantity: 1, unitPriceCents: 10, feeCents: 0, capCents: 100, walletPort: { credit: () => { credits += 1; return { receiptID: "late" }; } } }).code, "SETTLEMENT_UNKNOWN");
  assert.equal(credits, 1);
});

test("IE-054 offers: a better player offer beats the NPC and a teleport offer is refused", () => {
  const offers = [
    { offerID: "o1", supplierID: "player-1", priceCents: 50, etaSeconds: 100, capacity: 10, refreshTick: 0 },
    { offerID: "o2", supplierID: "player-2", priceCents: 1, etaSeconds: 0, capacity: 10, refreshTick: 0 },
    { offerID: "o3", supplierID: "player-3", priceCents: 0, etaSeconds: 0, capacity: 10, refreshTick: 0 },
    { offerID: "o4", supplierID: "player-4", priceCents: 40, etaSeconds: 40, capacity: 1, refreshTick: 0 },
    { offerID: "o5", supplierID: "player-5", priceCents: 40, etaSeconds: 40, capacity: 10, refreshTick: 9 },
  ];
  const npcOffer = { offerID: "n1", supplierID: "npc-a", priceCents: 60, etaSeconds: 90, capacity: 10, refreshTick: 0 };
  const chosen = Offer.selectOffer({ offers, npcOffer, requiredQuantity: 5, tick: 10, minRefreshTicks: 5, maxPriceCents: 100 });
  assert.equal(chosen.code, "SELECTED");
  assert.equal(chosen.offerID, "o1", "the legitimate cheaper player offer wins over the NPC");
  const reasons = Object.fromEntries(chosen.rejected.map((r) => [r.offerID, r.reason]));
  assert.equal(reasons.o2, "ZERO_COST_TELEPORT", "one cent and one second is a teleport, not freight");
  assert.equal(reasons.o3, "ZERO_COST_TELEPORT");
  assert.equal(reasons.o4, "INSUFFICIENT_CAPACITY");
  assert.equal(reasons.o5, "REFRESH_TOO_SOON", "an offer cannot be refreshed every tick");
  assert.equal(
    Offer.selectOffer({ offers: [{ offerID: "x", supplierID: "p", priceCents: 500, etaSeconds: 10, capacity: 10, refreshTick: 0 }], npcOffer: null, requiredQuantity: 1, tick: 10, minRefreshTicks: 5, maxPriceCents: 100 }).code,
    "NO_OFFER",
    "an absurd price is capped out rather than accepted",
  );
});

test("IE-055 split: a disconnected player's share is held, never handed to the other party", () => {
  const split = Split.createSplitContract();
  assert.equal(split.create({ contractID: "bad", totalCents: 1000, parties: [{ playerID: "p1", role: "SUPPLIER", shareBps: 6000 }] }).code, "INVALID_SPLIT");
  assert.equal(split.create({ contractID: "k1", totalCents: 1000, parties: [{ playerID: "p1", role: "SUPPLIER", shareBps: 6000 }, { playerID: "p2", role: "CARRIER", shareBps: 4000 }] }).code, "CREATED");
  const partial = split.award({ contractID: "k1", work: { p1: { verified: true, receiptID: "r1" } }, disconnected: ["p2"] });
  assert.equal(partial.code, "AWARDED");
  assert.deepEqual(partial.payouts, [{ playerID: "p1", role: "SUPPLIER", payoutCents: 600 }]);
  assert.deepEqual(partial.held, [{ playerID: "p2", code: "HELD_DISCONNECTED" }]);
  assert.equal(partial.paidCents, 600, "the carrier's 400 is not silently paid to the supplier");
  const both = split.award({
    contractID: "k1",
    work: { p1: { verified: true, receiptID: "r1" }, p2: { verified: true, receiptID: "r2" } },
    disconnected: [],
  });
  // the second call pays only the carrier share; the cumulative position is reported separately
  assert.equal(both.paidCents, 400);
  assert.equal(both.totalPaidCents, 1000);
  assert.ok(both.totalPaidCents <= 1000);
  assert.equal(split.award({ contractID: "ghost", work: {}, disconnected: [] }).code, "UNKNOWN_CONTRACT");
});

test("IE-056 reputation: self-dealing and cancelled contracts farm nothing, and a replay is idempotent", () => {
  const rep = Reputation.createReputation({ maxScore: 3 });
  assert.equal(rep.record({ playerID: "p1", contractID: "k1", outcome: "SUCCESS", receiptID: "r1" }).score, 1);
  assert.equal(rep.record({ playerID: "p1", contractID: "k1", outcome: "SUCCESS", receiptID: "r1" }).code, "ALREADY_RECORDED", "a restart replay is idempotent");
  assert.equal(rep.score("p1"), 1);
  assert.equal(rep.record({ playerID: "p1", contractID: "k2", outcome: "SUCCESS", receiptID: "r2", selfDealing: true }).code, "NOT_ELIGIBLE");
  assert.equal(rep.record({ playerID: "p1", contractID: "k3", outcome: "SUCCESS", receiptID: "r3", cancelled: true }).code, "NOT_ELIGIBLE");
  assert.equal(rep.score("p1"), 1, "neither earned anything");
  assert.equal(rep.record({ playerID: "p1", contractID: "k4", outcome: "SUCCESS" }).code, "EVIDENCE_REQUIRED");
  assert.equal(rep.record({ playerID: "p1", contractID: "k5", outcome: "FAILURE", receiptID: "r5" }).code, "EVIDENCE_REQUIRED");
  assert.equal(rep.record({ playerID: "p1", contractID: "k6", outcome: "FAILURE", receiptID: "r6", reason: "cargo lost" }).score, 0);
  assert.equal(rep.record({ playerID: "p1", contractID: "k7", outcome: "SUCCESS", receiptID: "r7" }).score, 1);
  assert.equal(rep.record({ playerID: "p1", contractID: "k8", outcome: "SUCCESS", receiptID: "r8" }).score, 2);
  assert.equal(rep.record({ playerID: "p1", contractID: "k9", outcome: "SUCCESS", receiptID: "r9" }).score, 3);
  assert.equal(rep.record({ playerID: "p1", contractID: "k10", outcome: "SUCCESS", receiptID: "r10" }).score, 3, "the score is bounded");
  assert.equal(rep.entries().length, 6, "one record per distinct contract, and the ineligible ones are not records");
});
