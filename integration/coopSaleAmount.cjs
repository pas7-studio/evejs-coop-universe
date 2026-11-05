"use strict";

// The amount of money a sale moved, in the same unit the market itself pays in: whole
// ISK cents. A journal or a receipt that rounds a fill to whole ISK overstates the money
// by up to 0.5 ISK and the treasury reconciliation (sold == swept + unswept) then fails
// by that residue with no party to blame.
// Measured live 2026-11-03 in m003s8: 2 498 units at 5 113.18 paid 12 772 723.64 ISK into
// the corporation wallet, while `sale-attempts/980200000686.json` recorded 12 772 724 -
// 0.36 ISK of money that never moved - and `verify-l9a-world.js` reported
// SALES_DO_NOT_RECONCILE_WITH_TREASURY: sold=38791224 swept=38791223.64.
// One authority for the arithmetic: the market's own cent, never a second rounding rule.
const CENTS = 100;

function saleAmountISK(price, quantity) {
  const p = Number(price), q = Number(quantity);
  if (!Number.isFinite(p) || !Number.isFinite(q) || p <= 0 || q <= 0) return 0;
  const exact = p * q * CENTS;
  const cents = Math.round(exact);
  if (!Number.isSafeInteger(cents) || cents < 0) return 0;
  return cents / CENTS;
}

module.exports = {saleAmountISK, CENTS};
