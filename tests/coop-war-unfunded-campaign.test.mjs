// FW-062 guard: a live campaign with no escrow anywhere can never pay, so it must
// not keep its claim.
//
// Found by the campaign validator (scripts/coop-war-validate.cjs), not by a unit test:
// `live-campaign-funded` failed for war:500004-500011:campaign:30045344 and :30003836
// - both ASSAULT, both with zero reservations on either side, because the FW-050 store
// defect reverted the treasury row. Under REQUIRE_FUNDING=1 a campaign cannot open
// without escrow, so "no HELD and no PAID" means the money was lost, and a campaign in
// that state squats its target and hides the loss instead of releasing it.
import test from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";
const require = createRequire(import.meta.url);
const { expireUnfundedCampaigns } = require("../integration/coopFactionWarOpening.cjs");

const state = (campaignState = "ASSAULT", revision = 1) => ({
  version: 1,
  wars: { "war:1-2": { warID: "war:1-2", attackerFactionID: 1, defenderFactionID: 2, state: "ACTIVE" } },
  campaigns: { "war:1-2:campaign:3": { campaignID: "war:1-2:campaign:3", warID: "war:1-2",
    sourceSystemID: 4, targetSystemID: 3, state: campaignState, objectiveEvidence: [],
    revision, startedAt: 100 } },
  territories: { "3": { systemID: 3, originalOwnerFactionID: 2, militaryControllerFactionID: 2,
    state: "CONTESTED", revision, changedAt: 100 } },
  enlistments: {}, processed: {}, history: [],
});

test("an assault whose escrow vanished is expired and releases its claim", () => {
  const war = state();
  const result = expireUnfundedCampaigns(war, { nowMs: 2000, isFunded: () => false });
  assert.deepEqual(result.campaignIDs, ["war:1-2:campaign:3"]);
  const campaign = war.campaigns["war:1-2:campaign:3"];
  assert.equal(campaign.state, "EXPIRED");
  assert.equal(campaign.expiredReason, "WAR_ESCROW_MISSING");
  assert.equal(war.territories["3"].state, "SECURE", "the claim is released with the campaign");
});

test("a funded campaign is never touched, whatever the money looks like", () => {
  const war = state();
  const result = expireUnfundedCampaigns(war, { nowMs: 2000, isFunded: () => true });
  assert.deepEqual(result.campaignIDs, []);
  assert.equal(war.campaigns["war:1-2:campaign:3"].state, "ASSAULT");
});

test("an unreadable funding answer never expires a war", () => {
  const war = state();
  const result = expireUnfundedCampaigns(war, { nowMs: 2000,
    isFunded: () => { throw Error("TREASURY_UNAVAILABLE"); } });
  assert.deepEqual(result.campaignIDs, [], "missing data is not evidence of missing money");
  assert.equal(war.campaigns["war:1-2:campaign:3"].state, "ASSAULT");
});

test("a terminal campaign is left alone and no predicate means no change", () => {
  const expired = state("EXPIRED");
  assert.deepEqual(expireUnfundedCampaigns(expired, { nowMs: 2000, isFunded: () => false }).campaignIDs, []);
  const war = state();
  assert.deepEqual(expireUnfundedCampaigns(war, { nowMs: 2000 }).campaignIDs, []);
  assert.equal(war.campaigns["war:1-2:campaign:3"].state, "ASSAULT");
});
