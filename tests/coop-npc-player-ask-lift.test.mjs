import test from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import path from "node:path";

// COOP-LIFT (owner rule 2026-11-06: "buy the asks if they are a reasonable price").
//
// The pinned market daemon implements no NPC claim RPC (measured 2026-11-06: `rpc.rs` has no
// "claim" arm), so the trader closes the player's order with `FillOrder` - a primitive that changes
// the book and pays nobody - and then settles the money with the unchanged COOP-048 transaction.
// These tests pin the two things that make that safe: it never pays twice, and it never pays for a
// fill somebody else made.
const forkRoot = process.env.EVEJS_FORK_ROOT || "C:/Games/EveCoop/upstream-evejs";
const require = createRequire(import.meta.url);
const { createNpcPlayerAskLift, deriveFillID } =
  require(path.join(forkRoot, "Code/server/src/space/coopNpcPlayerAskLift.js"));
const { TABLES, createNpcCorporateBuyer } =
  require(path.join(forkRoot, "Code/server/src/space/coopNpcCorporateBuyerAtomic.js"));

const BUYER = 1000035, SELLER = 140000005, STATION = 60003760, TYPE = 23803, ORDER = 281,
  ITEM = 400001, CLAIM = "npc-corpbuy:0123456789abcdef0123456789abcdef";
const FILL = deriveFillID(CLAIM);
const CKEY = "corporations\u001f" + BUYER, RECEIPT = "corp-buy\u001f" + FILL;
const UNIT_CENTS = 125, QUANTITY = 20;

const requestFor = (unitCents, quantity) => ({ claimKey: CLAIM, buyerCorpID: BUYER,
  sellerID: SELLER, stationID: STATION, typeID: TYPE, orderID: ORDER, quantity,
  maxUnitPriceCents: unitCents, minReserveCents: 10000 });

function fixture({ buyerISK = 1000, bookState = "open", unitCents = UNIT_CENTS,
  quantity = QUANTITY, escrowPrice = null, faultOn = null, ackPatch = null,
  singleton = false, wrapOrder = false } = {}) {
  const bookPrice = unitCents / 100;
  const escrowPriceISK = escrowPrice === null ? bookPrice : escrowPrice;
  const data = {
    corporationRuntime: { [CKEY]: { corporationID: BUYER, wallet: { divisions: { "1000": {
      balance: buyerISK, journal: [], transactions: [] } } } } },
    characters: { [SELLER]: { characterID: SELLER, balance: 100,
      walletJournal: [], marketTransactions: [] } },
    items: { [ITEM]: { itemID: ITEM, typeID: TYPE, ownerID: SELLER,
      locationID: 9200000000 + ORDER, flagID: 4, singleton: singleton ? 1 : 0, categoryID: 8,
      quantity: singleton ? -1 : quantity, stacksize: singleton ? 1 : quantity } },
    marketEscrow: { [ORDER]: { orderId: String(ORDER), escrowType: "sell", isCorp: false,
      ownerId: SELLER, stationId: STATION, typeId: TYPE, price: escrowPriceISK,
      escrowLocationID: 9200000000 + ORDER, remainingQuantity: quantity } },
    npcMarketFills: {},
  };
  const copy = (v) => structuredClone(v);
  let failing = faultOn;
  const gameStore = {
    read: (table, pth) => {
      const key = String(pth).replace(/^\//, "");
      const row = data[table] ? data[table][key] : undefined;
      return row === undefined ? { success: false, errorMsg: "ENTRY_NOT_FOUND", data: null }
        : { success: true, errorMsg: null, data: row };
    },
    coopAtomicNativeRows: {
      transact: (tables, mutation) => {
        assert.deepEqual(tables, TABLES.filter((t) => tables.includes(t)),
          "only allow-listed tables are written");
        const backup = copy(data);
        try {
          return mutation({
            get: (t, k) => data[t]?.[k] ?? null,
            scan: (t) => Object.entries(data[t]).map(([key, value]) => ({ key, value })),
            put: (t, k, v) => {
              if (failing === t) { failing = null; throw Error("INJECTED_ATOMIC_FAULT:" + t); }
              data[t][k] = v;
            },
            del: (t, k) => { delete data[t][k]; },
          });
        } catch (error) {
          for (const table of TABLES) data[table] = backup[table];
          throw error;
        }
      },
    },
  };
  const calls = [];
  const book = { order_id: String(ORDER), owner_id: SELLER, is_corp: false, bid: false,
    station_id: STATION, type_id: TYPE, price: bookPrice, state: bookState,
    vol_remaining: bookState === "open" ? quantity : 0, source: "player" };
  const marketClient = { call: async (method, params) => {
    calls.push({ method, params });
    if (method === "GetOrder") {
      if (!wrapOrder) return { ...book };
      // The real daemon splits the order: identity/state on top, the row nested.
      const { bid, price, station_id, type_id, vol_remaining, source, ...identity } = book;
      return { ...identity, source, row: { bid, price, station_id, type_id, vol_remaining, source } };
    }
    if (method === "FillOrder") {
      if (bookState !== "open") throw Error("test: order is not open");
      bookState = "filled"; book.state = "filled"; book.vol_remaining = 0;
      const ack = { order_id: String(ORDER), owner_id: SELLER, is_corp: false, bid: false,
        station_id: STATION, type_id: TYPE, price: bookPrice,
        filled_quantity: params.fill_quantity, vol_remaining: 0, state: "filled",
        invalidated: true };
      return ackPatch ? { ...ack, ...ackPatch() } : ack;
    }
    if (method === "RecordTrade") return { status: "recorded" };
    throw Error("test: unexpected " + method);
  } };
  const itemStore = { listOwnedItems: (owner) => Object.values(data.items)
    .filter((item) => item.ownerID === owner) };
  const market = { claimOnce: async () => { throw Error("NO_RUST_CLAIM_RPC"); },
    finalizeOnce: async () => { throw Error("NO_RUST_CLAIM_RPC"); },
    inspectClaim: async () => { throw Error("NO_RUST_CLAIM_RPC"); } };
  const buyer = createNpcCorporateBuyer({ gameStore: gameStore.coopAtomicNativeRows, market,
    verifyBuyerCorporation: () => true, verifyPlayerSeller: () => true,
    quoteSellerTax: ({ sellerID, stationID, grossCents }) => ({ sellerID, stationID, grossCents,
      taxCents: Math.round(grossCents * 0.08), policy: "EVEJS_NATIVE_MARKET_RULES" }),
    clock: () => 1762000000000 });
  const lift = createNpcPlayerAskLift({ gameStore, itemStore, marketClient, buyer,
    verifyBuyerCorporation: () => true, verifyPlayerSeller: () => true,
    clock: () => 1762000000000,
    recordTrade: (args) => marketClient.call("RecordTrade", args) });
  return { data, lift, request: requestFor(unitCents, quantity), calls, book,
    fills: () => calls.filter((call) => call.method === "FillOrder").length,
    trades: () => calls.filter((call) => call.method === "RecordTrade").length,
    failNextPut: (table) => { failing = table; } };
}

async function run(callback, options) {
  const keys = ["EVEJS_COOP_NATIVE_ATOMIC_ROWS", "EVEJS_COOP_NPC_BUY_PLAYER_ASK"];
  const originals = keys.map((key) => process.env[key]);
  for (const key of keys) process.env[key] = "1";
  try { return await callback(fixture(options)); }
  finally {
    keys.forEach((key, index) => {
      if (originals[index] === undefined) delete process.env[key];
      else process.env[key] = originals[index];
    });
  }
}

test("a reasonable ask is lifted whole: real ISK moves, the stack moves, nothing is minted", () =>
  run(async (f) => {
    const result = await f.lift.liftOnce(f.request);
    assert.equal(result.status, "NPC_PURCHASED_PLAYER_GOODS");
    assert.equal(result.itemID, ITEM);
    // The claim key is what the post-commit seller notification looks the fill up by. Without it
    // the seller's client was never told the item left his hangar, and every later action on the
    // ghost failed with "not owned by the active character" (measured live 2026-11-06 16:26).
    assert.equal(result.operation, f.request.claimKey);
    assert.equal(f.fills(), 1, "the playER ask is closed exactly once");
    assert.equal(f.data.corporationRuntime[CKEY].wallet.divisions["1000"].balance, 975);
    assert.equal(f.data.characters[SELLER].balance, 123, "gross minus the real native tax");
    assert.equal(f.data.items[ITEM].ownerID, BUYER);
    assert.equal(f.data.items[ITEM].locationID, STATION);
    assert.equal(f.data.marketEscrow[ORDER], undefined);
    assert.equal(f.data.npcMarketFills[RECEIPT].phase, "NATIVE_NPC_BUY_COMMITTED");
    assert.equal(f.data.npcMarketFills[RECEIPT].netCents, 2300);
    assert.equal(f.trades(), 1, "the public price history records the real fill once");
  }));

test("the same claim never pays twice, even when the book is already closed", () => run(async (f) => {
  await f.lift.liftOnce(f.request);
  const before = structuredClone(f.data);
  const again = await f.lift.liftOnce(f.request);
  assert.equal(again.status, "NPC_PURCHASED_PLAYER_GOODS");
  assert.equal(again.replayed, true);
  assert.equal(again.operation, f.request.claimKey, "a replay names the same claim");
  assert.deepEqual(f.data, before);
  assert.equal(f.fills(), 1);
  assert.equal(f.trades(), 1);
}));

test("a crash between the book fill and the payment is resumed exactly once", () => run(async (f) => {
  f.failNextPut("corporationRuntime");
  await assert.rejects(f.lift.liftOnce(f.request), /INJECTED_ATOMIC_FAULT/);
  assert.equal(f.book.state, "filled", "the order really is closed");
  assert.equal(f.data.characters[SELLER].balance, 100, "and the seller really is unpaid");
  assert.equal(f.data.npcMarketFills[RECEIPT].phase, "LIFT_FILL_ISSUED",
    "the durable marker is what proves the fill was ours");
  const recovered = await f.lift.liftOnce(f.request);
  assert.equal(recovered.status, "NPC_PURCHASED_PLAYER_GOODS");
  assert.equal(f.data.characters[SELLER].balance, 123);
  assert.equal(f.data.items[ITEM].ownerID, BUYER);
  assert.equal(f.fills(), 1, "the order is never filled twice");
  assert.equal(f.data.npcMarketFills[RECEIPT].phase, "NATIVE_NPC_BUY_COMMITTED");
}));

test("an order somebody else closed is never paid for", () => run(async (f) => {
  f.book.state = "filled";
  f.book.vol_remaining = 0;
  const before = structuredClone(f.data);
  const result = await f.lift.liftOnce(f.request);
  assert.equal(result.status, "BLOCKED");
  assert.equal(result.reason, "NPC_LIFT_FOREIGN_FILL");
  assert.deepEqual(f.data, before);
}));

test("the escrow price and the book price must be the same money", () => run(async (f) => {
  const mismatched = fixture({ escrowPrice: 1.2 });
  const result = await mismatched.lift.liftOnce(mismatched.request);
  assert.equal(result.reason, "NPC_LIFT_PRICE_AUTHORITY_DISAGREE");
  assert.equal(mismatched.fills(), 0, "nothing is closed when the two authorities disagree");
  assert.equal(mismatched.data.characters[SELLER].balance, 100);
}));

test("an ask above the ceiling is not touched at all", () => run(async (f) => {
  const result = await f.lift.liftOnce({ ...f.request, maxUnitPriceCents: UNIT_CENTS - 1 });
  assert.equal(result.status, "BLOCKED");
  assert.equal(result.reason, "NPC_LIFT_ASK_ABOVE_CEILING");
  assert.equal(f.fills(), 0);
}));

test("a wrong fill ACK is refused: no money follows a fill we cannot verify", () =>
  run(async (f) => {
    // The daemon answers with a different remaining volume than the one we verified.
    const lying = fixture({ ackPatch: () => ({ vol_remaining: 5 }) });
    await assert.rejects(lying.lift.liftOnce(lying.request),
      /RUST_FILL_ACK_NOT_MATCHED/);
    assert.equal(lying.data.characters[SELLER].balance, 100, "nothing was paid");
    assert.equal(lying.data.corporationRuntime[CKEY].wallet.divisions["1000"].balance, 1000);
    assert.equal(lying.data.npcMarketFills[RECEIPT].phase, "LIFT_FILL_ISSUED");

    // A sane daemon afterwards settles the same claim exactly once: the marker makes it resumable.
    const honest = fixture();
    assert.equal((await honest.lift.liftOnce(honest.request)).status,
      "NPC_PURCHASED_PLAYER_GOODS");
    assert.equal(honest.fills(), 1);
  }));

test("a disabled executor refuses before anything moves", async () => {
  const f = fixture();
  const saved = process.env.EVEJS_COOP_NPC_BUY_PLAYER_ASK;
  delete process.env.EVEJS_COOP_NPC_BUY_PLAYER_ASK;
  try {
    const result = await f.lift.liftOnce(f.request);
    assert.equal(result.status, "BLOCKED");
    assert.equal(result.reason, "NPC_LIFT_DISABLED");
    assert.equal(f.fills(), 0);
    assert.equal(f.data.characters[SELLER].balance, 100);
  } finally {
    if (saved !== undefined) process.env.EVEJS_COOP_NPC_BUY_PLAYER_ASK = saved;
  }
});

test("a seller who is not the corporation itself is required", () => run(async (f) => {
  const result = await f.lift.liftOnce({ ...f.request, sellerID: BUYER });
  assert.equal(result.reason, "NPC_LIFT_REQUEST_INVALID");
}));

test("the fill id is a pure function of the claim key", () => {
  assert.equal(deriveFillID(CLAIM), deriveFillID(CLAIM));
  assert.ok(Number.isSafeInteger(deriveFillID(CLAIM)) && deriveFillID(CLAIM) > 0);
  assert.equal(deriveFillID("npc-corpbuy:not-hex"), null);
  assert.equal(deriveFillID(CLAIM.replace(/^npc-corpbuy:/, "npc-trade:")), null);
});

test("a real module price is bought: the per-unit ceiling is not one million ISK", () =>
  run(async () => {
    // Measured 2026-11-06: the owner's asks are 7 651 000 - 113 400 000 ISK per unit, and the
    // original 1 000 000 ISK per-unit ceiling refused every one of them as REQUEST_INVALID.
    const big = fixture({ unitCents: 7_651_000_000, quantity: 1, buyerISK: 100_000_000 });
    const result = await big.lift.liftOnce(big.request);
    assert.equal(result.status, "NPC_PURCHASED_PLAYER_GOODS");
    assert.equal(big.data.corporationRuntime[CKEY].wallet.divisions["1000"].balance,
      100_000_000 - 76_510_000, "the corporation paid the real 76.51 M ISK");
    assert.equal(big.data.characters[SELLER].balance, 100 + 70_389_200,
      "the seller got the gross minus the real native tax");
    assert.equal(big.fills(), 1);
  }));

test("a book order id carried as text is accepted; a 64-bit id is refused, never truncated", () =>
  run(async (f) => {
    // Measured live 2026-11-06: the maker passes lot.sourceOrderID as text ("292"), and pos() on a
    // string answered BLOCKED:NPC_LIFT_REQUEST_INVALID for every real ask.
    const asText = { ...f.request, orderID: String(ORDER) };
    assert.equal((await f.lift.liftOnce(asText)).status, "NPC_PURCHASED_PLAYER_GOODS");
    const huge = await f.lift.liftOnce({ ...f.request, claimKey: "npc-corpbuy:" + "f".repeat(32),
      orderID: "2257714186837032994" });
    assert.equal(huge.status, "BLOCKED");
    assert.equal(huge.reason, "NPC_LIFT_REQUEST_INVALID",
      "a seed-sized id cannot round-trip through a safe integer, so it is refused");
  }));

test("a singleton module is bought as one unit, and GetOrder's nested row is read", () =>
  run(async () => {
    // Measured live 2026-11-06: 'Gauntlet' Small Focused Beam Laser I is a singleton (quantity -1,
    // stacksize 1, singleton 1) and GetOrder nests price/station/type/volume under `row`.
    const f = fixture({ singleton: true, wrapOrder: true, quantity: 1,
      unitCents: 1_287_000_000, buyerISK: 100_000_000 });
    const result = await f.lift.liftOnce({ ...f.request, quantity: 1 });
    assert.equal(result.status, "NPC_PURCHASED_PLAYER_GOODS");
    assert.equal(f.data.items[ITEM].ownerID, BUYER);
    assert.equal(f.data.items[ITEM].singleton, 1, "the module stays a module");
    assert.equal(f.data.corporationRuntime[CKEY].wallet.divisions["1000"].balance,
      100_000_000 - 12_870_000);
    assert.equal(f.fills(), 1);
  }));
