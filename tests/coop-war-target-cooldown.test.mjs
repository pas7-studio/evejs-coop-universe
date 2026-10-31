// FW-064 guard: a border that keeps expiring must back off, not loop.
//
// Measured overnight on the work stack: 30045343 reopened and expired four times
// (:r2, :r3, :r4), each cycle reserving real escrow and refunding it 45 minutes later,
// because the defender never fielded a hull there. A border still backs off while it
// keeps failing, but FW-127/FW-128 bounded how far: the backoff counts only recent
// expiries and stops at 2 x the base window, because a border that sat closed for hours
// on two days of accumulated history is what answered NO_OPENABLE_FRONT with 5 of 8
// borders shut (measured 2026-10-31T13:59:14Z and 14:14:45Z).
import test from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";
const require = createRequire(import.meta.url);
const { targetCooldownMs } = require("../integration/coopFactionWarOpening.cjs");

const BASE = 15 * 60 * 1000;
const MAX_BASE = 15 * 60 * 1000;
const NOW = 1793464300000;
const campaign = (id, target, state, expiredAt = 0) => ({ campaignID: id, warID: "war:1-2",
  sourceSystemID: 1, targetSystemID: target, state, objectiveEvidence: [],
  revision: 1, expiredAt });

test("a target that never failed waits only the base window", () => {
  assert.equal(targetCooldownMs({ state: { campaigns: {} }, targetSystemID: 30045343,
    baseMs: BASE, nowMs: NOW }), BASE);
});

test("the base window itself is capped, so a stale stall setting cannot close a border", () => {
  assert.equal(targetCooldownMs({ state: { campaigns: {} }, targetSystemID: 30045343,
    baseMs: 45 * 60 * 1000, nowMs: NOW }), MAX_BASE);
});

test("one recent failure keeps the base wait, a second doubles it, and that is the cap", () => {
  const state = (count) => ({ campaigns: Object.fromEntries(Array.from({ length: count },
    (_unused, index) => [`c${index}`, campaign(`c${index}`, 30045343, "EXPIRED",
      NOW - 60000 - index * 1000)])) });
  assert.equal(targetCooldownMs({ state: state(1), targetSystemID: 30045343,
    baseMs: BASE, nowMs: NOW }), BASE);
  assert.equal(targetCooldownMs({ state: state(2), targetSystemID: 30045343,
    baseMs: BASE, nowMs: NOW }), BASE * 2);
  assert.equal(targetCooldownMs({ state: state(9), targetSystemID: 30045343,
    baseMs: BASE, nowMs: NOW }), BASE * 2,
    "a dead border may wait 30 minutes, never a day");
});

test("expiries outside the backoff horizon are history, not pacing", () => {
  const state = { campaigns: { a: campaign("a", 30045343, "EXPIRED", NOW - 30 * BASE),
    b: campaign("b", 30045343, "EXPIRED", NOW - 20 * BASE) } };
  assert.equal(targetCooldownMs({ state, targetSystemID: 30045343, baseMs: BASE,
    nowMs: NOW }), BASE);
});

test("a live or captured campaign is not a failure and resets the wait", () => {
  const state = { campaigns: {
    a: campaign("a", 30045343, "ASSAULT"),
    b: campaign("b", 30045343, "OCCUPIED"),
    c: campaign("c", 30045343, "PREPARING"),
  } };
  assert.equal(targetCooldownMs({ state, targetSystemID: 30045343, baseMs: BASE,
    nowMs: NOW }), BASE);
});

test("another system's failures never slow this border down", () => {
  const state = { campaigns: {
    a: campaign("a", 111, "EXPIRED", NOW - 1000),
    b: campaign("b", 111, "EXPIRED", NOW - 2000),
  } };
  assert.equal(targetCooldownMs({ state, targetSystemID: 222, baseMs: BASE,
    nowMs: NOW }), BASE);
});

test("a missing or invalid target still answers the base window, never zero", () => {
  assert.equal(targetCooldownMs({ state: null, targetSystemID: 30045343, baseMs: BASE }), BASE);
  assert.equal(targetCooldownMs({ state: { campaigns: {} }, targetSystemID: 0, baseMs: BASE }), BASE);
  assert.equal(targetCooldownMs({ state: { campaigns: {} }, targetSystemID: 30045343, baseMs: 0 }), 1);
});

// FW-099: WAR_ESCROW_MISSING is a treasury defect, not a fact about the border.
//
// Measured on the owner's play stack 2026-10-30: ten campaigns of 30003837 and five of
// 30045344 expired with that reason while FW-050 was live. The backoff they left behind
// kept the only armed border of a funded war (decision BOTH_SIDES_CAN_FIELD_NAVY) shut
// for hours after the treasury was fixed, so the world reported "no front" all day.
const lostEscrow = (id, target, expiredAt) => ({ ...campaign(id, target, "EXPIRED", expiredAt),
  expiredReason: "WAR_ESCROW_MISSING" });
const noProof = (id, target, expiredAt) => ({ ...campaign(id, target, "EXPIRED", expiredAt),
  expiredReason: "NO_ASSAULT_DEPLOYMENT_PROOF" });

test("a border released for lost escrow does not inherit any backoff", () => {
  const state = { campaigns: Object.fromEntries(Array.from({ length: 10 },
    (_unused, index) => [`c${index}`, lostEscrow(`c${index}`, 30003837, NOW - 1000 - index)])) };
  assert.equal(targetCooldownMs({ state, targetSystemID: 30003837, baseMs: BASE, nowMs: NOW }),
    BASE, "10 lost-escrow releases pace nothing");
});

test("an expired assault proof still grows the cooldown, and mixed history counts only it", () => {
  const only = { campaigns: { a: noProof("a", 30045344, NOW - 1000),
    b: noProof("b", 30045344, NOW - 2000) } };
  assert.equal(targetCooldownMs({ state: only, targetSystemID: 30045344, baseMs: BASE,
    nowMs: NOW }), BASE * 2);
  const mixed = { campaigns: { a: lostEscrow("a", 30045344, NOW - 1000),
    b: noProof("b", 30045344, NOW - 2000), c: lostEscrow("c", 30045344, NOW - 3000),
    d: noProof("d", 30045344, NOW - 4000) } };
  assert.equal(targetCooldownMs({ state: mixed, targetSystemID: 30045344, baseMs: BASE,
    nowMs: NOW }), BASE * 2,
    "two real assault-proof failures, two ignored escrow releases");
});

test("an unknown reason is still a failure, never an excuse", () => {
  const state = { campaigns: { a: campaign("a", 30045344, "EXPIRED", NOW - 1000),
    b: { ...campaign("b", 30045344, "EXPIRED", NOW - 2000), expiredReason: "SOMETHING_NEW" } } };
  assert.equal(targetCooldownMs({ state, targetSystemID: 30045344, baseMs: BASE, nowMs: NOW }),
    BASE * 2);
});

// FW-100: the in-memory pacing map must obey the same rule as the durable record.
//
// Measured on the play stack 2026-10-30 21:08Z: campaign r17 of 30003837 opened and was
// released one minute later with WAR_ESCROW_MISSING, and the map - which kept only a
// timestamp - paced the border for the full grown window although FW-099 had just made
// that reason count as zero. The map now carries the reason with the time.
const { expireUnfundedCampaigns, expireStalledCampaigns, coolingDown } =
  require("../integration/coopFactionWarOpening.cjs");

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
  assert.equal(targetCooldownMs({ state, targetSystemID: 30003837, baseMs: BASE, nowMs: NOW }),
    BASE, "the three prior failures are outside the horizon and the release is not one");
  assert.equal(coolingDown(30003837, NOW + BASE - 1000, BASE, state), true,
    "it still may not reopen on the very next tick");
  assert.equal(coolingDown(30003837, NOW + BASE + 1000, BASE, state), false,
    "after the base window the stale release stops pacing the border");
});

test("a real assault-proof failure still paces for the grown window", () => {
  const state = { territories: territories(30045344), campaigns: {
    p1: noProof("p1", 30045344, NOW - 10 * BASE),
    p2: noProof("p2", 30045344, NOW - 9 * BASE),
    p3: noProof("p3", 30045344, NOW - 2 * BASE),
    c: live("c", 30045344, NOW - 3 * BASE),
  } };
  const { campaignIDs } = expireStalledCampaigns(state, { nowMs: NOW, ttlMs: BASE });
  assert.deepEqual(campaignIDs, ["c"]);
  assert.equal(state.campaigns.c.expiredReason, "NO_ASSAULT_DEPLOYMENT_PROOF");
  assert.equal(coolingDown(30045344, NOW + BASE + 1000, BASE, state), true,
    "two recent real failures hold the border past the base window");
  assert.equal(coolingDown(30045344, NOW + 2 * BASE + 1000, BASE, state), false);
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
