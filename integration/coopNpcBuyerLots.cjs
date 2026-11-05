"use strict";
// FW-144: what an NPC buyer is allowed to want.
//
// Owner rule (2026-11-05): "the allowlist should be really flexible - if someone makes
// something and sells it, buy it in small lots with a reserve, so it does not buy everything
// up, but it still stimulates demand."
//
// So this is not a fixed list of type ids: it is a policy over *whatever players actually
// offer*. For every type on sale it decides one small lot, and it refuses when buying would
// eat the book, drain the cash, or exceed the per-tick appetite. Nothing here talks to the
// market: it produces a plan the executor can either carry out or refuse with a reason.
//
// The three rules the owner asked for, in numbers:
//   lot      - never the whole stack: at most `maxLotFraction` of what is on offer, and at
//              most `maxLotUnits` units, so demand is steady instead of one big bite.
//   reserve  - the buyer keeps `minCashReserveCents` in its pocket and never spends more than
//              `maxSpendPerTickCents` in one tick, so it cannot run itself dry.
//   demand   - it buys types players really sell (the book's own asks), preferring cheap ones,
//              and it will pay a small premium over the reference price to keep a live bid
//              under the goods (stimulus), never above `maxPremiumBps`.
const DEFAULT_MAX_LOT_FRACTION = 0.25;
const DEFAULT_MAX_LOT_UNITS = 50;
const DEFAULT_MAX_SPEND_PER_TICK_CENTS = 500_000_000; // 5 M ISK
const DEFAULT_MAX_PREMIUM_BPS = 300; // 3 % over the reference
const money = (value) => Number.isSafeInteger(Number(value)) && Number(value) >= 0 ? Number(value) : null;
const pos = (value) => Number.isSafeInteger(Number(value)) && Number(value) > 0 ? Number(value) : 0;

function planLotPurchases({
  asks = [],
  cashCents = 0,
  minCashReserveCents = 0,
  maxSpendPerTickCents = DEFAULT_MAX_SPEND_PER_TICK_CENTS,
  maxUnitPriceCents = 0,
  maxLotFraction = DEFAULT_MAX_LOT_FRACTION,
  maxLotUnits = DEFAULT_MAX_LOT_UNITS,
  maxPremiumBps = DEFAULT_MAX_PREMIUM_BPS,
  openTypeIDs = [],
  // true = the caller can only claim a whole stack (the native path today), so an offer is
  // eligible only when it is already a small lot; false = a fraction may be taken.
  wholeStackOnly = false,
  now = Date.now(),
} = {}) {
  const cash = money(cashCents);
  const reserve = money(minCashReserveCents);
  const budgetCap = money(maxSpendPerTickCents);
  if (cash === null || reserve === null || budgetCap === null || !pos(now)) {
    return { status: "INVALID_BUYER_LEDGER", lots: [], reason: "MONEY_OR_CLOCK_INVALID" };
  }
  const spendable = Math.min(budgetCap, cash - reserve);
  if (!(spendable > 0)) {
    return { status: "NO_SPENDABLE_ISK", lots: [], reason: "CASH_RESERVE_HELD" };
  }
  const fraction = Math.max(0.01, Math.min(1, Number(maxLotFraction) || DEFAULT_MAX_LOT_FRACTION));
  const unitCap = Math.max(1, Math.trunc(Number(maxLotUnits) || DEFAULT_MAX_LOT_UNITS));
  const priceCap = Math.max(0, Math.trunc(Number(maxUnitPriceCents) || 0));
  const premiumBps = Math.max(0, Math.min(2000, Math.trunc(Number(maxPremiumBps) || 0)));
  const alreadyOpen = new Set((Array.isArray(openTypeIDs) ? openTypeIDs : []).map(pos).filter(Boolean));

  // One lot per type, cheapest first: a buyer with a small appetite should take the offers
  // that give the world the most goods per ISK.
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
    if (priceCap > 0 && unitPriceCents > priceCap) continue;
    seen.add(typeID);
    candidates.push({ typeID, orderID: pos(ask.orderID), remaining, unitPriceCents,
      sellerOwnerID: pos(ask.sellerOwnerID), stationID: pos(ask.stationID) });
  }
  if (!candidates.length) {
    return { status: "NO_ELIGIBLE_OFFERS", lots: [], reason: "NOTHING_ON_SALE" };
  }
  candidates.sort((left, right) => left.unitPriceCents - right.unitPriceCents
    || right.remaining - left.remaining || left.typeID - right.typeID);

  const lots = [];
  let remainingBudget = spendable;
  for (const candidate of candidates) {
    // Small lot: a fraction of what is on offer, capped in units, never the whole stack.
    // With a whole-stack-only executor the offer must already fit the unit cap.
    if (wholeStackOnly && candidate.remaining > unitCap) continue;
    const byFraction = Math.max(1, Math.ceil(candidate.remaining * fraction));
    const quantity = wholeStackOnly
      ? candidate.remaining
      : Math.min(candidate.remaining, unitCap, byFraction);
    if (!(quantity > 0)) continue;
    // Stimulus without extortion: pay up to `premiumBps` over the ask, still within the cap.
    const bidCents = Math.min(
      Math.ceil(candidate.unitPriceCents * (1 + premiumBps / 10000)),
      priceCap > 0 ? priceCap : Number.MAX_SAFE_INTEGER,
    );
    const cost = bidCents * quantity;
    if (!Number.isSafeInteger(cost) || cost <= 0) continue;
    if (cost > remainingBudget) continue;
    remainingBudget -= cost;
    lots.push({
      typeID: candidate.typeID,
      sourceOrderID: candidate.orderID,
      sellerOwnerID: candidate.sellerOwnerID,
      stationID: candidate.stationID,
      quantity,
      offerQuantity: candidate.remaining,
      askUnitPriceCents: candidate.unitPriceCents,
      bidUnitPriceCents: bidCents,
      totalCents: cost,
      keepsBookShare: Math.round((1 - quantity / candidate.remaining) * 1000) / 1000,
      reason: "SMALL_LOT_UNDER_RESERVE",
    });
  }
  if (!lots.length) {
    return { status: "NO_AFFORDABLE_LOT", lots: [], reason: "EVERY_LOT_EXCEEDS_BUDGET" };
  }
  return {
    status: "PLANNED",
    lots,
    spentCents: lots.reduce((sum, lot) => sum + lot.totalCents, 0),
    reserveHeldCents: reserve,
    cashAfterCents: cash - lots.reduce((sum, lot) => sum + lot.totalCents, 0),
  };
}

module.exports = {
  DEFAULT_MAX_LOT_FRACTION,
  DEFAULT_MAX_LOT_UNITS,
  DEFAULT_MAX_PREMIUM_BPS,
  DEFAULT_MAX_SPEND_PER_TICK_CENTS,
  planLotPurchases,
};
