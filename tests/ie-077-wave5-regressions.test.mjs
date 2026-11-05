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
const Split = require(sp("coopEconomySplitContract.js"));

test("IE-050 contract: expiry is a one-way door", () => {
  const base = { contractID: "k2", typeID: "35", stationID: "s", quantity: 10, unitPriceCents: 5, expiryTick: 100, buyerCorpID: "b", supplierID: "p", funding: { funded: true, reservedCents: 50, receiptID: "e" } };
  assert.equal(Contract.openContract(base).ok, true);
  assert.equal(Contract.expire("k2", 101).status, "EXPIRED");
  assert.equal(Contract.expire("k2", 50).status, "EXPIRED", "an older tick brought an expired contract back");
  assert.equal(Contract.open("k2").status, "EXPIRED");
});

test("IE-051 board: a contract is acceptable up to and including its expiry tick", () => {
  const board = Board.createBoard();
  board.publish({ contractID: "kb", typeID: "35", stationID: "s", quantity: 1, unitPriceCents: 1, expiryTick: 10, status: "FUNDED" });
  assert.equal(board.accept({ contractID: "kb", playerID: "p", channelID: "jobBoard", requestID: "r", tick: 10 }).code, "ACCEPTED");
  const late = Board.createBoard();
  late.publish({ contractID: "kc", typeID: "35", stationID: "s", quantity: 1, unitPriceCents: 1, expiryTick: 10, status: "FUNDED" });
  assert.equal(late.accept({ contractID: "kc", playerID: "p", channelID: "jobBoard", requestID: "r", tick: 11 }).code, "UNKNOWN_CONTRACT");
});

test("IE-052 acceptance: a replayed receipt reports what was credited, not the new claim", () => {
  const a = Acceptance.createAcceptance();
  const contract = { contractID: "k", typeID: "35", stationID: "s", quantity: 100, supplierID: "p" };
  const delivery = { receiptID: "r", itemID: "i", typeID: "35", quantity: 40, stationID: "s", ownerID: "p" };
  const itemStore = { read: () => ({ itemID: "i", typeID: "35", stationID: "s", quantity: 40 }) };
  assert.equal(a.accept({ contract, delivery, itemStore }).quantity, 40);
  const replay = a.accept({ contract, delivery: { ...delivery, quantity: 100 }, itemStore });
  assert.equal(replay.code, "ALREADY_ACCEPTED");
  assert.equal(replay.quantity, 40, "the replay reported the inflated claim");
});

test("IE-055 split: a held share can be paid later and is never paid twice", () => {
  const s = Split.createSplitContract();
  s.create({ contractID: "ks", totalCents: 1000, parties: [{ playerID: "a", role: "SUPPLIER", shareBps: 6000 }, { playerID: "b", role: "CARRIER", shareBps: 4000 }] });
  const first = s.award({ contractID: "ks", work: { a: { verified: true, receiptID: "1" } }, disconnected: ["b"] });
  assert.equal(first.paidCents, 600);
  assert.equal(first.held[0].code, "HELD_DISCONNECTED");
  const second = s.award({ contractID: "ks", work: { a: { verified: true, receiptID: "1" }, b: { verified: true, receiptID: "2" } }, disconnected: [] });
  assert.equal(second.paidCents, 400, "the held share was not released");
  assert.equal(second.totalPaidCents, 1000);
  const replay = s.award({ contractID: "ks", work: { a: { verified: true, receiptID: "1" }, b: { verified: true, receiptID: "2" } }, disconnected: [] });
  assert.equal(replay.code, "ALREADY_AWARDED");
  assert.equal(replay.paidCents, 0, "a replay paid twice");
});
