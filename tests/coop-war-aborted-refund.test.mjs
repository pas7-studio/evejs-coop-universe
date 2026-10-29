// FW-094 guard: escrow taken for a border that was never opened must come back.
//
// Measured on the work stack 2026-10-29: the both-sides rule funded one side and
// then refused the border because the other side could not pay, so the escrow
// belonged to a campaign that was never created. `coopWarTreasury` already accepts
// exactly that case (a REFUND with an `unfunded:` proof and no campaign record),
// but the runtime's refund authority only ever authorised TERMINAL campaigns and
// vetoed the hatch: `war:500011-500020:...:r7` reserved 5 000 ISK from 1000138 and
// released it as WAR_TREASURY_REFUND_NOT_AUTHORIZED, on top of two older orphan
// HELD rows from the same corporation. Real income was being drained by openings
// that never existed.
import test from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";
const require = createRequire(import.meta.url);
const { warRefundAuthorization } = require("../integration/coopVirtualWorldRuntime.pure.cjs");

const CAMPAIGN = "war:500001-500011:campaign:30045320:r3";

test("an aborted opening releases its escrow", () => {
  assert.equal(warRefundAuthorization({
    war: { warID: "war:500001-500011", state: "ACTIVE" },
    campaign: null,
    proofID: "unfunded:" + CAMPAIGN }), true);
});

test("a live campaign still holds its escrow", () => {
  for (const state of ["PREPARING", "ASSAULT", "CONTESTED"]) {
    assert.equal(warRefundAuthorization({
      war: { state: "ACTIVE" },
      campaign: { campaignID: CAMPAIGN, state },
      proofID: "unfunded:" + CAMPAIGN }), false, state);
  }
});

test("only a terminal campaign, an ended war or the explicit unfunded proof is refundable", () => {
  assert.equal(warRefundAuthorization({
    war: { state: "ACTIVE" }, campaign: { state: "EXPIRED" }, proofID: "fw:release:x" }), true);
  assert.equal(warRefundAuthorization({
    war: { state: "ACTIVE" }, campaign: { state: "OCCUPIED" }, proofID: "fw:release:x" }), true);
  assert.equal(warRefundAuthorization({
    war: { state: "ENDED" }, campaign: { state: "ASSAULT" }, proofID: "fw:release:x" }), true);
  // A normal-looking proof is not an aborted opening.
  assert.equal(warRefundAuthorization({
    war: { state: "ACTIVE" }, campaign: null, proofID: "fw:release:whatever" }), false);
  // An invalid proof string is never accepted.
  assert.equal(warRefundAuthorization({
    war: { state: "ACTIVE" }, campaign: { state: "EXPIRED" }, proofID: "" }), false);
  assert.equal(warRefundAuthorization({}), false);
});
