import { test } from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { join } from "node:path";

// Measured 2026-11-01 by simulating a restart (drop the module from the require cache): the
// "already done" records of the money and goods modules were process-local, so a replay after a
// restart duplicated a settlement, a purchase, a transfer, a job, an acceptance and a payout.
// Each module now accepts a durable journal {get, set, has?, delete?, entries?}; without one its
// behaviour is unchanged. These tests replay through a restart WITH a journal and expect exactly
// one effect.
const require = createRequire(import.meta.url);
if (!process.env.EVEJS_FORK_ROOT) throw new Error("EVEJS_FORK_ROOT is unset");
const SPACE = join(process.env.EVEJS_FORK_ROOT.trim(), "Code/server/src/space");

function reload(name) {
  const p = join(SPACE, name + ".js");
  delete require.cache[require.resolve(p)];
  return require(p);
}

function memoryJournal() {
  const rows = new Map();
  return {
    get: (k) => rows.get(k),
    set: (k, v) => { rows.set(k, v); },
    has: (k) => rows.has(k),
    delete: (k) => rows.delete(k),
    entries: () => [...rows.entries()],
  };
}

test("a purchase is not debited twice across a restart", () => {
  const journal = memoryJournal();
  let debits = 0;
  const settlementPort = { debit: () => { debits += 1; return { receiptID: "d" + debits }; } };
  const itemPort = { transfer: () => ({ receiptID: "i1" }) };
  const ask = { askID: "a1", sellerCorpID: "s", typeID: "35", quantity: 5, priceCents: 100 };
  const args = { operationID: "buy-restart", buyerCorpID: "c", ask, walletCents: 1000, settlementPort, itemPort };

  const before = reload("coopEconomyPlayerPurchase").createBuyer({ journal });
  assert.equal(before.purchase(args).code, "PURCHASED");
  assert.equal(debits, 1);

  const after = reload("coopEconomyPlayerPurchase").createBuyer({ journal });
  const replay = after.purchase(args);
  assert.equal(replay.code, "ALREADY_PURCHASED", "a restart forgot the purchase: " + replay.code);
  assert.equal(debits, 1, "the buyer was debited again after the restart");
});

test("a warehouse transfer is not moved twice across a restart", () => {
  const journal = memoryJournal();
  let moves = 0;
  const transferPort = { transferGoodsAndFunds: () => { moves += 1; return { ok: true, goodsReceiptID: "g" + moves, paymentReceiptID: "p" + moves }; } };
  const args = { cargoID: "cargo-restart", sellerCorpID: "s", buyerCorpID: "b", typeID: "35",
    quantity: 7, priceCents: 50, buyerWalletCents: 1000, transferPort };

  const before = reload("coopEconomyWarehouseTransfer").createTransfer({ journal });
  assert.equal(before.transfer(args).ok, true);
  assert.equal(moves, 1);

  const after = reload("coopEconomyWarehouseTransfer").createTransfer({ journal });
  assert.equal(after.transfer(args).code, "ALREADY_TRANSFERRED");
  assert.equal(moves, 1, "the units moved again after the restart");
});

test("a job installs once across a restart", () => {
  const journal = memoryJournal();
  let installs = 0;
  const installPort = { installOnce: () => { installs += 1; return { ok: true, receiptID: "j" + installs }; } };
  const quote = { blueprintID: "bp", productTypeID: "35", runs: 1,
    needs: [{ typeID: "34", quantity: 10 }], materialCostCents: 100 };
  const args = { operationID: "job-restart", quote, materials: [{ typeID: "34", quantity: 10 }],
    walletCents: 1000, installPort };

  const before = reload("coopEconomyJobAdmission").createJobAdmission({ journal });
  assert.equal(before.admit(args).ok, true);
  assert.equal(installs, 1);

  const after = reload("coopEconomyJobAdmission").createJobAdmission({ journal });
  assert.equal(after.admit(args).code, "ALREADY_ADMITTED");
  assert.equal(installs, 1, "the blueprint was installed again after the restart");
});

test("a delivery is not accepted twice across a restart", () => {
  const journal = memoryJournal();
  const contract = { contractID: "k", typeID: "35", stationID: "s", quantity: 100, supplierID: "p" };
  const delivery = { receiptID: "r-restart", itemID: "i", typeID: "35", quantity: 40, stationID: "s", ownerID: "p" };
  const itemStore = { read: () => ({ itemID: "i", typeID: "35", stationID: "s", quantity: 40 }) };
  const args = { contract, delivery, itemStore };

  const before = reload("coopEconomyDeliveryAcceptance").createAcceptance({ journal });
  assert.equal(before.accept(args).quantity, 40);

  const after = reload("coopEconomyDeliveryAcceptance").createAcceptance({ journal });
  const replay = after.accept({ ...args, delivery: { ...delivery, quantity: 100 } });
  assert.equal(replay.code, "ALREADY_ACCEPTED");
  assert.equal(replay.quantity, 40, "a restart credited the inflated claim");
});

test("a split payout is not paid twice across a restart", () => {
  const journal = memoryJournal();
  const parties = [{ playerID: "a", role: "SUPPLIER", shareBps: 5000 },
    { playerID: "b", role: "CARRIER", shareBps: 5000 }];
  const work = { a: { verified: true, receiptID: "1" }, b: { verified: true, receiptID: "2" } };

  const before = reload("coopEconomySplitContract").createSplitContract({ journal });
  before.create({ contractID: "split-restart", totalCents: 1000, parties });
  const first = before.award({ contractID: "split-restart", work, disconnected: [] });
  assert.equal(first.totalPaidCents, 1000);

  const after = reload("coopEconomySplitContract").createSplitContract({ journal });
  const replay = after.award({ contractID: "split-restart", work, disconnected: [] });
  assert.equal(replay.code, "ALREADY_AWARDED", "a restart paid the contract again: " + replay.code);
  assert.equal(replay.paidCents, 0);
});

test("a gateway operation is quoted once across a restart", () => {
  const journal = memoryJournal();
  const args = { operationID: "op-restart", cents: 100, from: "a", to: "b" };
  const before = reload("coopEconomyFundsGateway").createGateway({ journal });
  assert.equal(before.commit(args).ok, true);

  const after = reload("coopEconomyFundsGateway").createGateway({ journal });
  const replay = after.commit(args);
  assert.notEqual(replay.duplicate, undefined, "the gateway has no duplicate flag at all");
  assert.equal(replay.duplicate, true, "a restart forgot the committed operation");
});

test("demand evidence is not counted twice across a restart", () => {
  const journal = memoryJournal();
  const before = reload("coopEconomyConsumptionFeedback").createDemandLedger({ journal });
  before.record({ evidenceID: "e-restart", hullID: "h1", typeID: "35", quantity: 10 });
  assert.equal(before.total(), 10);

  const after = reload("coopEconomyConsumptionFeedback").createDemandLedger({ journal });
  after.record({ evidenceID: "e-restart", hullID: "h1", typeID: "35", quantity: 10 });
  assert.equal(after.total(), 10, "the same consumption was counted twice after the restart");
  assert.equal(after.demandFor("35"), 10);
});

test("the same contract is not recorded twice across a restart", () => {
  const journal = memoryJournal();
  const args = { playerID: "p1", contractID: "c-restart", outcome: "SUCCESS", receiptID: "r1" };
  const before = reload("coopEconomyReputation").createReputation({ journal });
  assert.equal(before.record(args).code, "RECORDED");

  const after = reload("coopEconomyReputation").createReputation({ journal });
  const replay = after.record(args);
  assert.equal(replay.code, "ALREADY_RECORDED", "a restart recorded the same contract again: " + replay.code);
});
