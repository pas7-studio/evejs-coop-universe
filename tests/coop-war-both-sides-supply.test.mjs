// FW-068 guard: a war in which only one side can pay is a trap, and must be refused.
//
// Measured overnight: 500020's militia corporation (1000135) holds 0 ISK with no income,
// so four campaigns opened and expired on 30045343 while half of every war was
// unpayable - a defender could fight, win, and collect nothing. With the both-sides
// requirement the border is refused instead, and the refusal names the side that could
// not fund it, so the operator sees a reason rather than a silent half-war.
import test from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";
const require = createRequire(import.meta.url);
const { bothSidesRequired, planWars, applyOpenings } = require("../integration/coopFactionWarOpening.cjs");

const CAMPAIGN = "war:500001-500011:campaign:30003837";
const WAR = "war:500001-500011";

test("the requirement is opt-in and reads exactly 1", () => {
  assert.equal(bothSidesRequired({}), false);
  assert.equal(bothSidesRequired({ EVEJS_COOP_WAR_BOUNTY_BOTH_SIDES: "0" }), false);
  assert.equal(bothSidesRequired({ EVEJS_COOP_WAR_BOUNTY_BOTH_SIDES: "true" }), false);
  assert.equal(bothSidesRequired({ EVEJS_COOP_WAR_BOUNTY_BOTH_SIDES: "1" }), true);
});

function state() {
  return {
    version: 1,
    wars: {},
    campaigns: {},
    territories: {
      "30003836": { systemID: 30003836, originalOwnerFactionID: 500011,
        militaryControllerFactionID: 500011, state: "SECURE", revision: 1, changedAt: 1 },
      "30003837": { systemID: 30003837, originalOwnerFactionID: 500001,
        militaryControllerFactionID: 500001, state: "SECURE", revision: 1, changedAt: 1 },
    },
    enlistments: {}, processed: {}, history: [],
  };
}

// The shape applyOpenings really consumes: openings[i] = { plan: { war, campaign }, proofs }.
const plan = () => ({
  plan: {
    campaign: { campaignID: CAMPAIGN, warID: WAR, sourceSystemID: 30003836, targetSystemID: 30003837 },
    war: { warID: WAR, attackerFactionID: 500011, defenderFactionID: 500001 },
  },
  proofs: { declaration: () => true, territory: () => true,
    adjacency: () => true, supply: () => true },
});

test("one funded side is enough only when the strict requirement is off", () => {
  const oneSided = { status: "RESERVED", reservationID: "r1", factionID: 500001,
    sides: [{ factionID: 500001, reservationID: "r1" }] };
  const permissive = applyOpenings({ state: state(), plan: { status: "READY", openings: [plan()] },
    nowMs: 1793220000000, reserveBounty: () => oneSided,
    persistState: () => {}, env: { EVEJS_COOP_WAR_BOUNTY_BOTH_SIDES: "0" } });
  assert.equal(permissive.status, "OPENED");
});

test("with the requirement on, a half-funded border is refused by name", () => {
  const oneSided = { status: "RESERVED", reservationID: "r1", factionID: 500001,
    sides: [{ factionID: 500001, reservationID: "r1" }] };
  const strict = applyOpenings({ state: state(), plan: { status: "READY", openings: [plan()] },
    nowMs: 1793220000000, reserveBounty: () => oneSided,
    persistState: () => {}, env: { EVEJS_COOP_WAR_BOUNTY_BOTH_SIDES: "1" } });
  const skip = (strict.skipped || []).find((row) => String(row.reason).startsWith("SUPPLY_UNFUNDED_SIDE"));
  assert.ok(skip, JSON.stringify(strict).slice(0, 400));
  assert.match(skip.reason, /500011/, "the answer names the side that could not fund it");
});

test("both sides funded opens under the requirement", () => {
  const both = { status: "RESERVED", reservationID: "r1", factionID: 500001,
    sides: [{ factionID: 500001, reservationID: "r1" }, { factionID: 500011, reservationID: "r2" }] };
  const strict = applyOpenings({ state: state(), plan: { status: "READY", openings: [plan()] },
    nowMs: 1793220000000, reserveBounty: () => both,
    persistState: () => {}, env: { EVEJS_COOP_WAR_BOUNTY_BOTH_SIDES: "1" } });
  assert.equal(strict.status, "OPENED");
  assert.equal((strict.skipped || []).length, 0);
});
