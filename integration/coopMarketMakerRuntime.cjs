"use strict";
// The working half of docs/MARKET_MAKERS.md: one tick that keeps real bids on the book.
//
// It contains no market knowledge of its own. The caller injects
//   book(typeID)        -> { typeID, stationID, referenceISK, bestAskISK, bestBidISK, quantity }
//   placeBuy(request)   -> native PlaceOrder with bid:true, already verified by a read-back
//   cancel(orderID)     -> native CancelOrder
// and the tick only decides *what* to do and keeps the money booked. Every decision is logged with the
// numbers that produced it, so the effect on the book is measurable.
const { createTraders, enabled } = require("./coopMarketMakerTraders" + (__filename.endsWith(".js") ? "" : ".cjs"));
const { TRADERS, DEFAULTS, decideBuyPrice } = require("./coopMarketMaker" + (__filename.endsWith(".js") ? "" : ".cjs"));

const int = value => Math.trunc(Number(value) || 0);
const pos = value => (Number.isFinite(Number(value)) && Number(value) > 0 ? Number(value) : 0);

function liveOrders(record, nowMs) {
  return Object.values((record && record.orders) || {})
    .filter(order => order && int(order.expiresAt) > nowMs);
}

async function tick({
  traders = null,
  book = null,
  placeBuy = null,
  cancel = null,
  inspect = null,
  types = [],
  now = Date.now(),
  env = process.env,
  observe = null,
} = {}) {
  const report = { status: "OK", placed: [], cancelled: [], skipped: [], errors: [] };
  if (!enabled(env)) {
    report.status = "DISABLED";
    return report;
  }
  if (typeof book !== "function" || typeof placeBuy !== "function") {
    report.status = "MARKET_API_REQUIRED";
    return report;
  }
  const store = traders || createTraders({ clock: () => now });
  // Money that was reserved for a placement whose outcome never resolved must come back once
  // it is provably unmatched (no live order points at it). Without this the reservations
  // accumulated for ever: measured 2026-11-05, 33 184 open reservations, 12 MB document.
  let reconciliation = null;
  try {
    reconciliation = store.reconcile({ nowMs: now });
  } catch (error) {
    reconciliation = { status: "RECONCILE_FAILED", reason: String(error && error.message) };
  }
  if (reconciliation && reconciliation.status === "RECONCILED" &&
      (reconciliation.refunded.length || reconciliation.pruned)) {
    report.reconciled = reconciliation;
  }
  const state = store.snapshot();
  const configuredCount = Math.max(1, Math.min(TRADERS.length,
    int(env.EVEJS_COOP_MARKET_MAKERS_COUNT) || TRADERS.length));
  const activeTraders = TRADERS.slice(0, configuredCount);
  // A wall of five identical bids is not a market either: at most two makers may hold a type at once.
  const makersPerType = Math.max(1, int(env.EVEJS_COOP_MARKET_MAKERS_PER_TYPE) || 2);
  const liveMakersByType = new Map();
  for (const trader of TRADERS) {
    for (const order of liveOrders(state.traders[trader.traderID], now)) {
      const typeID = int(order.typeID);
      liveMakersByType.set(typeID, (liveMakersByType.get(typeID) || 0) + 1);
    }
  }

  for (const trader of activeTraders) {
    let record = state.traders[trader.traderID] || null;
    let live = liveOrders(record, now);

    // 0. An order the daemon no longer has open (cancelled by an operator, filled, expired there) must
    // release BOTH its money and the type it held; otherwise the maker never quotes that type again.
    let releasedAny = false;
    if (typeof inspect === "function") {
      for (const order of Object.values((record && record.orders) || {})) {
        if (!order || int(order.expiresAt) <= now) continue;
        let state = "missing";
        try {
          state = String((await inspect(order.orderID)) || "missing");
        } catch (_error) {
          continue; // an unreadable order is not proof that it is gone
        }
        if (state === "open") continue;
        const released = store.release({ orderID: order.orderID, reason: "ORDER_GONE:" + state });
        releasedAny = true;
        report.released = report.released || [];
        report.released.push({ traderID: trader.traderID, orderID: order.orderID, state,
          status: released.status });
      }
    }

    if (releasedAny) {
      const fresh = store.snapshot();
      record = (fresh.traders && fresh.traders[trader.traderID]) || null;
      live = liveOrders(record, now);
    }

    // 1. Expired orders are cancelled and their money returned before anything new is bought.
    if (typeof cancel === "function") {
      for (const order of Object.values((record && record.orders) || {})) {
        if (!order || int(order.expiresAt) > now) continue;
        try {
          await cancel(order.orderID);
          const refund = store.refund(order.operationID, "EXPIRED");
          report.cancelled.push({ traderID: trader.traderID, orderID: order.orderID, refund: refund.status });
        } catch (error) {
          report.errors.push({ traderID: trader.traderID, orderID: order.orderID, error: String(error && error.message) });
        }
      }
    }

    // 2. One new bid per type the trader does not already hold a live order on.
    const heldTypes = new Set(live.map(order => int(order.typeID)));
    for (const typeID of Array.isArray(types) ? types : []) {
      if (heldTypes.has(int(typeID))) continue;
      if ((liveMakersByType.get(int(typeID)) || 0) >= makersPerType) {
        report.skipped.push({ traderID: trader.traderID, typeID: int(typeID), reason: "TYPE_ALREADY_QUOTED" });
        continue;
      }
      if (live.length >= DEFAULTS.maxOrdersPerType) break;
      let quote = null;
      try {
        quote = book(int(typeID));
      } catch (error) {
        report.errors.push({ traderID: trader.traderID, typeID: int(typeID), error: String(error && error.message) });
        continue;
      }
      if (!quote || pos(quote.referenceISK) <= 0) {
        report.skipped.push({ traderID: trader.traderID, typeID: int(typeID), reason: "NO_REFERENCE" });
        continue;
      }
      if (int(quote.stationID) <= 0) {
        report.skipped.push({ traderID: trader.traderID, typeID: int(typeID), reason: "STATION_REQUIRED" });
        continue;
      }
      const decision = decideBuyPrice({
        referenceISK: quote.referenceISK,
        bestAskISK: quote.bestAskISK,
        random: Math.random(),
      });
      if (!decision.ok) {
        report.skipped.push({ traderID: trader.traderID, typeID: int(typeID), reason: decision.reason });
        continue;
      }
      const quantity = Math.max(1, int(quote.quantity) || 1);
      const amountISK = decision.priceISK * quantity;
      const reserved = store.reserve({
        traderID: trader.traderID,
        amountISK,
        kind: "BUY",
        meta: { typeID: int(typeID), stationID: int(quote.stationID), priceISK: decision.priceISK, quantity },
      });
      if (reserved.status !== "RESERVED") {
        report.skipped.push({ traderID: trader.traderID, typeID: int(typeID), reason: reserved.status });
        continue;
      }
      try {
        const placed = await placeBuy({
          ownerID: trader.traderID,
          stationID: int(quote.stationID),
          typeID: int(typeID),
          priceISK: decision.priceISK,
          quantity,
          operationID: reserved.operationID,
        });
        const orderID = String((placed && placed.order && placed.order.order_id) || "");
        if (!placed || placed.ok !== true || !/^[1-9][0-9]*$/.test(orderID)) {
          store.refund(reserved.operationID, "PLACE_REFUSED");
          report.skipped.push({ traderID: trader.traderID, typeID: int(typeID), reason: "PLACE_REFUSED" });
          continue;
        }
        store.bind(reserved.operationID, placed.order);
        liveMakersByType.set(int(typeID), (liveMakersByType.get(int(typeID)) || 0) + 1);
        report.placed.push({
          traderID: trader.traderID, typeID: int(typeID), orderID,
          priceISK: decision.priceISK, quantity, referenceISK: pos(quote.referenceISK),
        });
      } catch (error) {
        // An unknown outcome must never be repeated: the money stays reserved for reconciliation.
        report.errors.push({
          traderID: trader.traderID, typeID: int(typeID),
          error: String(error && error.message), operationID: reserved.operationID,
          uncertain: true,
        });
      }
    }
  }

  if (typeof observe === "function") {
    try {
      observe(report);
    } catch (_error) { /* telemetry only */ }
  }
  return report;
}

module.exports = { tick, liveOrders };
