import test from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";

// The owner's resale half, closed from the other side: the corporation lists what it bought
// (space/coopNpcTraderRelist.js) and the OWNER must be able to buy it back.
//
// A coop-npc ask never settles like a character sale: the buyer path branches into
// space/coopNpcCorporateBuyRuntime, which claims the order in Rust, moves the money and the item in
// ONE GameStore transaction, and finalizes the claim. This file pins that third provenance
// (`npc-trade:`), which is neither industry output nor salvage: the item is a module or a whole
// stack the corporation really paid for, so the custody rules and the 1 M ISK ceiling that were
// written for manufactured goods do not fit it.
const require = createRequire(import.meta.url);
const { createNpcCorporateSettlement, TABLES } =
  require("../integration/coopNpcCorporateSettlement.cjs");

const CORP = 1000035;
const BUYER = 140000005;
const HUB = 60003760;
const ITEM = 9988400126863;
const TYPE = 23803;
const OP = "npc-trade:571c74164bf00b2213df5099c9c89536";
const ORDER = 574;
const PRICE_CENTS = 13920200000; // 139.202 M ISK: a real module, far above the old 1 M ceiling
const FILL = 400000000000574;
const ESCROW_LOCATION = 9200000000 + ORDER;

function fixture({ singleton = true, quantity = 1, coopSource = "NATIVE_TRADE",
  corpRowId = undefined, buyerBalance = 200000000, priceCents = PRICE_CENTS } = {}) {
  const keyCorp = "corporations\u001f" + CORP;
  const fillKey = "order\u001f" + ORDER;
  // The live corporationRuntime row is stored BY KEY and carries no corporationID (measured
  // 2026-11-06 on evejs-server-1); corpRowId lets a test put one back to prove a real conflict.
  const corp = { wallet: { divisions: { "1000": { key: 1000, balance: 48773176000,
    journal: [], transactions: [] } } } };
  if (corpRowId !== undefined) corp.corporationID = corpRowId;
  const data = {
    characters: { [BUYER]: { characterID: BUYER, balance: buyerBalance,
      walletJournal: [], marketTransactions: [] } },
    corporationRuntime: { [keyCorp]: corp },
    items: { [ITEM]: { itemID: ITEM, ownerID: CORP, locationID: ESCROW_LOCATION, flagID: 4,
      singleton: singleton ? 1 : 0, quantity: singleton ? -1 : quantity,
      stacksize: singleton ? 1 : quantity, typeID: TYPE, customInfo: "" } },
    marketEscrow: { [ORDER]: { orderId: String(ORDER), escrowType: "sell", isCorp: true,
      ownerId: CORP, stationId: HUB, sourceItemID: ITEM, coopOperationID: OP,
      coopSource, escrowLocationID: ESCROW_LOCATION, remainingQuantity: quantity,
      coopTradePriceCents: priceCents } },
    npcMarketFills: {},
  };
  let state = "open", claimCalls = 0, finalizeCalls = 0;
  const clone = (v) => structuredClone(v);
  const gameStore = { transact: (tables, fn) => {
    assert.deepEqual(tables, TABLES);
    const backup = clone(data);
    try {
      return fn({ get: (t, k) => data[t][k] ?? null,
        put: (t, k, v) => { data[t][k] = v; },
        del: (t, k) => { delete data[t][k]; },
        scan: () => [] });
    } catch (error) {
      for (const t of TABLES) data[t] = backup[t];
      throw error;
    }
  } };
  const order = () => ({ source: "coop-npc", state: "settling", operation_id: OP,
    order_id: String(ORDER), source_item_id: String(ITEM), owner_id: CORP, station_id: HUB,
    type_id: TYPE, quantity, buyer_id: String(BUYER), fill_id: String(FILL),
    price_cents: priceCents, is_corp: true, bid: false });
  const market = {
    claimOnce: async () => { claimCalls += 1; state = "settling"; return order(); },
    finalizeOnce: async () => { finalizeCalls += 1; state = "filled";
      return { state: "filled", order_id: String(ORDER), buyer_id: String(BUYER),
        fill_id: String(FILL), vol_remaining: 0 }; },
    inspectClaim: async () => ({ state, buyer_id: String(BUYER), fill_id: String(FILL) }),
  };
  const bridge = createNpcCorporateSettlement({ gameStore, market,
    verifyBuyerSession: () => true, verifyNpcCorporation: () => true,
    clock: () => 1761390000000 });
  const identity = { operationID: OP, orderID: ORDER, ownerID: CORP, stationID: HUB,
    typeID: TYPE, itemID: ITEM, quantity };
  return { data, bridge, market, identity, keyCorp, fillKey,
    get claims() { return claimCalls; }, get finalizes() { return finalizeCalls; } };
}

async function run(cb, options) {
  const a = process.env.EVEJS_COOP_NATIVE_ATOMIC_ROWS;
  const b = process.env.EVEJS_COOP_NATIVE_NPC_CORP_SETTLEMENT_PROOF;
  process.env.EVEJS_COOP_NATIVE_ATOMIC_ROWS = "1";
  process.env.EVEJS_COOP_NATIVE_NPC_CORP_SETTLEMENT_PROOF = "1";
  try { return await cb(fixture(options)); }
  finally {
    if (a === undefined) delete process.env.EVEJS_COOP_NATIVE_ATOMIC_ROWS;
    else process.env.EVEJS_COOP_NATIVE_ATOMIC_ROWS = a;
    if (b === undefined) delete process.env.EVEJS_COOP_NATIVE_NPC_CORP_SETTLEMENT_PROOF;
    else process.env.EVEJS_COOP_NATIVE_NPC_CORP_SETTLEMENT_PROOF = b;
  }
}

test("the owner buys a relisted SINGLETON module for its real price", () => run(async (f) => {
  const result = await f.bridge.purchaseOnce({ buyerID: BUYER, identity: f.identity,
    maxPriceCents: PRICE_CENTS });
  assert.equal(result.status, "PURCHASED");
  assert.equal(result.grossCents, PRICE_CENTS);
  // Money: exactly the quoted price leaves the buyer and arrives at the corporation.
  assert.equal(f.data.characters[BUYER].balance, 200000000 - PRICE_CENTS / 100);
  assert.equal(f.data.corporationRuntime[f.keyCorp].wallet.divisions["1000"].balance,
    48773176000 + PRICE_CENTS / 100);
  // Goods: the same physical module, now the buyer's, in the station hangar, still a singleton.
  const item = f.data.items[ITEM];
  assert.equal(item.ownerID, BUYER);
  assert.equal(item.locationID, HUB);
  assert.equal(item.flagID, 4);
  assert.equal(item.singleton, 1);
  assert.equal(item.quantity, -1);
  assert.equal(item.stacksize, 1);
  assert.equal(f.data.marketEscrow[ORDER], undefined, "the escrow row is consumed");
  const receipt = f.data.npcMarketFills[f.fillKey];
  assert.equal(receipt.phase, "NATIVE_COMMITTED");
  assert.equal(receipt.coopSource, "NATIVE_TRADE");
  assert.equal(receipt.fillID, FILL);
  assert.equal(f.claims, 1);
  assert.equal(f.finalizes, 1);
}));

test("a bought whole stack relists and sells back the same way", () => run(async (f) => {
  const result = await f.bridge.purchaseOnce({ buyerID: BUYER, identity: f.identity,
    maxPriceCents: PRICE_CENTS });
  assert.equal(result.status, "PURCHASED");
  const item = f.data.items[ITEM];
  assert.equal(item.ownerID, BUYER);
  assert.equal(item.quantity, 40);
  assert.equal(item.stacksize, 40);
  assert.equal(item.singleton, 0);
}, { singleton: false, quantity: 40, priceCents: 393 }));

test("the corporation row is keyed: a row without its own id is not a conflict", () => run(async (f) => {
  // The live row has no corporationID at all; demanding one refused every real corporation.
  assert.equal(f.data.corporationRuntime[f.keyCorp].corporationID, undefined);
  const result = await f.bridge.purchaseOnce({ buyerID: BUYER, identity: f.identity,
    maxPriceCents: PRICE_CENTS });
  assert.equal(result.status, "PURCHASED");
}));

test("a corporation row that names a different corporation is refused", () => run(async (f) => {
  const snapshot = structuredClone(f.data);
  await assert.rejects(f.bridge.purchaseOnce({ buyerID: BUYER, identity: f.identity,
    maxPriceCents: PRICE_CENTS }), /CORPORATE_WALLET_INVALID/);
  assert.deepEqual(f.data, snapshot);
  assert.equal(f.finalizes, 0);
}, { corpRowId: 1000036 }));

test("a trade order must carry trade provenance, not industry or salvage", () => run(async (f) => {
  const snapshot = structuredClone(f.data);
  await assert.rejects(f.bridge.purchaseOnce({ buyerID: BUYER, identity: f.identity,
    maxPriceCents: PRICE_CENTS }), /ESCROW_MISSING/);
  assert.deepEqual(f.data, snapshot);
}, { coopSource: "NATIVE_INDUSTRY" }));

test("a manufactured stack cannot be sold under a trade operation id", () => run(async (f) => {
  // The industry provenance marker without an npc-trade escrow is a different authority.
  const snapshot = structuredClone(f.data);
  await assert.rejects(f.bridge.purchaseOnce({ buyerID: BUYER, identity: f.identity,
    maxPriceCents: PRICE_CENTS }), /ESCROW_MISSING/);
  assert.deepEqual(f.data, snapshot);
}, { coopSource: "NATIVE_INDUSTRY", singleton: false, quantity: 40, priceCents: 393 }));

test("a replay after the native commit never debits a second time", () => run(async (f) => {
  const first = await f.bridge.purchaseOnce({ buyerID: BUYER, identity: f.identity,
    maxPriceCents: PRICE_CENTS });
  const after = structuredClone(f.data);
  const second = await f.bridge.purchaseOnce({ buyerID: BUYER, identity: f.identity,
    maxPriceCents: PRICE_CENTS });
  assert.equal(first.status, "PURCHASED");
  assert.equal(second.status, "PURCHASED");
  assert.deepEqual(f.data, after);
}));

test("the buyer cannot pay less than the module is listed for", () => run(async (f) => {
  const snapshot = structuredClone(f.data);
  await assert.rejects(f.bridge.purchaseOnce({ buyerID: BUYER, identity: f.identity,
    maxPriceCents: PRICE_CENTS - 1 }), /PRICE_EXCEEDS_PLAYER_LIMIT/);
  assert.deepEqual(f.data, snapshot);
  assert.equal(f.finalizes, 0);
}));
