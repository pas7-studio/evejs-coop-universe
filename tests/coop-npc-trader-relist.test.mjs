import test from "node:test";
import assert from "node:assert/strict";
import crypto from "node:crypto";
import { createRequire } from "node:module";
import path from "node:path";

// The other half of the owner's rule: "buy at 70-90 % of the market, RESELL at 105-140 %."
// A resale must be a real native sell order with escrowed inventory behind it, priced on the band,
// and only for a stack this trader really bought.
const forkRoot = process.env.EVEJS_FORK_ROOT || "C:/Games/EveCoop/upstream-evejs";
const require = createRequire(import.meta.url);
const { createTraderRelist, operationFor, ESCROW_BASE } =
  require(path.join(forkRoot, "Code/server/src/space/coopNpcTraderRelist.js"));

const CORP = 1000035;
const HUB = 60003760;
const ITEM = 9988400125771;
const TYPE = 34;
const QTY = 50;

function fixture({ stock = [{ itemID: ITEM, typeID: TYPE, quantity: QTY }],
  referenceCents = 393, reserve = "ok", activate = "ok", itemInHangar = true } = {}) {
  const items = new Map();
  if (itemInHangar) {
    items.set(ITEM, { itemID: ITEM, ownerID: CORP, typeID: TYPE, quantity: QTY,
      stacksize: QTY, singleton: 0, locationID: HUB, flagID: 4 });
  }
  const escrows = new Map();
  const calls = [];
  let nextOrder = 700001;
  const reservedPrice = new Map();
  const gameStore = {
    coopAtomicNativeRows: {
      transact(tables, work) {
        const tx = {
          get: (table, key) => (table === "items" ? items.get(Number(key)) : escrows.get(String(key))),
          put: (table, key, value) => {
            if (table === "items") items.set(Number(key), value);
            else escrows.set(String(key), value);
          },
        };
        return work(tx);
      },
    },
  };
  const relist = createTraderRelist({
    call: async (method, params) => {
      calls.push({ method, params });
      if (method === "ReserveNpcSellOrder") {
        if (reserve === "notverified") return { order_id: "1", operation_id: "other" };
        reservedPrice.set(params.operation_id, params.price);
        return { order_id: String(nextOrder), operation_id: params.operation_id,
          source_item_id: String(params.source_item_id), owner_id: CORP, station_id: HUB,
          type_id: TYPE, quantity: QTY, price: params.price, bid: false, is_corp: true,
          source: "coop-npc", vol_remaining: QTY, state: "pending" };
      }
      if (method === "ActivateNpcSellOrder") {
        const orderID = params.order_id;
        if (activate === "notverified") return { state: "pending" };
        return { order_id: orderID, operation_id: params.operation_id,
          source_item_id: params.source_item_id, owner_id: CORP, station_id: HUB,
          type_id: TYPE, quantity: QTY, price: reservedPrice.get(params.operation_id), bid: false, is_corp: true,
          source: "coop-npc", vol_remaining: QTY, state: "open" };
      }
      throw new Error("unexpected " + method);
    },
    gameStore,
    getNativeItem: (id) => items.get(Number(id)) || null,
    getNativeEscrow: (orderID) => escrows.get(String(orderID)) || null,
    verifyNativeCorporation: (corpID) => Number(corpID) === CORP,
    verifyStation: (stationID) => Number(stationID) === HUB,
    readBoughtStacks: () => stock,
    resolvePriceCents: async () => referenceCents,
    clock: () => 1_700_000_000_000,
    maxListingsPerTick: 3,
  });
  return { relist, calls, items, escrows, ITEM, CORP, HUB, stock };
}


test("a bought stack is listed at 140 % of the reference, never under 105 %", async () => {
  process.env.EVEJS_COOP_NATIVE_ATOMIC_ROWS = "1";
  process.env.EVEJS_COOP_TRADER_RELIST = "1";
  const f = fixture({ referenceCents: 393 });
  const result = await f.relist.tick({ corporationID: CORP, stationID: HUB });
  assert.equal(result.status, "TRADER_RELISTED");
  const reserve = f.calls.find((row) => row.method === "ReserveNpcSellOrder");
  assert.equal(Math.round(reserve.params.price * 100), 550, "140 % of 3.93 ISK = 5.50 ISK");
  assert.equal(reserve.params.is_corp, true);
  assert.equal(reserve.params.wallet_division, 1000);
  assert.equal(reserve.params.bid, false);
});

test("the escrow row carries the trade provenance and the price", async () => {
  process.env.EVEJS_COOP_NATIVE_ATOMIC_ROWS = "1";
  process.env.EVEJS_COOP_TRADER_RELIST = "1";
  const f = fixture({ referenceCents: 393 });
  await f.relist.tick({ corporationID: CORP, stationID: HUB });
  const escrow = [...f.escrows.values()][0];
  assert.equal(escrow.coopSource, "NATIVE_TRADE");
  assert.equal(escrow.isCorp, true);
  assert.equal(escrow.coopTradePriceCents, 550);
  assert.match(escrow.coopOperationID, /^npc-trade:[0-9a-f]{32}$/);
  assert.equal(escrow.escrowLocationID, ESCROW_BASE + Number(escrow.orderId));
});

test("the operation id is stable for the same stack, so a retry cannot double-list it", () => {
  const a = operationFor(ITEM, TYPE, QTY);
  assert.equal(a, operationFor(ITEM, TYPE, QTY));
  assert.notEqual(a, operationFor(ITEM + 1, TYPE, QTY));
  assert.match(a, /^npc-trade:[0-9a-f]{32}$/);
  // and it is a pure function of the stack, not of a clock or a random source
  assert.equal(a, "npc-trade:" + crypto.createHash("sha256")
    .update(`${ITEM}:${TYPE}:${QTY}`).digest("hex").slice(0, 32));
});

test("nothing is listed when the flags are off, the stock is empty or the price is unknown", async () => {
  delete process.env.EVEJS_COOP_TRADER_RELIST;
  const off = fixture({});
  assert.equal((await off.relist.tick({ corporationID: CORP, stationID: HUB })).status, "DISABLED");
  process.env.EVEJS_COOP_TRADER_RELIST = "1";
  process.env.EVEJS_COOP_NATIVE_ATOMIC_ROWS = "1";
  const empty = fixture({ stock: [] });
  assert.equal((await empty.relist.tick({ corporationID: CORP, stationID: HUB })).status, "NO_STOCK");
  const noPrice = fixture({ referenceCents: 0 });
  const result = await noPrice.relist.tick({ corporationID: CORP, stationID: HUB });
  assert.equal(result.listed.length, 0, "no reference price, no order");
});

test("a stack that is not in the corporation hangar is never listed", async () => {
  process.env.EVEJS_COOP_NATIVE_ATOMIC_ROWS = "1";
  process.env.EVEJS_COOP_TRADER_RELIST = "1";
  const f = fixture({ itemInHangar: false });
  const result = await f.relist.tick({ corporationID: CORP, stationID: HUB });
  assert.equal(result.listed[0].status, "BLOCKED");
  assert.equal(result.listed[0].reason, "TRADER_RELIST_UNBACKED_SOURCE");
});

test("an unverified native reserve or activation blocks instead of claiming success", async () => {
  process.env.EVEJS_COOP_NATIVE_ATOMIC_ROWS = "1";
  process.env.EVEJS_COOP_TRADER_RELIST = "1";
  const badReserve = fixture({ reserve: "notverified" });
  const first = await badReserve.relist.tick({ corporationID: CORP, stationID: HUB });
  assert.equal(first.listed[0].status, "BLOCKED");
  assert.equal(first.listed[0].reason, "TRADER_RELIST_PENDING_NOT_VERIFIED");
  const badActivate = fixture({ activate: "notverified" });
  const second = await badActivate.relist.tick({ corporationID: CORP, stationID: HUB });
  assert.equal(second.listed[0].status, "BLOCKED");
  assert.equal(second.listed[0].reason, "TRADER_RELIST_ACTIVATION_UNVERIFIED");
});
