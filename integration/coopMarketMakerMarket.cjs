"use strict";
// The last mile: wire the market-maker tick to the real Rust book.
//
// Every buy goes through the same rule as the player path (reserve -> one PlaceOrder -> read the order
// back -> bind). An order whose read-back does not match is refused and its money returns, because the
// Rust book accepts an order without any escrow check of its own (audited 2026-11-03).
const { tick } = require("./coopMarketMakerRuntime" + (__filename.endsWith(".js") ? "" : ".cjs"));
const { enabled } = require("./coopMarketMakerTraders" + (__filename.endsWith(".js") ? "" : ".cjs"));

const int = value => Math.trunc(Number(value) || 0);

function marketClient() {
  try {
    return require("../services/market/marketDaemonClient").marketDaemonClient;
  } catch (_error) {
    return null;
  }
}

// The seeder's own fallback (market-common::fallback_base_price): when nothing exists for a type this is
// the price the book itself was seeded from, so a maker anchors to the same number instead of inventing
// one. 10 000 + (typeID % 250) * 250, floored.
const SEED_PRICE_FLOOR = 1000;
function seedFallbackPrice(typeID) {
  const base = 10000 + (Math.trunc(Number(typeID) || 0) % 250) * 250;
  return Math.max(base, SEED_PRICE_FLOOR);
}

// Best ask/bid for one type: the book already answers this, and a maker must never price blind.
async function readQuote(client, { typeID, regionID = 10000002, stationID = 0, quantity = 1 } = {}) {
  const orders = await client.call("GetOrders", { region_id: regionID, type_id: int(typeID) });
  // The daemon answers with the two sides of the book, not one list: {"sells": [...], "buys": [...]}.
  const rows = [
    ...(Array.isArray(orders && orders.sells) ? orders.sells : []),
    ...(Array.isArray(orders && orders.buys) ? orders.buys : []),
    ...(Array.isArray(orders && orders.orders) ? orders.orders : []),
  ];
  const atStation = stationID > 0
    ? rows.filter(row => int(row.station_id) === int(stationID))
    : rows;
  const asks = atStation.filter(row => row && row.bid !== true && Number(row.price) > 0)
    .map(row => Number(row.price)).sort((a, b) => a - b);
  const bids = atStation.filter(row => row && row.bid === true && Number(row.price) > 0)
    .map(row => Number(row.price)).sort((a, b) => b - a);
  const reference = asks.length ? asks[Math.floor(asks.length / 2)] : (bids[0] || 0);
  const fallback = seedFallbackPrice(typeID);
  return {
    typeID: int(typeID),
    stationID: int(stationID) || int(asks.length ? atStation[0].station_id : 0),
    referenceISK: reference || fallback,
    referenceSource: reference ? "BOOK" : "SEED_FALLBACK",
    bestAskISK: asks[0] || 0,
    bestBidISK: bids[0] || 0,
    quantity: Math.max(1, int(quantity) || 1),
  };
}

// A silent refusal is why "orders: 0" sat in the trader records for days: the tick records `placed.ok === false`
// without saying which of the two checks failed. One line per reason per minute, so a broken book is visible and a
// busy book is not log spam.
const lastNoteAt = new Map();
function noteFailure(reason, detail) {
  const now = Date.now();
  if (now - Number(lastNoteAt.get(reason) || 0) < 60000) return;
  lastNoteAt.set(reason, now);
  try {
    console.log(`[MarketMaker] ${reason} ${JSON.stringify(detail)}`);
  } catch (_error) {
    /* a diagnostic line never changes an order */
  }
}

async function placeBuy(client, { ownerID, isCorp = false, stationID, typeID, priceISK, quantity }) {
  // owner_id must fit the daemon's u64: a string trader id ("mk-trader-1") is a hard decode error.
  const owner = int(ownerID);
  if (owner <= 0) return { ok: false, reason: "OWNER_NOT_NUMERIC" };
  const request = {
    owner_id: owner,
    is_corp: isCorp === true,
    station_id: int(stationID),
    type_id: int(typeID),
    price: int(priceISK),
    quantity: Math.max(1, int(quantity) || 1),
    min_volume: 1,
    duration_days: 1,
    range_value: 0,
    bid: true,
    source: "market-maker",
  };
  const reply = await client.call("PlaceOrder", request);
  const orderID = String((reply && reply.order_id) ?? "");
  if (!/^[1-9][0-9]*$/.test(orderID)) {
    noteFailure("NO_ORDER_ACK", {
      request,
      replyType: reply === null ? "null" : typeof reply,
      replyKeys: reply && typeof reply === "object" ? Object.keys(reply).slice(0, 8) : null,
      reply: reply && typeof reply === "object" ? JSON.stringify(reply).slice(0, 200) : String(reply).slice(0, 120),
    });
    return { ok: false, reason: "NO_ORDER_ACK" };
  }
  // An ACK alone is not proof the order exists under the identity we expect. The daemon decodes order_id as an
  // integer, so a string went in as garbage and the read-back looked like a mismatch that was really a bad request.
  const replyOrderID = /^[0-9]+$/.test(orderID) && Number.isSafeInteger(Number(orderID)) ? Number(orderID) : orderID;
  const order = await client.call("GetOrder", { order_id: replyOrderID });
  if (!order || String(order.order_id ?? "") !== orderID) {
    noteFailure("READBACK_MISMATCH", {
      request,
      placedOrderID: orderID,
      readbackType: order === null ? "null" : typeof order,
      readbackOrderID: order ? String(order.order_id ?? "") : null,
      readback: order ? JSON.stringify(order).slice(0, 200) : null,
    });
    return { ok: false, reason: "READBACK_MISMATCH" };
  }
  return { ok: true, order };
}

async function cancelOrder(client, orderID) {
  const reply = await client.call("CancelOrder", { order_id: int(orderID) || orderID });
  return { ok: Boolean(reply), reply };
}

// One pass over a short type list: the caller decides which types a maker should quote.
async function runOnce({
  types = [],
  quotes = null,
  regionID = 10000002,
  stationID = 0,
  traders = null,
  client = null,
  now = Date.now(),
  env = process.env,
  observe = null,
} = {}) {
  if (!enabled(env)) return { status: "DISABLED" };
  const market = client || marketClient();
  if (!market || typeof market.call !== "function") return { status: "NO_MARKET_CLIENT" };
  const quoteMap = quotes instanceof Map
    ? quotes
    : await prepareQuotes({ types, regionID, stationID, client: market, env });
  return tick({
    traders,
    now,
    env,
    types,
    book: typeID => quoteMap.get(int(typeID)) || null,
    placeBuy: request => {
      // A real order must be owned by a real numeric entity: the configured trading corporation.
      // The five makers still book their own money in the internal ledger.
      const corp = int(env.EVEJS_COOP_MARKET_MAKER_OWNER_ID);
      return placeBuy(market, corp > 0 ? { ...request, ownerID: corp, isCorp: true } : request);
    },
    cancel: orderID => cancelOrder(market, orderID),
    observe,
  });
}

// Quotes must exist before the tick asks for them: resolved here so a slow daemon cannot block the
// decision loop for every trader in turn.
async function prepareQuotes({ types = [], regionID = 10000002, stationID = 0, client = null, env = process.env } = {}) {
  if (!enabled(env)) return new Map();
  const market = client || marketClient();
  if (!market || typeof market.call !== "function") return new Map();
  const quotes = new Map();
  for (const typeID of Array.isArray(types) ? types : []) {
    try {
      quotes.set(int(typeID), await readQuote(market, { typeID, regionID, stationID }));
    } catch (_error) {
      /* an unreadable type is simply not quoted this pass */
    }
  }
  return quotes;
}

// Fire-and-forget driver for the world tick: one run at a time, never overlapping.
let running = false;
function startBackground(options = {}) {
  if (!enabled(options.env || process.env)) return { status: "DISABLED" };
  if (running) return { status: "BUSY" };
  const types = Array.isArray(options.types)
    ? options.types
    : String((options.env || process.env).EVEJS_COOP_MARKET_MAKER_TYPES || "")
      .split(",").map(value => int(value)).filter(value => value > 0);
  if (!types.length) return { status: "NO_TYPES" };
  running = true;
  Promise.resolve()
    .then(() => runOnce({ ...options, types }))
    .catch(() => null)
    .finally(() => { running = false; });
  return { status: "STARTED", types: types.length };
}

module.exports = { runOnce, prepareQuotes, readQuote, placeBuy, cancelOrder, startBackground, enabled };
