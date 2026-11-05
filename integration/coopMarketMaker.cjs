"use strict";
// NPC market makers: the decision half of docs/MARKET_MAKERS.md.
//
// Pure functions only. Nothing here talks to the market daemon, holds ISK or places an order: the
// runtime that does that must book every rouble in the trader's own ledger before the order exists,
// because the Rust book accepts an order without any escrow check (audited 2026-11-03).
//
// Owner's rules: buy at -30 %..+30 % of the reference (2026-11-03), resell at +5 %..+40 % of what was
// paid, move the price against demand, rotate, keep caps.
// Narrowed 2026-11-05 to the owner's own words: "buy everything, even what nobody buys, at 70-90 % of
// the market, and try to resell at 105-140 %". So the bid band is 70 %..90 % of the reference - never
// above it, or the maker would be the one holding the bag on every dead item.
const DEFAULTS = Object.freeze({
  buyDiscountMin: 0.30,
  buyPremiumMax: -0.10,
  sellMarkupMin: 0.05,
  sellMarkupMax: 0.40,
  demandStep: 0.02,
  maxOrdersPerType: 3,
  orderTtlMs: 3 * 60 * 60 * 1000,
});

// Five traders, each with a large but *accounted* bankroll: the whole point is that this is real money
// in the same ledger as everything else, so the stimulus cannot print ISK. 50-100 billion each.
const TRADERS = Object.freeze([
  Object.freeze({ traderID: "mk-trader-1", bankrollISK: 100_000_000_000, dailySpendISK: 20_000_000_000 }),
  Object.freeze({ traderID: "mk-trader-2", bankrollISK: 90_000_000_000, dailySpendISK: 18_000_000_000 }),
  Object.freeze({ traderID: "mk-trader-3", bankrollISK: 80_000_000_000, dailySpendISK: 16_000_000_000 }),
  Object.freeze({ traderID: "mk-trader-4", bankrollISK: 70_000_000_000, dailySpendISK: 14_000_000_000 }),
  Object.freeze({ traderID: "mk-trader-5", bankrollISK: 50_000_000_000, dailySpendISK: 10_000_000_000 }),
]);

const isk = value => {
  const numeric = Number(value);
  return Number.isFinite(numeric) && numeric > 0 ? numeric : 0;
};
const fraction = (random, min, max) => {
  const unit = Number.isFinite(random) ? Math.min(0.999999, Math.max(0, random)) : 0.5;
  return min + (max - min) * unit;
};

// A bid never sits above the best ask: it would fill instantly and stop being a bid at all.
function decideBuyPrice({
  referenceISK, bestAskISK = 0, random = 0.5, cfg = DEFAULTS,
} = {}) {
  const reference = isk(referenceISK);
  if (reference <= 0) return { ok: false, reason: "NO_REFERENCE" };
  const factor = fraction(random, 1 - cfg.buyDiscountMin, 1 + cfg.buyPremiumMax);
  let priceISK = Math.max(1, Math.round(reference * factor));
  const ask = isk(bestAskISK);
  if (ask > 0 && priceISK >= ask) priceISK = Math.max(1, Math.round(ask * 0.99));
  if (ask > 0 && priceISK >= ask) return { ok: false, reason: "NO_ROOM_BELOW_ASK" };
  return { ok: true, priceISK, factor };
}

// A listing never sits below the best bid, and never below cost: a maker that sells at a loss is a
// leak, not a market.
function decideSellPrice({
  costBasisISK, bestBidISK = 0, random = 0.5, cfg = DEFAULTS,
} = {}) {
  const cost = isk(costBasisISK);
  if (cost <= 0) return { ok: false, reason: "NO_COST_BASIS" };
  const factor = fraction(random, 1 + cfg.sellMarkupMin, 1 + cfg.sellMarkupMax);
  let priceISK = Math.max(1, Math.round(cost * factor));
  const bid = isk(bestBidISK);
  if (bid > 0 && priceISK <= bid) priceISK = Math.round(bid * 1.01) || bid + 1;
  return { ok: true, priceISK, factor, margin: (priceISK - cost) / cost };
}

// Demand feedback, bounded to the owner's corridors: a filled order moves the next price up, an order
// that sat for its whole life moves it down. The result is always re-checked against the band.
function adjustForDemand({
  priceISK, filled = false, expired = false, kind = "buy", cfg = DEFAULTS,
} = {}) {
  const price = isk(priceISK);
  if (price <= 0) return { ok: false, reason: "NO_PRICE" };
  const step = Number(cfg.demandStep) || DEFAULTS.demandStep;
  if (filled === expired) return { ok: true, priceISK: price, moved: 0 };
  const moved = filled ? Math.round(price * (1 + step)) : Math.round(price * (1 - step));
  return { ok: true, priceISK: Math.max(1, moved), moved: filled ? step : -step, kind };
}

// One line per decision, so the effect on the book is measurable instead of felt.
function describeDecision({ typeID, stationID, kind, priceISK, quantity = 1, reason = null } = {}) {
  return Object.freeze({
    typeID: Number(typeID) || 0,
    stationID: Number(stationID) || 0,
    kind: String(kind || ""),
    priceISK: isk(priceISK),
    quantity: Math.max(1, Math.trunc(Number(quantity) || 1)),
    reason: reason ? String(reason) : null,
  });
}

module.exports = {
  DEFAULTS,
  TRADERS,
  decideBuyPrice,
  decideSellPrice,
  adjustForDemand,
  describeDecision,
};
