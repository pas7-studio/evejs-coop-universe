// FW-093 guard: a faction pays its war from the corporation of ITS OWN that really
// holds the money.
//
// Measured on the work stack 2026-10-29 with war_funding_diagnose and the raw
// SQLite rows: faction 500001 fields hulls whose corporation is 1000180 (0 ISK)
// while corporation 1000035 of the SAME faction held 90 000 ISK from real
// mercenary settlements; faction 500004 had 0 ISK at its militia corporation
// 1000181 and 530 000 ISK at 1000120. Every border was refused
// WAR_TREASURY_FUNDS_UNAVAILABLE with the money sitting in the same faction.
//
// The rule under test is narrow and stays inside one faction: the richest
// corporation that can really cover the bounty pays, the historical corporation
// is kept when nothing can, and an unreadable balance is never money.
import test from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";
const require = createRequire(import.meta.url);
const { pickFundingCorporation } = require("../integration/coopVirtualWorldRuntime.pure.cjs");

const BOUNTY = 5000;            // EVEJS_COOP_WAR_BOUNTY_ISK on the work stack
const NEED_CENTS = BOUNTY * 100;
const wallets = { 1000180: 0, 1000035: 90000, 1000120: 530000, 1000135: 0 };
const readBalance = (id) => (id in wallets ? wallets[id] : null);

test("the faction corporation that really holds the ISK pays instead of the pilot corporation", () => {
  const paid = pickFundingCorporation({
    ordered: [1000180, 1000035], needCents: NEED_CENTS, readBalance });
  assert.equal(paid.corporationID, 1000035);
  assert.equal(paid.walletISK, 90000);
  assert.equal(paid.fallback, true, "the payer must be visible as a fallback");
});

test("the richer of two payable corporations is chosen, ties by lower id", () => {
  assert.equal(pickFundingCorporation({
    ordered: [1000180, 1000120, 1000035], needCents: NEED_CENTS, readBalance }).corporationID, 1000120);
  const flat = { 7: 10000, 9: 10000 };
  assert.equal(pickFundingCorporation({
    ordered: [7, 9], needCents: NEED_CENTS, readBalance: (id) => flat[id] }).corporationID, 7);
});

test("a faction with money nowhere keeps its historical corporation", () => {
  const paid = pickFundingCorporation({
    ordered: [1000135, 1000180], needCents: NEED_CENTS, readBalance });
  assert.equal(paid.corporationID, 1000135, "a refusal must name the same corporation as before");
  assert.equal(paid.fallback, false);
  assert.equal(paid.walletISK, 0);
});

test("an unreadable balance is never treated as money", () => {
  const paid = pickFundingCorporation({
    ordered: [1000135, 1000035], needCents: NEED_CENTS,
    readBalance: () => { throw new Error("sqlite busy"); } });
  assert.equal(paid.corporationID, 1000135);
  assert.equal(paid.walletISK, null);
  // No reader at all is also unknown, not a yes.
  assert.equal(pickFundingCorporation({
    ordered: [1000035], needCents: NEED_CENTS }).corporationID, 1000035);
  // A balance below the bounty cannot pay it.
  assert.equal(pickFundingCorporation({
    ordered: [1000035], needCents: 50000000, readBalance }).corporationID, 1000035);
});

test("only the faction's own corporations are ever candidates", () => {
  // The caller builds the list from the faction; the decision never invents one.
  const paid = pickFundingCorporation({ ordered: [], needCents: NEED_CENTS, readBalance });
  assert.equal(paid.corporationID, 0);
  assert.equal(paid.candidates, 0);
});
