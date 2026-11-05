"use strict";
// COOP-MM: the owner's trader rule (2026-11-05): "with 50-200 billion, buy everything - even what
// nobody buys - at 70-90 % of the market, and try to resell at 105-140 %."
//
// That is a market maker, not a hoarder: a wide spread that provides liquidity to dead items and
// still keeps a margin. This module is the POLICY only - it decides what to lift, what to bid and
// what to ask, from the book that really exists. It never places an order and never touches a wallet;
// the executor (coopNpcCorporateBuyerAtomic for a player's ask, the native NPC seller for our own
// stock, a native buy order for the bid band) carries out one decision at a time.
//
// Bands are percentages of a REFERENCE price (the market's own seed/ask price for that type):
//   buy   <= 90 % of reference  (never more: that is not a bargain)
//   bid   = 70 % of reference   (the liquidity floor for types nobody sells)
//   sell  >= 105 % of reference (never less: the spread has to pay for itself)
//   sell  <= 140 % of reference (above that it just sits there)
// Every refusal has its own status so a live run can say why it did nothing.
const BUY_MAX_PCT = 0.90;
const BID_PCT = 0.70;
const SELL_MIN_PCT = 1.05;
const SELL_MAX_PCT = 1.40;
const DEFAULT_MAX_LOT_UNITS = 50;
const DEFAULT_MIN_PROFIT_BPS = 800; // 8 % gross is the floor we are willing to trade on
const DEFAULT_MIN_RESERVE_CENTS = 1_000_000_000; // 10 M ISK kept back, never spent

// A missing money value is NOT zero: an unreadable wallet must refuse, never spend nothing quietly.
const money = (value) => (value === null || value === undefined)
  ? null
  : (Number.isSafeInteger(Number(value)) && Number(value) >= 0 ? Number(value) : null);
const pos = (value) => Number.isSafeInteger(Number(value)) && Number(value) > 0
  ? Number(value)
  : 0;

function priceAt(referencePriceCents, pct) {
  return Math.max(1, Math.round(referencePriceCents * pct));
}

// Which of the book's asks are bargains, cheapest first, inside the budget and the reserve.
function planBargainBuys({
  asks = [],
  referencePriceCents = 0,
  cashCents = 0,
  minReserveCents = DEFAULT_MIN_RESERVE_CENTS,
  maxSpendCents = 0,
  maxLotUnits = DEFAULT_MAX_LOT_UNITS,
  maxBuyPct = BUY_MAX_PCT,
  minProfitBps = DEFAULT_MIN_PROFIT_BPS,
  sellPct = SELL_MIN_PCT,
  openTypeIDs = [],
} = {}) {
  const cash = money(cashCents);
  const reserve = money(minReserveCents);
  const reference = money(referencePriceCents);
  if (cash === null || reserve === null || !pos(reference)) {
    return { status: "INVALID_MARKET_MAKER_LEDGER", lots: [], reason: "REFERENCE_OR_CASH_INVALID" };
  }
  const spendable = Math.min(
    maxSpendCents > 0 ? money(maxSpendCents) ?? 0 : Number.MAX_SAFE_INTEGER,
    cash - reserve,
  );
  if (!(spendable > 0)) {
    return { status: "NO_SPENDABLE_ISK", lots: [], reason: "CASH_RESERVE_HELD" };
  }
  const unitCap = Math.max(1, Math.trunc(Number(maxLotUnits) || DEFAULT_MAX_LOT_UNITS));
  // The buy band is a fraction below 1, so it must be clamped DOWN to 1, not up to it.
  const buyPct = Math.min(1, Math.max(0.01, Number(maxBuyPct) || BUY_MAX_PCT));
  const buyCeiling = priceAt(reference, buyPct);
  const sellFloor = priceAt(reference, Math.max(1, Number(sellPct) || SELL_MIN_PCT));
  const alreadyOpen = new Set((Array.isArray(openTypeIDs) ? openTypeIDs : []).map(pos).filter(Boolean));

  const candidates = [];
  const seen = new Set();
  for (const ask of Array.isArray(asks) ? asks : []) {
    if (!ask || typeof ask !== "object") continue;
    const typeID = pos(ask.typeID);
    const remaining = pos(ask.remainingQuantity);
    const unitPriceCents = money(ask.unitPriceCents);
    if (!typeID || !remaining || unitPriceCents === null || !(unitPriceCents > 0)) continue;
    if (ask.verifiedNative !== true || String(ask.state || "open") !== "open") continue;
    if (alreadyOpen.has(typeID) || seen.has(typeID)) continue;
    if (unitPriceCents > buyCeiling) continue; // not a bargain: leave it alone
    seen.add(typeID);
    candidates.push({ typeID, orderID: pos(ask.orderID), remaining, unitPriceCents,
      sellerOwnerID: pos(ask.sellerOwnerID), stationID: pos(ask.stationID) });
  }
  if (!candidates.length) {
    return { status: "NO_BARGAIN_ON_BOOK", lots: [], reason: "NOTHING_BELOW_BUY_CEILING",
      buyCeilingCents: buyCeiling, sellFloorCents: sellFloor };
  }
  candidates.sort((left, right) => left.unitPriceCents - right.unitPriceCents
    || right.remaining - left.remaining || left.typeID - right.typeID);

  const lots = [];
  let remainingBudget = spendable;
  for (const candidate of candidates) {
    const quantity = Math.min(candidate.remaining, unitCap);
    if (!(quantity > 0)) continue;
    const cost = candidate.unitPriceCents * quantity;
    if (!Number.isSafeInteger(cost) || cost <= 0 || cost > remainingBudget) continue;
    // The reason to buy is the spread, not the discount alone: a 90 % ask that can only be resold
    // at 105 % still clears the floor, but a thin gap on a dead item does not.
    const profitBps = sellFloor > 0
      ? Math.round(((sellFloor - candidate.unitPriceCents) / candidate.unitPriceCents) * 10000)
      : 0;
    if (profitBps < Math.max(0, Math.trunc(Number(minProfitBps) || 0))) continue;
    remainingBudget -= cost;
    lots.push({
      typeID: candidate.typeID,
      sourceOrderID: candidate.orderID,
      sellerOwnerID: candidate.sellerOwnerID,
      stationID: candidate.stationID,
      quantity,
      offerQuantity: candidate.remaining,
      buyUnitPriceCents: candidate.unitPriceCents,
      sellFloorUnitPriceCents: sellFloor,
      sellTargetUnitPriceCents: priceAt(reference, SELL_MAX_PCT),
      grossProfitBps: profitBps,
      totalCents: cost,
      reason: "BARGAIN_UNDER_BUY_CEILING",
    });
  }
  if (!lots.length) {
    return { status: "NO_PROFITABLE_LOT", lots: [],
      reason: "EVERY_BARGAIN_BELOW_MIN_PROFIT_OR_BUDGET" };
  }
  const spent = lots.reduce((sum, lot) => sum + lot.totalCents, 0);
  return {
    status: "PLANNED",
    lots,
    spentCents: spent,
    reserveHeldCents: reserve,
    cashAfterCents: cash - spent,
    buyCeilingCents: buyCeiling,
    sellFloorCents: sellFloor,
  };
}

// A type nobody sells still deserves a bid: that is how a dead item gets a floor.
function planLiquidityBids({
  types = [],
  cashCents = 0,
  minReserveCents = DEFAULT_MIN_RESERVE_CENTS,
  maxSpendCents = 0,
  maxBidUnits = DEFAULT_MAX_LOT_UNITS,
  bidPct = BID_PCT,
  sellPct = SELL_MIN_PCT,
  openTypeIDs = [],
} = {}) {
  const cash = money(cashCents);
  const reserve = money(minReserveCents);
  if (cash === null || reserve === null) {
    return { status: "INVALID_MARKET_MAKER_LEDGER", bids: [], reason: "CASH_INVALID" };
  }
  const spendable = Math.min(
    maxSpendCents > 0 ? money(maxSpendCents) ?? 0 : Number.MAX_SAFE_INTEGER,
    cash - reserve,
  );
  if (!(spendable > 0)) return { status: "NO_SPENDABLE_ISK", bids: [], reason: "CASH_RESERVE_HELD" };
  const unitCap = Math.max(1, Math.trunc(Number(maxBidUnits) || DEFAULT_MAX_LOT_UNITS));
  const alreadyOpen = new Set((Array.isArray(openTypeIDs) ? openTypeIDs : []).map(pos).filter(Boolean));
  const bids = [];
  let remainingBudget = spendable;
  const ordered = (Array.isArray(types) ? types : [])
    .filter((entry) => entry && typeof entry === "object")
    .map((entry) => ({
      typeID: pos(entry.typeID),
      referencePriceCents: money(entry.referencePriceCents),
      stationID: pos(entry.stationID),
      asksOnBook: Number.isSafeInteger(Number(entry.asksOnBook)) ? Number(entry.asksOnBook) : 0,
      ownedStock: money(entry.ownedStock) ?? 0,
    }))
    .filter((entry) => entry.typeID && entry.referencePriceCents && !alreadyOpen.has(entry.typeID))
    // Dead first: an item with no asks at all is exactly what the owner asked us to price.
    .sort((left, right) => left.asksOnBook - right.asksOnBook || left.typeID - right.typeID);
  for (const entry of ordered) {
    const bidUnitPriceCents = priceAt(entry.referencePriceCents, Math.max(0.01, Number(bidPct) || BID_PCT));
    const sellFloorUnitPriceCents = priceAt(entry.referencePriceCents, Math.max(1, Number(sellPct) || SELL_MIN_PCT));
    const quantity = unitCap;
    const cost = bidUnitPriceCents * quantity;
    if (!Number.isSafeInteger(cost) || cost <= 0 || cost > remainingBudget) continue;
    remainingBudget -= cost;
    bids.push({
      typeID: entry.typeID,
      stationID: entry.stationID,
      quantity,
      bidUnitPriceCents,
      sellFloorUnitPriceCents,
      asksOnBook: entry.asksOnBook,
      totalCents: cost,
      reason: entry.asksOnBook === 0 ? "LIQUIDITY_BID_NO_ASKS" : "LIQUIDITY_BID_DEAD_BOOK",
    });
  }
  if (!bids.length) return { status: "NO_BID", bids: [], reason: "NOTHING_TO_PRICE_OR_BUDGET" };
  return {
    status: "PLANNED",
    bids,
    reservedCents: bids.reduce((sum, bid) => sum + bid.totalCents, 0),
    reserveHeldCents: reserve,
  };
}

// What we ask for our own stock: high end first, never under the floor, never over the ceiling.
function planResaleAsks({
  stock = [],
  referencePriceCents = 0,
  existingOwnAskTypeIDs = [],
  sellPct = SELL_MAX_PCT,
  floorPct = SELL_MIN_PCT,
} = {}) {
  const reference = money(referencePriceCents);
  if (!pos(reference)) {
    return { status: "INVALID_MARKET_MAKER_LEDGER", asks: [], reason: "REFERENCE_INVALID" };
  }
  const floorCents = priceAt(reference, Math.max(1, Number(floorPct) || SELL_MIN_PCT));
  const targetCents = Math.max(floorCents, priceAt(reference, Math.max(1, Number(sellPct) || SELL_MAX_PCT)));
  const have = new Set((Array.isArray(existingOwnAskTypeIDs) ? existingOwnAskTypeIDs : []).map(pos).filter(Boolean));
  const asks = [];
  for (const entry of Array.isArray(stock) ? stock : []) {
    const typeID = pos(entry && entry.typeID);
    const quantity = pos(entry && entry.quantity);
    const stationID = pos(entry && entry.stationID);
    if (!typeID || !quantity || have.has(typeID)) continue;
    asks.push({ typeID, stationID, quantity, unitPriceCents: targetCents, floorCents,
      reason: "RESALE_AT_TARGET" });
    have.add(typeID);
  }
  if (!asks.length) return { status: "NO_RESALE", asks: [], reason: "NO_STOCK_OR_ALREADY_LISTED" };
  return { status: "PLANNED", asks, floorCents, targetCents };
}

module.exports = {
  BID_PCT,
  BUY_MAX_PCT,
  DEFAULT_MAX_LOT_UNITS,
  DEFAULT_MIN_PROFIT_BPS,
  DEFAULT_MIN_RESERVE_CENTS,
  SELL_MAX_PCT,
  SELL_MIN_PCT,
  planBargainBuys,
  planLiquidityBids,
  planResaleAsks,
};
