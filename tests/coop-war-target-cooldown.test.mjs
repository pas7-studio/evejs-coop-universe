// FW-064 guard: a border that keeps expiring must back off, not loop.
//
// Measured overnight on the work stack: 30045343 reopened and expired four times
// (:r2, :r3, :r4), each cycle reserving real escrow and refunding it 45 minutes later,
// because the defender never fielded a hull there. The cooldown now grows with the
// number of campaigns that target has already lost, and a successful assault resets it
// because only EXPIRED records are counted.
import test from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";
const require = createRequire(import.meta.url);
const { targetCooldownMs } = require("../integration/coopFactionWarOpening.cjs");

const BASE = 45 * 60 * 1000;
const campaign = (id, target, state, expiredAt = 0) => ({ campaignID: id, warID: "war:1-2",
  sourceSystemID: 1, targetSystemID: target, state, objectiveEvidence: [],
  revision: 1, expiredAt });

test("a target that never failed waits only the base window", () => {
  assert.equal(targetCooldownMs({ state: { campaigns: {} }, targetSystemID: 30045343, baseMs: BASE }), BASE);
});

test("each lost campaign doubles the wait, capped", () => {
  const state = (count) => ({ campaigns: Object.fromEntries(Array.from({ length: count },
    (_unused, index) => [`c${index}`, campaign(`c${index}`, 30045343, "EXPIRED", 1000 + index)])) });
  assert.equal(targetCooldownMs({ state: state(1), targetSystemID: 30045343, baseMs: BASE }), BASE * 1);
  assert.equal(targetCooldownMs({ state: state(2), targetSystemID: 30045343, baseMs: BASE }), BASE * 2);
  assert.equal(targetCooldownMs({ state: state(3), targetSystemID: 30045343, baseMs: BASE }), BASE * 4);
  assert.equal(targetCooldownMs({ state: state(9), targetSystemID: 30045343, baseMs: BASE }), BASE * 8,
    "the cap keeps a dead border from being retried only once a week");
});

test("a live or captured campaign is not a failure and resets the wait", () => {
  const state = { campaigns: {
    a: campaign("a", 30045343, "ASSAULT"),
    b: campaign("b", 30045343, "OCCUPIED"),
    c: campaign("c", 30045343, "PREPARING"),
  } };
  assert.equal(targetCooldownMs({ state, targetSystemID: 30045343, baseMs: BASE }), BASE);
});

test("another system's failures never slow this border down", () => {
  const state = { campaigns: {
    a: campaign("a", 111, "EXPIRED", 1),
    b: campaign("b", 111, "EXPIRED", 2),
  } };
  assert.equal(targetCooldownMs({ state, targetSystemID: 222, baseMs: BASE }), BASE);
});

test("a missing or invalid target still answers the base window, never zero", () => {
  assert.equal(targetCooldownMs({ state: null, targetSystemID: 30045343, baseMs: BASE }), BASE);
  assert.equal(targetCooldownMs({ state: { campaigns: {} }, targetSystemID: 0, baseMs: BASE }), BASE);
  assert.equal(targetCooldownMs({ state: { campaigns: {} }, targetSystemID: 30045343, baseMs: 0 }), 1);
});

// FW-099: WAR_ESCROW_MISSING is a treasury defect, not a fact about the border.
//
// Measured on the owner's play stack 2026-10-30: ten campaigns of 30003837 and five of
// 30045344 expired with that reason while FW-050 was live. The 8x cooldown they left
// behind kept the only armed border of a funded war (decision BOTH_SIDES_CAN_FIELD_NAVY)
// shut for hours after the treasury was fixed, so the world reported "no front" all day.
const lostEscrow = (id, target, expiredAt) => ({ ...campaign(id, target, "EXPIRED", expiredAt),
  expiredReason: "WAR_ESCROW_MISSING" });
const noProof = (id, target, expiredAt) => ({ ...campaign(id, target, "EXPIRED", expiredAt),
  expiredReason: "NO_ASSAULT_DEPLOYMENT_PROOF" });

test("a border released for lost escrow does not inherit a weeks-long backoff", () => {
  const state = { campaigns: Object.fromEntries(Array.from({ length: 10 },
    (_unused, index) => [`c${index}`, lostEscrow(`c${index}`, 30003837, 1000 + index)])) };
  assert.equal(targetCooldownMs({ state, targetSystemID: 30003837, baseMs: BASE }), BASE,
    "10 lost-escrow releases must not sum to the 8x cap");
});

test("an expired assault proof still grows the cooldown, and mixed history counts only it", () => {
  const only = { campaigns: { a: noProof("a", 30045344, 1), b: noProof("b", 30045344, 2) } };
  assert.equal(targetCooldownMs({ state: only, targetSystemID: 30045344, baseMs: BASE }), BASE * 2);
  const mixed = { campaigns: { a: lostEscrow("a", 30045344, 1), b: noProof("b", 30045344, 2),
    c: lostEscrow("c", 30045344, 3), d: noProof("d", 30045344, 4) } };
  assert.equal(targetCooldownMs({ state: mixed, targetSystemID: 30045344, baseMs: BASE }), BASE * 2,
    "two real assault-proof failures, two ignored escrow releases");
});

test("an unknown reason is still a failure, never an excuse", () => {
  const state = { campaigns: { a: campaign("a", 30045344, "EXPIRED", 1),
    b: { ...campaign("b", 30045344, "EXPIRED", 2), expiredReason: "SOMETHING_NEW" } } };
  assert.equal(targetCooldownMs({ state, targetSystemID: 30045344, baseMs: BASE }), BASE * 2);
});

// FW-100: the in-memory pacing map must obey the same rule as the durable record.
//
// Measured on the play stack 2026-10-30 21:08Z: campaign r17 of 30003837 opened and was
// released one minute later with WAR_ESCROW_MISSING, and the map - which kept only a
// timestamp - paced the border for the full grown window although FW-099 had just made
// that reason count as zero. The map now carries the reason with the time.
const { expireUnfundedCampaigns, expireStalledCampaigns, coolingDown } =
  require("../integration/coopFactionWarOpening.cjs");

const NOW = 1793308000000;
const territories = (target) => ({ [String(target)]: { state: "CONTESTED", revision: 1 } });
const live = (id, target, startedAt) => ({ ...campaign(id, target, "PREPARING", 0),
  startedAt, revision: 1 });

test("a lost-escrow release paces the border for the base window, never the grown one", () => {
  const prior = [noProof("p1", 30003837, NOW - 10 * BASE), noProof("p2", 30003837, NOW - 9 * BASE),
    noProof("p3", 30003837, NOW - 8 * BASE)];
  const state = { territories: territories(30003837), campaigns: {
    ...Object.fromEntries(prior.map((row) => [row.campaignID, row])),
    c: live("c", 30003837, NOW - BASE),
  } };
  const { campaignIDs } = expireUnfundedCampaigns(state, { nowMs: NOW, isFunded: () => false });
  assert.deepEqual(campaignIDs, ["c"]);
  assert.equal(state.campaigns.c.expiredReason, "WAR_ESCROW_MISSING");
  // Three real failures would pace 4 x BASE; this release must not inherit that.
  assert.equal(targetCooldownMs({ state, targetSystemID: 30003837, baseMs: BASE }), BASE * 4);
  assert.equal(coolingDown(30003837, NOW + BASE - 1000, BASE, state), true,
    "it still may not reopen on the very next tick");
  assert.equal(coolingDown(30003837, NOW + BASE + 1000, BASE, state), false,
    "after the base window the stale release stops pacing the border");
});

test("a real assault-proof failure still paces for the grown window", () => {
  const state = { territories: territories(30045344), campaigns: {
    p1: noProof("p1", 30045344, NOW - 10 * BASE),
    p2: noProof("p2", 30045344, NOW - 9 * BASE),
    c: live("c", 30045344, NOW - 3 * BASE),
  } };
  const { campaignIDs } = expireStalledCampaigns(state, { nowMs: NOW, ttlMs: BASE });
  assert.deepEqual(campaignIDs, ["c"]);
  assert.equal(state.campaigns.c.expiredReason, "NO_ASSAULT_DEPLOYMENT_PROOF");
  assert.equal(coolingDown(30045344, NOW + BASE + 1000, BASE, state), true,
    "three real failures still hold the border for 4 x BASE");
  assert.equal(coolingDown(30045344, NOW + 4 * BASE + 1000, BASE, state), false);
});

// FW-101: the escrow-missing expirer may only run where escrow is required.
//
// Measured on the play stack 2026-10-30: it runs EVEJS_COOP_WAR_REQUIRE_FUNDING=0 (its
// factions' funding plan is REFUSED:NO_REAL_FACTION_INCOME, so requiring escrow would
// mean no war at all), and yet every campaign was expired about a minute after it opened
// - r17 and the sixteen before it - each with WAR_ESCROW_MISSING. An open/expire loop
// that looks exactly like "the war never starts".
test("where funding is not required an unfunded campaign is the configured shape", () => {
  const make = () => ({ territories: territories(30045344), campaigns: { c: live("c", 30045344, NOW - 60000) } });
  const optional = make();
  const relaxed = expireUnfundedCampaigns(optional, { nowMs: NOW, isFunded: () => false, requireFunding: false });
  assert.deepEqual(relaxed.campaignIDs, []);
  assert.equal(relaxed.skipped, "FUNDING_NOT_REQUIRED");
  assert.equal(optional.campaigns.c.state, "PREPARING", "the front must survive to get its assault");
  const required = make();
  const strict = expireUnfundedCampaigns(required, { nowMs: NOW, isFunded: () => false, requireFunding: true });
  assert.deepEqual(strict.campaignIDs, ["c"], "with funding required a vanished escrow is still a loss");
  assert.equal(required.campaigns.c.state, "EXPIRED");
});
