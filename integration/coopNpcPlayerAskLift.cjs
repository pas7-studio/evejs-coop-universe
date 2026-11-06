"use strict";
// COOP-LIFT: an NPC corporation lifts ONE whole verified player ask at a reasonable price.
//
// Why this exists next to COOP-048 (`coopNpcCorporateBuyerAtomic`): that module settles against a
// Rust claim handshake (`ClaimNpcCorpPlayerSell` / `FinalizeNpcCorpPlayerSell`). The pinned market
// daemon in this fork implements no such RPC (measured 2026-11-06: `rpc.rs` has no "claim" arm and
// answers "unsupported market RPC method"), so `purchaseOnce` can never settle a real ask. The one
// book primitive that does exist and is audited is `FillOrder`, which closes a playER ask and
// changes nothing else - it does not pay anybody and does not touch the bid (measured: order 281
// went `filled` with the maker's bid still open and the seller's wallet unchanged).
//
// So the money side stays where it already lives: the COOP-048 settlement transaction. This module
// only supplies the missing authority - "this ask is now gone because WE took it" - and it does so
// in an order that can never pay twice and can always be resumed:
//
//   1. read the receipt keyed by a DETERMINISTIC fill id derived from the claim key; if the
//      settlement already committed, answer from the receipt and never touch the book again;
//   2. verify the book row (GetOrder) and the physical escrow (GameStore) name the same order,
//      owner, type, station, quantity and price-cent amount;
//   3. write a durable `LIFT_FILL_ISSUED` marker (same key as the receipt) BEFORE the fill;
//   4. `FillOrder` the whole remaining quantity and verify the exact ACK;
//   5. run the unchanged COOP-048 `atomicSettle`: one GameStore transaction debits the corporation,
//      credits the seller net of the real native tax, moves the physical stack and writes the
//      receipt.
//
// Crash windows and what happens:
//   * after (3) and before (4): the book row is still open; the next call re-uses the marker and
//     fills then;
//   * after (4) and before (5): the next call sees the row already `filled`, finds OUR marker and
//     settles it exactly once (the receipt is the guard);
//   * a row filled by somebody else with no marker of ours is refused, never paid.
const { assertFillAck } = require("./coopPlayerMarketFill" +
  (typeof __filename === "string" && __filename.endsWith(".js") ? "" : ".cjs"));

const SEP = "\u001f";
const ESCROW_BASE = 9200000000;
const CLAIM_KEY = /^npc-corpbuy:[0-9a-f]{32}$/;
const pos = (x) => Number.isSafeInteger(x) && x > 0;
const nonneg = (x) => Number.isSafeInteger(x) && x >= 0;
// Rust quotes in ISK; every internal decision is in exact cents so nothing rounds silently.
const cents = (isk) => {
  if (typeof isk !== "number" || !Number.isFinite(isk) || isk <= 0) return null;
  const scaled = isk * 100, whole = Math.round(scaled);
  return Number.isSafeInteger(whole) && Math.abs(scaled - whole) <= 1e-6 ? whole : null;
};

// The fill id must be a pure function of the claim key: a retry after a crash has to land on the
// same receipt row, and never on a second wallet transaction.
function deriveFillID(claimKey) {
  const text = String(claimKey === null || claimKey === undefined ? "" : claimKey);
  if (!CLAIM_KEY.test(text)) return null;
  const value = parseInt(text.slice("npc-corpbuy:".length, "npc-corpbuy:".length + 12), 16);
  return Number.isSafeInteger(value) && value > 0 ? value : null;
}

function createNpcPlayerAskLift({
  gameStore,
  itemStore,
  marketClient,
  buyer,
  verifyBuyerCorporation,
  verifyPlayerSeller,
  clock = () => Date.now(),
  recordTrade = null,
} = {}) {
  if (typeof gameStore?.read !== "function" ||
      typeof gameStore?.coopAtomicNativeRows?.transact !== "function" ||
      typeof itemStore?.listOwnedItems !== "function" ||
      typeof marketClient?.call !== "function" ||
      typeof buyer?.atomicSettle !== "function" ||
      [verifyBuyerCorporation, verifyPlayerSeller, clock].some((x) => typeof x !== "function") ||
      (recordTrade !== null && typeof recordTrade !== "function"))
    throw Error("NPC_LIFT_NATIVE_AUTHORITIES_REQUIRED");

  const busy = new Set();
  const fillKeyFor = (fillID) => "corp-buy" + SEP + fillID;
  const enabled = () => process.env.EVEJS_COOP_NATIVE_ATOMIC_ROWS === "1" &&
    process.env.EVEJS_COOP_NPC_BUY_PLAYER_ASK === "1";

  function validateRequest(x) {
    return Boolean(x && CLAIM_KEY.test(String(x.claimKey || "")) &&
      [x.buyerCorpID, x.sellerID, x.stationID, x.typeID, x.orderID, x.quantity,
        x.maxUnitPriceCents].every(pos) &&
      nonneg(x.minReserveCents) &&
      x.quantity <= 50000 && x.maxUnitPriceCents <= 100000000 &&
      x.sellerID !== x.buyerCorpID);
  }

  function readRow(table, key) {
    const result = gameStore.read(table, "/" + key);
    return result?.success === true ? result.data : null;
  }

  // A committed receipt is the whole answer: the money already moved and must never move again.
  function committedReceipt(fillID, request) {
    const row = readRow("npcMarketFills", fillKeyFor(fillID));
    if (!row || row.phase !== "NATIVE_NPC_BUY_COMMITTED") return null;
    if (row.claimKey !== request.claimKey || row.fillID !== fillID ||
        row.sellerID !== request.sellerID || row.buyerCorpID !== request.buyerCorpID ||
        row.typeID !== request.typeID || row.orderID !== request.orderID ||
        row.quantity !== request.quantity || !pos(row.itemID))
      throw Error("NPC_LIFT_RECEIPT_CONFLICT");
    return { status: "NPC_PURCHASED_PLAYER_GOODS", replayed: true,
      fillID: row.fillID, itemID: row.itemID, quantity: row.quantity,
      grossCents: row.grossCents, taxCents: row.taxCents, netCents: row.netCents };
  }

  function markerOf(fillID, request) {
    const row = readRow("npcMarketFills", fillKeyFor(fillID));
    if (!row || row.phase !== "LIFT_FILL_ISSUED") return null;
    if (row.claimKey !== request.claimKey || row.sellerID !== request.sellerID ||
        row.orderID !== request.orderID || row.typeID !== request.typeID)
      throw Error("NPC_LIFT_MARKER_CONFLICT");
    return row;
  }

  // Durable, idempotent, and written before the book changes so a crash is provable, not a guess.
  function issueMarker(fillID, request, priceCents) {
    return gameStore.coopAtomicNativeRows.transact(["npcMarketFills"], (tx) => {
      const key = fillKeyFor(fillID);
      const previous = tx.get("npcMarketFills", key);
      if (previous) {
        if (previous.phase !== "LIFT_FILL_ISSUED" ||
            previous.claimKey !== request.claimKey || previous.fillID !== fillID ||
            previous.orderID !== request.orderID || previous.buyerCorpID !== request.buyerCorpID ||
            previous.sellerID !== request.sellerID || previous.stationID !== request.stationID ||
            previous.typeID !== request.typeID || previous.quantity !== request.quantity ||
            previous.priceCents !== priceCents)
          throw Error("NPC_LIFT_MARKER_CONFLICT");
        return { status: "MARKER_PRESENT", marker: previous };
      }
      const marker = {
        phase: "LIFT_FILL_ISSUED", claimKey: request.claimKey, fillID,
        orderID: request.orderID, buyerCorpID: request.buyerCorpID,
        sellerID: request.sellerID, stationID: request.stationID,
        typeID: request.typeID, quantity: request.quantity,
        priceCents, issuedAt: clock(),
      };
      tx.put("npcMarketFills", key, marker);
      return { status: "MARKER_ISSUED", marker };
    });
  }

  async function readBookRow(request) {
    const row = await marketClient.call("GetOrder", { order_id: String(request.orderID) });
    if (!row) throw Error("NPC_LIFT_BOOK_ROW_MISSING");
    const priceCents = cents(Number(row.price));
    const state = String(row.state === null || row.state === undefined ? "" : row.state).toLowerCase();
    const isCorp = row.is_corp === true || Number(row.is_corp) === 1;
    const isBid = row.bid === true || Number(row.bid) === 1;
    if (Number(row.owner_id) !== request.sellerID || isCorp || isBid ||
        Number(row.station_id) !== request.stationID ||
        Number(row.type_id) !== request.typeID ||
        (row.source !== null && row.source !== undefined && row.source !== "player") ||
        priceCents === null ||
        !["open", "filled", "cancelled", "expired"].includes(state))
      throw Error("NPC_LIFT_BOOK_ROW_UNVERIFIED");
    // Above the ceiling is a clean refusal, not a broken authority: nothing has happened yet.
    if (priceCents > request.maxUnitPriceCents) return { overCeiling: true, priceCents, state };
    return { state, priceCents,
      volRemaining: Number.isSafeInteger(Number(row.vol_remaining))
        ? Number(row.vol_remaining) : -1 };
  }

  // The physical escrow and the book have to describe the same single stack, at the same price.
  function readEscrow(request, priceCents) {
    const escrow = readRow("marketEscrow", String(request.orderID));
    if (!escrow || String(escrow.orderId) !== String(request.orderID) ||
        escrow.escrowType !== "sell" || escrow.isCorp !== false ||
        escrow.ownerId !== request.sellerID || escrow.stationId !== request.stationID ||
        escrow.typeId !== request.typeID ||
        escrow.remainingQuantity !== request.quantity ||
        escrow.escrowLocationID !== ESCROW_BASE + request.orderID)
      return { ok: false, reason: "NPC_LIFT_ESCROW_SCOPE_INVALID" };
    if (cents(Number(escrow.price)) !== priceCents)
      return { ok: false, reason: "NPC_LIFT_PRICE_AUTHORITY_DISAGREE" };
    const items = itemStore.listOwnedItems(request.sellerID);
    if (!Array.isArray(items) || items.length > 10000)
      return { ok: false, reason: "NPC_LIFT_ITEMS_UNAVAILABLE" };
    const stack = items.filter((item) => item?.ownerID === request.sellerID &&
      item.locationID === escrow.escrowLocationID && item.flagID === 4);
    if (stack.length !== 1 ||
        stack[0].typeID !== request.typeID ||
        stack[0].quantity !== request.quantity ||
        stack[0].stacksize !== request.quantity ||
        stack[0].singleton !== 0)
      return { ok: false, reason: "NPC_LIFT_ESCROW_STACK_UNVERIFIED" };
    return { ok: true, escrow, itemID: stack[0].itemID };
  }

  function fillAck(request, priceCents, volumeBefore) {
    return Object.freeze({
      orderID: String(request.orderID), ownerID: request.sellerID,
      stationID: request.stationID, typeID: request.typeID, bid: false,
      priceCents, volumeBefore,
      filledQuantity: request.quantity, volumeAfter: volumeBefore - request.quantity,
    });
  }

  async function liftOnce(request = {}) {
    if (!enabled()) return { status: "BLOCKED", reason: "NPC_LIFT_DISABLED" };
    if (!validateRequest(request)) return { status: "BLOCKED", reason: "NPC_LIFT_REQUEST_INVALID" };
    const fillID = deriveFillID(request.claimKey);
    if (!pos(fillID)) return { status: "BLOCKED", reason: "NPC_LIFT_CLAIM_KEY_INVALID" };
    if (verifyBuyerCorporation(request.buyerCorpID, request.stationID) !== true ||
        verifyPlayerSeller(request.sellerID, request.stationID) !== true)
      return { status: "BLOCKED", reason: "NPC_LIFT_AUTHORITY_UNVERIFIED" };
    const already = committedReceipt(fillID, request);
    if (already) return already;
    const lock = request.orderID;
    if (busy.has(lock)) return { status: "BLOCKED", reason: "NPC_LIFT_ORDER_BUSY" };
    busy.add(lock);
    try {
      const book = await readBookRow(request);
      if (book.overCeiling)
        return { status: "BLOCKED", reason: "NPC_LIFT_ASK_ABOVE_CEILING" };
      const escrow = readEscrow(request, book.priceCents);
      if (!escrow.ok) return { status: "BLOCKED", reason: escrow.reason };
      if (book.state === "open") {
        if (book.volRemaining !== request.quantity)
          return { status: "BLOCKED", reason: "NPC_LIFT_WHOLE_ASK_REQUIRED" };
        issueMarker(fillID, request, book.priceCents);
        const ack = await marketClient.call("FillOrder", {
          order_id: String(request.orderID), fill_quantity: request.quantity,
        });
        assertFillAck({ proof: fillAck(request, book.priceCents, book.volRemaining), ack });
      } else if (book.state !== "filled" || book.volRemaining !== 0) {
        return { status: "BLOCKED", reason: "NPC_LIFT_BOOK_ROW_NOT_OPEN:" + book.state };
      } else if (!markerOf(fillID, request)) {
        // Somebody else closed this order. Paying now would mint ISK out of nothing.
        return { status: "BLOCKED", reason: "NPC_LIFT_FOREIGN_FILL" };
      }
      // Same claim identity COOP-048 validates, except the authority is the book fill WE issued.
      const claim = {
        source: "player", state: "settling", fill_phase: "claimed",
        is_corp: false, bid: false,
        claim_key: request.claimKey, fill_id: String(fillID),
        order_id: String(request.orderID), owner_id: String(request.sellerID),
        buyer_corp_id: String(request.buyerCorpID), station_id: request.stationID,
        type_id: request.typeID, quantity: request.quantity,
        price_cents: book.priceCents,
      };
      const settled = buyer.atomicSettle(claim, request);
      const fresh = settled.status === "NATIVE_NPC_BUY_COMMITTED";
      if (fresh && recordTrade) {
        // Public price history follows the real fill, exactly like a player sale. Best effort:
        // the money and the item are already right, and a retry never records it twice.
        try {
          await recordTrade({ typeID: request.typeID, price: book.priceCents / 100,
            quantity: request.quantity });
        } catch (_error) { /* history only */ }
      }
      return { ...settled, status: "NPC_PURCHASED_PLAYER_GOODS", itemID: settled.itemID };
    } finally {
      busy.delete(lock);
    }
  }

  return Object.freeze({ liftOnce, deriveFillID, mode: "BOOK_FILL_NATIVE_SETTLEMENT" });
}

module.exports = { createNpcPlayerAskLift, deriveFillID };
