"use strict";
// COOP-RELS: put the goods the trader just bought back on the book at the owner's resale band.
//
// Owner rule 2026-11-05: "buy everything at 70-90 % of the market, and TRY TO RESELL at 105-140 %."
// The buy side is space/coopNpcTraderMaker.js; this is the other half. It uses the same native
// protocol the manufacturing and salvage paths already use (ReserveNpcSellOrder -> one atomic
// GameStore item+escrow row -> ActivateNpcSellOrder), because a stock PlaceOrder would create an
// order with no escrowed inventory behind it - exactly what the market doctrine forbids.
//
// Provenance is the trade itself: only a stack this trader really received (a SETTLED row in the
// maker's journal, with its own itemID) may be listed, and the escrow row records the purchase's
// operation id. Nothing is split, minted or re-priced after the fact: the item is the whole stack
// the seller delivered.
const crypto = require("node:crypto");
const fs = require("node:fs");
const path = require("node:path");

const probe = require(path.join(__dirname, "coopRuntimeProbe"));

const ESCROW_BASE = 9200000000;
const OPERATION = /^npc-trade:[0-9a-f]{32}$/;
const good = (x) => Number.isSafeInteger(Number(x)) && Number(x) > 0;

// The operation id must be stable for the SAME stack, so a retry after a crash is idempotent in Rust
// and in the GameStore transaction instead of creating a second order for one stack.
function operationFor(itemID, typeID, quantity) {
  const digest = crypto.createHash("sha256")
    .update(`${itemID}:${typeID}:${quantity}`).digest("hex");
  return `npc-trade:${digest.slice(0, 32)}`;
}

function createTraderRelist({
  call,
  gameStore,
  getNativeItem,
  getNativeEscrow,
  verifyNativeCorporation,
  verifyStation,
  readBoughtStacks,
  resolvePriceCents,
  clock = () => Date.now(),
  maxListingsPerTick = 3,
  maxQuantity = 1000000,
} = {}) {
  if (typeof call !== "function" ||
      typeof gameStore?.coopAtomicNativeRows?.transact !== "function" ||
      [getNativeItem, getNativeEscrow, verifyNativeCorporation, verifyStation,
        readBoughtStacks, resolvePriceCents, clock].some((x) => typeof x !== "function") ||
      !Number.isSafeInteger(maxListingsPerTick) || maxListingsPerTick < 1 || maxListingsPerTick > 8 ||
      !Number.isSafeInteger(maxQuantity) || maxQuantity < 1 || maxQuantity > 1000000)
    throw Error("TRADER_RELIST_DEPENDENCIES_REQUIRED");

  const flag = () => process.env.EVEJS_COOP_NATIVE_ATOMIC_ROWS === "1" &&
    process.env.EVEJS_COOP_TRADER_RELIST === "1";
  const inFlight = new Set();

  function checkRequest(x) {
    if (!x || !OPERATION.test(String(x.operationID || "")) ||
        !good(x.ownerID) || !good(x.stationID) || !good(x.itemID) ||
        !good(x.typeID) || !good(x.quantity) || x.quantity > maxQuantity)
      return false;
    return verifyNativeCorporation(x.ownerID) === true &&
      verifyStation(x.stationID, x.ownerID) === true;
  }

  // A bought stack is one whole inventory object in the corporation's hangar. A module or a ship is
  // a SINGLETON (quantity -1, stacksize 1) and is exactly one unit - the trader buys those, so the
  // relist has to accept them too (measured 2026-11-06: every bought module was skipped as "not a
  // whole stack" and the corporation could never resell what it bought).
  function checkItem(x, item, locationID = x.stationID) {
    const whole = Boolean(item) && (item.singleton === 1
      ? item.stacksize === null || item.stacksize === undefined || item.stacksize === 1
      : item.quantity === x.quantity && item.stacksize === x.quantity && item.singleton === 0);
    return Boolean(whole && item.itemID === x.itemID && item.ownerID === x.ownerID &&
      item.typeID === x.typeID && item.locationID === locationID && item.flagID === 4);
  }

  function sameOrder(row, x, price, state) {
    return Boolean(row && row.operation_id === x.operationID &&
      Number(row.source_item_id) === x.itemID && Number(row.owner_id) === x.ownerID &&
      Number(row.station_id) === x.stationID && Number(row.type_id) === x.typeID &&
      Number(row.quantity) === x.quantity && Number(row.price) === price &&
      row.bid === false && row.is_corp === true && row.source === "coop-npc" &&
      Number(row.vol_remaining) === x.quantity &&
      (state === null || row.state === state) && good(Number(row.order_id)));
  }

  function receipt(x, orderID, price) {
    const item = getNativeItem(x.itemID);
    const escrow = getNativeEscrow(orderID);
    return checkItem(x, item, ESCROW_BASE + orderID) &&
      escrow && String(escrow.orderId) === String(orderID) &&
      escrow.escrowType === "sell" && escrow.isCorp === true &&
      escrow.ownerId === x.ownerID && escrow.stationId === x.stationID &&
      escrow.typeId === x.typeID && escrow.sourceItemID === x.itemID &&
      escrow.remainingQuantity === x.quantity &&
      escrow.escrowLocationID === ESCROW_BASE + orderID &&
      escrow.coopOperationID === x.operationID &&
      Number(escrow.coopTradePriceCents) === price;
  }

  async function listOnce(x = {}) {
    if (!flag()) return { status: "BLOCKED", error: "TRADER_RELIST_DISABLED" };
    if (!checkRequest(x)) return { status: "BLOCKED", error: "TRADER_RELIST_IDENTITY_UNVERIFIED" };
    if (!Number.isSafeInteger(x.priceCents) || x.priceCents < 1)
      return { status: "BLOCKED", error: "TRADER_RELIST_PRICE_INVALID" };
    // Rust quotes in ISK to the cent: never round somebody else's price silently. The ceiling is a
    // real ceiling, not the old 1 M ISK one: the trader's own stock is modules worth 7-113 M ISK, and
    // 140 % of that is what the owner's rule asks for (measured 2026-11-06: every relist refused).
    const price = x.priceCents / 100;
    if (!Number.isFinite(price) || price <= 0 || price > 1000000000)
      return { status: "BLOCKED", error: "TRADER_RELIST_PRICE_OUT_OF_RANGE" };
    if (inFlight.has(x.operationID))
      return { status: "BLOCKED", error: "TRADER_RELIST_OPERATION_BUSY" };
    inFlight.add(x.operationID);
    try {
      const before = getNativeItem(x.itemID);
      if (!checkItem(x, before))
        return { status: "BLOCKED", error: "TRADER_RELIST_UNBACKED_SOURCE" };
      const pending = await call("ReserveNpcSellOrder", {
        operation_id: x.operationID, source_item_id: String(x.itemID), owner_id: x.ownerID,
        is_corp: true, station_id: x.stationID, type_id: x.typeID, quantity: x.quantity,
        price, bid: false, wallet_division: 1000,
      });
      if (!sameOrder(pending, x, price, "pending"))
        return { status: "BLOCKED", error: "TRADER_RELIST_PENDING_NOT_VERIFIED" };
      const orderID = Number(pending.order_id);
      if (!good(orderID) || !good(ESCROW_BASE + orderID))
        return { status: "BLOCKED", error: "TRADER_RELIST_ESCROW_LOCATION_UNSAFE" };
      const escrowLocationID = ESCROW_BASE + orderID;
      gameStore.coopAtomicNativeRows.transact(["items", "marketEscrow"], (tx) => {
        const item = tx.get("items", String(x.itemID));
        const existing = tx.get("marketEscrow", String(orderID));
        if (existing) {
          if (existing.orderId !== String(orderID) ||
              existing.coopOperationID !== x.operationID ||
              existing.sourceItemID !== x.itemID || existing.ownerId !== x.ownerID ||
              existing.escrowLocationID !== escrowLocationID ||
              !checkItem(x, item, escrowLocationID))
            throw Error("TRADER_RELIST_ESCROW_RECEIPT_CONFLICT");
          return { status: "ALREADY_ESCROWED" };
        }
        if (!checkItem(x, item)) throw Error("TRADER_RELIST_SOURCE_CHANGED");
        const now = new Date(clock()).toISOString();
        tx.put("items", String(x.itemID), { ...item, locationID: escrowLocationID });
        tx.put("marketEscrow", String(orderID), {
          orderId: String(orderID), escrowType: "sell", ownerId: x.ownerID, isCorp: true,
          typeId: x.typeID, stationId: x.stationID, escrowLocationID,
          remainingQuantity: x.quantity, createdAt: now, updatedAt: now,
          sourceItemID: x.itemID, coopOperationID: x.operationID,
          coopSource: "NATIVE_TRADE", coopTradePriceCents: x.priceCents,
        });
        return { status: "ESCROWED" };
      });
      if (!receipt(x, orderID, x.priceCents))
        return { status: "BLOCKED", error: "TRADER_RELIST_ESCROW_AFTER_COMMIT_UNVERIFIED" };
      const activated = await call("ActivateNpcSellOrder", {
        operation_id: x.operationID, order_id: String(orderID), source_item_id: String(x.itemID),
      });
      if (!sameOrder(activated, x, price, "open"))
        return { status: "BLOCKED", error: "TRADER_RELIST_ACTIVATION_UNVERIFIED" };
      return { status: "TRADER_RELISTED", orderID, priceCents: x.priceCents };
    } catch (error) {
      return { status: "BLOCKED",
        error: String(error && error.message || error).slice(0, 90) };
    } finally {
      inFlight.delete(x.operationID);
    }
  }

  // An order already on the book keeps its price forever unless something can change it:
  // reserve/activate cannot, and that is why the 22 modules listed at 140 % of the market could not be
  // made competitive. Repricing changes the advertised price ONLY - the escrow row, its source item
  // and the operation id stay exactly as they were, and the escrow's recorded trade price follows.
  async function repriceOnce(x = {}) {
    if (!flag()) return { status: "BLOCKED", error: "TRADER_RELIST_DISABLED" };
    if (!checkRequest(x)) return { status: "BLOCKED", error: "TRADER_RELIST_IDENTITY_UNVERIFIED" };
    if (!good(x.orderID)) return { status: "BLOCKED", error: "TRADER_RELIST_ORDER_INVALID" };
    if (!Number.isSafeInteger(x.priceCents) || x.priceCents < 1)
      return { status: "BLOCKED", error: "TRADER_RELIST_PRICE_INVALID" };
    const price = x.priceCents / 100;
    if (!Number.isFinite(price) || price <= 0 || price > 1000000000)
      return { status: "BLOCKED", error: "TRADER_RELIST_PRICE_OUT_OF_RANGE" };
    const escrow = getNativeEscrow(x.orderID);
    if (!escrow || escrow.coopOperationID !== x.operationID ||
        escrow.coopSource !== "NATIVE_TRADE" || escrow.sourceItemID !== x.itemID ||
        escrow.ownerId !== x.ownerID || escrow.remainingQuantity !== x.quantity)
      return { status: "BLOCKED", error: "TRADER_RELIST_ESCROW_UNVERIFIED" };
    const updated = await call("RepriceNpcSellOrder", {
      operation_id: x.operationID, order_id: String(x.orderID), price });
    if (!sameOrder(updated, x, price, "open"))
      return { status: "BLOCKED", error: "TRADER_RELIST_REPRICE_NOT_VERIFIED" };
    gameStore.coopAtomicNativeRows.transact(["marketEscrow"], (tx) => {
      const row = tx.get("marketEscrow", String(x.orderID));
      if (!row || row.coopOperationID !== x.operationID || row.sourceItemID !== x.itemID)
        throw Error("TRADER_RELIST_REPRICE_ESCROW_CONFLICT");
      tx.put("marketEscrow", String(x.orderID), { ...row, coopTradePriceCents: x.priceCents,
        updatedAt: new Date(clock()).toISOString() });
    });
    return { status: "TRADER_REPRICED", orderID: x.orderID, priceCents: x.priceCents };
  }

  async function tick({ corporationID, stationID } = {}) {
    if (!flag()) return { status: "DISABLED", listed: [] };
    if (!good(corporationID) || !good(stationID))
      return { status: "BLOCKED", reason: "TRADER_RELIST_SCOPE_INVALID", listed: [] };
    let stacks;
    try {
      stacks = readBoughtStacks(corporationID, stationID);
    } catch (error) {
      return { status: "BLOCKED", reason: "TRADER_RELIST_STOCK_UNREADABLE", listed: [] };
    }
    if (!Array.isArray(stacks) || !stacks.length)
      return { status: "NO_STOCK", listed: [] };
    const listed = [];
    for (const stack of stacks) {
      if (listed.length >= maxListingsPerTick) break;
      if (!good(stack.itemID) || !good(stack.typeID) || !good(stack.quantity)) continue;
      const referenceCents = await resolvePriceCents(stack.typeID, stationID);
      if (!good(referenceCents)) continue;
      // The owner's band: ask 140 %, never under 105 %.
      const bandCents = Math.max(Math.round(referenceCents * 1.05),
        Math.round(referenceCents * 1.4));
      // An ask above the cheapest real offer is never the best offer, so it never sells: measured
      // 2026-11-06, the corporation's modules sat 40 % above a cheaper seed ask with no bids at all.
      // Undercut the market instead, but never below cost + 5 % - and if those two cannot both hold,
      // list nothing rather than park dead stock on the book.
      const paidCents = good(stack.unitPriceCents) ? stack.unitPriceCents : 0;
      const floorCents = paidCents > 0 ? Math.ceil(paidCents * 1.05) : 0;
      const competitiveCents = Math.floor(referenceCents * 0.99);
      let priceCents = bandCents;
      if (good(competitiveCents) && competitiveCents < bandCents) {
        if (floorCents > 0 && floorCents > competitiveCents) {
          // Undercutting the market would sell at a loss: list nothing instead of dead stock.
          listed.push({ itemID: stack.itemID, typeID: stack.typeID, quantity: stack.quantity,
            priceCents: 0, status: "BLOCKED", orderID: null,
            reason: "TRADER_RELIST_BELOW_COST" });
          continue;
        }
        priceCents = Math.max(floorCents, competitiveCents);
      }
      const operationID = operationFor(stack.itemID, stack.typeID, stack.quantity);
      const result = await listOnce({
        operationID, ownerID: corporationID, stationID, itemID: stack.itemID,
        typeID: stack.typeID, quantity: stack.quantity, priceCents,
      });
      listed.push({ itemID: stack.itemID, typeID: stack.typeID, quantity: stack.quantity,
        priceCents, status: result.status, orderID: result.orderID || null,
        reason: result.error || null });
      if (result.status !== "TRADER_RELISTED") {
        // An ambiguous native outcome stops the tick; the stable operation id makes a retry safe.
        if (/NOT_VERIFIED|UNVERIFIED|CONFLICT/.test(String(result.error || ""))) break;
      }
    }
    const settled = listed.filter((row) => row.status === "TRADER_RELISTED");
    const summary = {
      status: settled.length ? "TRADER_RELISTED" : (listed.length ? "TRADER_RELIST_BLOCKED" : "NO_STOCK"),
      listed,
      corporationID,
      stationID,
    };
    probe.observe("space.trader-relist", null, null, {
      status: summary.status, corporationID, stationID,
      listed: listed.map((row) => ({ status: row.status, typeID: row.typeID,
        quantity: row.quantity, priceCents: row.priceCents, reason: row.reason })),
    });
    return summary;
  }

  return Object.freeze({ tick, listOnce, repriceOnce, operationFor,
    mode: "NATIVE_TRADE_RELIST" });
}

module.exports = { createTraderRelist, ESCROW_BASE, operationFor };
