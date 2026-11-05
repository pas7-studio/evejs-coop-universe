import { test } from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { join } from "node:path";

const require = createRequire(import.meta.url);
if (!process.env.EVEJS_FORK_ROOT) throw new Error("EVEJS_FORK_ROOT is unset");
const fork = process.env.EVEJS_FORK_ROOT.trim();
const sp = (n) => join(fork, "Code/server/src/space", n);

const Purchase = require(sp("coopEconomyPlayerPurchase.js"));
const Escrow = require(sp("coopEconomySellEscrow.js"));
const Settlement = require(sp("coopEconomySaleSettlement.js"));
const Transfer = require(sp("coopEconomyWarehouseTransfer.js"));
const Pnl = require(sp("coopEconomyPnl.js"));
const Competition = require(sp("coopEconomyOrderCompetition.js"));
const Distress = require(sp("coopEconomyDistress.js"));

const ask = { askID: "a1", sellerCorpID: "player-1", typeID: "35", quantity: 10, priceCents: 5 };

test("IE-037 purchasing: no self-trade and no purchase without funds", () => {
  let debits = 0;
  let transfers = 0;
  const ports = {
    settlementPort: { debit: () => { debits += 1; return { receiptID: "d1" }; } },
    itemPort: { transfer: () => { transfers += 1; return { receiptID: "t1" }; } },
  };
  const b = Purchase.createBuyer();
  const self = b.purchase({ operationID: "o1", buyerCorpID: "player-1", ask, walletCents: 100, ...ports });
  assert.equal(self.code, "SELF_TRADE");
  const poor = b.purchase({ operationID: "o2", buyerCorpID: "corp-a", ask, walletCents: 10, ...ports });
  assert.equal(poor.code, "INSUFFICIENT_FUNDS");
  assert.equal(debits, 0, "a refused purchase never touches the wallet");
  assert.equal(transfers, 0);

  const bought = b.purchase({ operationID: "o3", buyerCorpID: "corp-a", ask, walletCents: 100, ...ports });
  assert.equal(bought.code, "PURCHASED");
  assert.deepEqual(bought.fill, { askID: "a1", typeID: "35", quantity: 10 });
  assert.equal(bought.totalCents, 50);
  assert.equal(bought.debitReceiptID, "d1");
  assert.equal(bought.transferReceiptID, "t1");
  const replay = b.purchase({ operationID: "o3", buyerCorpID: "corp-a", ask, walletCents: 100, ...ports });
  assert.equal(replay.code, "ALREADY_PURCHASED");
  assert.equal(replay.debitReceiptID, "d1");
  assert.equal(debits, 1, "a replayed operation pays once");
  assert.equal(transfers, 1);
});

test("IE-037 purchasing: a receiptless debit stops before any transfer", () => {
  let transfers = 0;
  const b = Purchase.createBuyer();
  const r = b.purchase({
    operationID: "o9",
    buyerCorpID: "corp-a",
    ask,
    walletCents: 100,
    settlementPort: { debit: () => { throw new Error("timeout"); } },
    itemPort: { transfer: () => { transfers += 1; return { receiptID: "t1" }; } },
  });
  assert.equal(r.code, "SETTLEMENT_UNKNOWN");
  assert.equal(transfers, 0);
});

test("IE-038 escrow: fleet reserve and market escrow never share a unit", () => {
  const e = Escrow.createEscrow();
  assert.equal(e.stock({ itemID: "i1", quantity: 10 }).code, "STOCKED");
  assert.equal(e.reserve({ itemID: "i1", quantity: 4 }).code, "RESERVED");
  assert.equal(e.available("i1"), 6);
  assert.equal(e.list({ escrowID: "e1", itemID: "i1", quantity: 7, priceCents: 5 }).code, "INSUFFICIENT_STOCK");
  assert.equal(e.list({ escrowID: "e1", itemID: "i1", quantity: 6, priceCents: 5 }).code, "LISTED");
  assert.equal(e.available("i1"), 0, "reserved + listed covers all 10 units");
  assert.equal(e.list({ escrowID: "e2", itemID: "i1", quantity: 1, priceCents: 5 }).code, "ALREADY_LISTED");
  assert.equal(e.fill({ escrowID: "e1", quantity: 2 }).remaining, 4, "a partial fill keeps the exact remainder");
  assert.equal(e.fill({ escrowID: "e1", quantity: 5 }).code, "INSUFFICIENT_ESCROW");
  // IE-038: a filled unit is physically sold, so on-hand stock drops with it: 10 - 2 sold - 4 reserved - 4 escrowed = 0
  assert.equal(e.available("i1"), 0, "a sold unit is not free stock");
  assert.equal(e.cancel({ escrowID: "e1" }).code, "CANCELLED");
  // 8 on hand (2 sold) - 4 reserved = 4 free; the cancelled escrow never becomes reserve
  assert.equal(e.available("i1"), 4, "cancelling returns the unsold escrow to free stock, not to the reserve");
});

test("IE-039 settlement: one settlement per fill, and an ACK replay cannot credit twice", () => {
  let credits = 0;
  const walletPort = { credit: () => { credits += 1; return { receiptID: "c1" }; } };
  const s = Settlement.createSettlement();
  const first = s.settle({ fillID: "f1", ownerCorpID: "corp-a", grossCents: 100, taxCents: 5, feeCents: 5, walletPort });
  assert.equal(first.code, "SETTLED");
  assert.equal(first.netCents, 90);
  const replay = s.settle({ fillID: "f1", ownerCorpID: "corp-a", grossCents: 100, taxCents: 5, feeCents: 5, walletPort });
  assert.equal(replay.code, "ALREADY_SETTLED");
  assert.equal(replay.netCents, 90);
  assert.equal(credits, 1, "a lost ACK replay never credits the wallet again");
  assert.equal(s.settle({ fillID: "f2", ownerCorpID: "corp-a", grossCents: 10, taxCents: 5, feeCents: 9, walletPort }).code, "INVALID_SETTLEMENT");
});

test("IE-039 settlement: an unknown credit is sticky", () => {
  let credits = 0;
  const s = Settlement.createSettlement();
  const unknown = s.settle({
    fillID: "f3",
    ownerCorpID: "corp-a",
    grossCents: 100,
    taxCents: 0,
    feeCents: 0,
    walletPort: { credit: () => { credits += 1; throw new Error("timeout"); } },
  });
  assert.equal(unknown.code, "SETTLEMENT_UNKNOWN");
  const retry = s.settle({
    fillID: "f3",
    ownerCorpID: "corp-a",
    grossCents: 100,
    taxCents: 0,
    feeCents: 0,
    walletPort: { credit: () => { credits += 1; return { receiptID: "c9" }; } },
  });
  assert.equal(retry.code, "SETTLEMENT_UNKNOWN");
  assert.equal(credits, 1);
});

test("IE-040 intercorp: the same cargo cannot be purchased twice", () => {
  let calls = 0;
  const transferPort = {
    transferGoodsAndFunds: () => {
      calls += 1;
      return { goodsReceiptID: "g1", paymentReceiptID: "p1" };
    },
  };
  const t = Transfer.createTransfer();
  const args = {
    cargoID: "c1",
    sellerCorpID: "corp-a",
    buyerCorpID: "corp-b",
    typeID: "35",
    quantity: 10,
    priceCents: 5,
    buyerWalletCents: 100,
    transferPort,
  };
  assert.equal(t.transfer({ ...args, buyerCorpID: "corp-a" }).code, "SELF_TRADE");
  assert.equal(t.transfer({ ...args, buyerWalletCents: 10 }).code, "INSUFFICIENT_FUNDS");
  const done = t.transfer(args);
  assert.equal(done.code, "TRANSFERRED");
  assert.equal(done.totalCents, 50);
  const again = t.transfer(args);
  assert.equal(again.code, "ALREADY_TRANSFERRED");
  assert.equal(again.paymentReceiptID, "p1");
  assert.equal(calls, 1, "the authoritative transfer ran exactly once");
});

test("IE-040 intercorp: a partial or unknown transfer is never recorded as complete", () => {
  const t = Transfer.createTransfer();
  const base = {
    cargoID: "c2",
    sellerCorpID: "corp-a",
    buyerCorpID: "corp-b",
    typeID: "35",
    quantity: 10,
    priceCents: 5,
    buyerWalletCents: 100,
  };
  const partial = t.transfer({ ...base, transferPort: { transferGoodsAndFunds: () => ({ goodsReceiptID: "g2" }) } });
  assert.equal(partial.code, "PARTIAL_TRANSFER");
  assert.equal(partial.goodsReceiptID, "g2");
  assert.equal(partial.paymentReceiptID, undefined);
  const unknown = t.transfer({ ...base, cargoID: "c3", transferPort: { transferGoodsAndFunds: () => { throw new Error("ack lost"); } } });
  assert.equal(unknown.code, "TRANSFER_UNKNOWN");
  const completed = t.transfer({ ...base, cargoID: "c3", transferPort: { transferGoodsAndFunds: () => ({ goodsReceiptID: "g3", paymentReceiptID: "p3" }) } });
  assert.equal(completed.code, "TRANSFERRED", "an unknown transfer is not sticky here, it is simply not recorded");
});

test("IE-041 P&L: a warehouse move is never sale profit", () => {
  const withMove = Pnl.computePnl({
    transactions: [
      { kind: "SALE", cents: 100, costCents: 60 },
      { kind: "PURCHASE", cents: 40, costCents: 0 },
      { kind: "PRODUCTION", cents: 20, costCents: 0 },
      { kind: "WAREHOUSE_MOVE", cents: 9999, costCents: 9999 },
    ],
    stock: [{ quantity: 2, unitCostCents: 30 }],
  });
  assert.equal(withMove.ok, true);
  assert.equal(withMove.revenueCents, 100);
  assert.equal(withMove.costOfGoodsCents, 60);
  assert.equal(withMove.realizedCents, 40);
  assert.equal(withMove.committedCents, 60);
  assert.equal(withMove.stockValueCents, 60);
  assert.equal(withMove.cashCents, 40);
  assert.equal(withMove.reconciled, true);
  const withoutMove = Pnl.computePnl({
    transactions: [
      { kind: "SALE", cents: 100, costCents: 60 },
      { kind: "PURCHASE", cents: 40, costCents: 0 },
      { kind: "PRODUCTION", cents: 20, costCents: 0 },
    ],
    stock: [{ quantity: 2, unitCostCents: 30 }],
  });
  assert.deepEqual(
    { realized: withoutMove.realizedCents, committed: withoutMove.committedCents, cash: withoutMove.cashCents },
    { realized: 40, committed: 60, cash: 40 },
    "the move changed nothing at all",
  );
  assert.equal(Pnl.computePnl({ transactions: [{ kind: "NOPE", cents: 1, costCents: 0 }], stock: [] }).code, "INVALID_TRANSACTION");
});

test("IE-042 competition: a player's better-priced order wins and the NPC is bounded", () => {
  const orders = [
    { orderID: "o1", ownerID: "player-1", priceCents: 100, quantity: 5 },
    { orderID: "o2", ownerID: "npc-a", priceCents: 120, quantity: 5 },
  ];
  const base = { orders, tick: 10, minDelayTicks: 5, maxStepCents: 10, maxPriceCents: 500, ordersThisTick: 1, maxOrdersPerTick: 3 };
  const win = Competition.chooseFill({ ...base, npc: { corpID: "npc-a", priceCents: 99, lastRepriceTick: 0 } });
  assert.deepEqual({ code: win.code, orderID: win.orderID, priceCents: win.priceCents }, { code: "MATCH", orderID: "o1", priceCents: 100 });
  assert.equal(
    Competition.chooseFill({ ...base, npc: { corpID: "npc-a", priceCents: 130, lastPriceCents: 99, lastRepriceTick: 0 } }).code,
    "REPRICE_OUT_OF_BOUNDS",
    "a single repricing may not jump 30 cents",
  );
  assert.equal(
    Competition.chooseFill({ ...base, npc: { corpID: "npc-a", priceCents: 99, lastRepriceTick: 9 } }).code,
    "REACTION_DELAY",
  );
  assert.equal(
    Competition.chooseFill({ ...base, npc: { corpID: "npc-a", priceCents: 99, lastRepriceTick: 0 }, ordersThisTick: 9 }).code,
    "ORDER_SPAM",
  );
  assert.equal(
    Competition.chooseFill({ ...base, npc: { corpID: "npc-a", priceCents: 5000, lastRepriceTick: 0 } }).code,
    "INFINITY_BID",
  );
  assert.equal(
    Competition.chooseFill({ ...base, orders: [{ orderID: "o3", ownerID: "npc-a", priceCents: 100, quantity: 1 }], npc: { corpID: "npc-a", priceCents: 99, lastRepriceTick: 0 } }).code,
    "SELF_TRADE_ONLY",
  );
  const npcBest = Competition.chooseFill({ ...base, npc: { corpID: "npc-a", priceCents: 200, lastPriceCents: 195, lastRepriceTick: 0 } });
  assert.equal(npcBest.code, "NO_MATCH");
  assert.equal(npcBest.reason, "NPC_BEST");
});

test("IE-043 distress: cash starvation suspends spending and never invents cash", () => {
  const starved = Distress.assessDistress({ walletCents: 0, commitmentsCents: 50, minimumReserveCents: 0 });
  assert.equal(starved.mode, "DISTRESSED");
  assert.equal(starved.code, "CASH_STARVED");
  assert.equal(starved.suspendSpending, true);
  const low = Distress.assessDistress({ walletCents: 100, commitmentsCents: 90, minimumReserveCents: 50 });
  assert.equal(low.code, "LOW_RESERVE");
  assert.deepEqual(low.actions, ["SUSPEND_SPENDING", "LIQUIDATE_SURPLUS"]);
  const healthy = Distress.assessDistress({ walletCents: 100, commitmentsCents: 10, minimumReserveCents: 10 });
  assert.equal(healthy.mode, "NORMAL");
  assert.equal(healthy.suspendSpending, false);
  assert.equal(Distress.assessDistress({ walletCents: -1, commitmentsCents: 0, minimumReserveCents: 0 }).code, "INVALID_STATE");
});

test("IE-043 distress: escrow and reserved stock cannot disappear during liquidation", () => {
  const r = Distress.liquidate({
    surplus: [
      { itemID: "i1", quantity: 10, reservedQuantity: 10, unitValueCents: 5 },
      { itemID: "i2", quantity: 4, reservedQuantity: 0, unitValueCents: 2 },
    ],
    escrowCents: 100,
  });
  assert.equal(r.code, "LIQUIDATED");
  assert.equal(r.liquidatedCents, 8, "only the four unreserved units are sold");
  assert.equal(r.protectedCents, 150, "100 escrowed + 50 of fully reserved stock");
  assert.deepEqual(r.items, [
    { itemID: "i1", quantity: 0 },
    { itemID: "i2", quantity: 4 },
  ]);
  assert.equal(Distress.liquidate({ surplus: [{ itemID: "", quantity: 1, reservedQuantity: 0, unitValueCents: 1 }], escrowCents: 0 }).code, "INVALID_SURPLUS");
});

// WAVE2-REGRESSION
test("IE-042 competition: a duplicated order id makes the book ambiguous and is refused", () => {
  const orders = [
    { orderID: "x", ownerID: "player-1", priceCents: 5, quantity: 1 },
    { orderID: "x", ownerID: "npc-a", priceCents: 6, quantity: 1 },
  ];
  const r = Competition.chooseFill({ orders, npc: { corpID: "npc-a", priceCents: 5, lastRepriceTick: 0 }, tick: 10, minDelayTicks: 1, maxStepCents: 10, maxPriceCents: 100, ordersThisTick: 1, maxOrdersPerTick: 2 });
  assert.equal(r.ok, false);
  assert.equal(r.code, "INVALID_ORDER");
  const tie = Competition.chooseFill({ orders: [{ orderID: "p", ownerID: "player-1", priceCents: 50, quantity: 1 }, { orderID: "n", ownerID: "npc-a", priceCents: 50, quantity: 1 }], npc: { corpID: "npc-a", priceCents: 50, lastRepriceTick: 0 }, tick: 10, minDelayTicks: 1, maxStepCents: 10, maxPriceCents: 100, ordersThisTick: 1, maxOrdersPerTick: 2 });
  assert.equal(tie.orderID, "p", "at an equal price the player keeps the fill");
});
