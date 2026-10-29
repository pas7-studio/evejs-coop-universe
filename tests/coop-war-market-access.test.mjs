// FW-092 guard: a faction only earns from a kill it can sell.
//
// Measured on the work stack 2026-10-29: coop-pilot-007 really claimed a real
// wreck, really carried four recovered cargo units, and then reported
// `loot-station-blocked ... stationCount: 0` because the campaign target
// (Hikkoken, 30045338) has no station at all. `loot-market-settled` therefore
// never fired, every faction chest answered NO_REAL_FACTION_INCOME, and the war
// could not fund its own bounty anywhere.
//
// The rule under test is narrow: with a market authority a station-bearing
// border is planned BEFORE a station-less one, the station-less border is still
// never refused, and without the authority the order is exactly the old one.
import test from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";
const require = createRequire(import.meta.url);
const opening = require("../integration/coopFactionWarOpening.cjs");

// 1001 <-> 1002 <-> 1003 over three REAL reciprocal gate pairs.
const GATE_ROWS = [
  { itemID: 11, solarSystemID: 1001, destinationID: 21, destinationSolarSystemID: 1002 },
  { itemID: 21, solarSystemID: 1002, destinationID: 11, destinationSolarSystemID: 1001 },
  { itemID: 12, solarSystemID: 1001, destinationID: 31, destinationSolarSystemID: 1003 },
  { itemID: 31, solarSystemID: 1003, destinationID: 12, destinationSolarSystemID: 1001 },
];
const getStargatesForSystem = (systemID) =>
  GATE_ROWS.filter((row) => row.solarSystemID === Number(systemID));
const getGate = (gateID) => GATE_ROWS.find((row) => row.itemID === Number(gateID)) || null;

// The attacker (500011) holds 1001 and faces TWO defender systems (500001): 1002
// has NO station, 1003 DOES have one. That is the measured shape - one navy, two
// borders, and only one of them can ever be sold at.
const presence = {
  pilots: [
    { pilotID: "p1", entityID: 1, systemID: 1001, factionID: "500011" },
    { pilotID: "p2", entityID: 2, systemID: 1002, factionID: "500001" },
    { pilotID: "p3", entityID: 3, systemID: 1003, factionID: "500001" },
  ],
};
const territories = { 1001: "500011", 1002: "500001", 1003: "500001" };
const state = { version: 1, wars: {}, campaigns: {},
  territories: Object.fromEntries(Object.entries(territories).map(([id, factionID]) => [id, {
    systemID: Number(id), militaryControllerFactionID: Number(factionID), ownerFactionID: Number(factionID),
  }])) };

const plan = (marketAccess) => opening.planWars({
  state, presence, getStargatesForSystem, getGate,
  nowMs: 1_700_000_000_000, minShips: 1, balanceISK: 1e9,
  maxOpenings: 8, marketAccess: marketAccess || null,
});

test("a station-bearing border is planned before a station-less one", () => {
  const market = (systemID) => Number(systemID) === 1003;
  const planned = plan(market);
  assert.equal(planned.status, "READY");
  const targets = planned.openings.map((row) => row.plan.campaign.targetSystemID);
  assert.deepEqual(targets.slice(0, 1), [1003],
    `expected the revenue-capable border first, got ${JSON.stringify(targets)}`);
  assert.equal(planned.marketAccessible, 1);
  // The opening really carries the measured fact.
  assert.equal(planned.openings[0].marketAccess, true);
  assert.equal(planned.openings[1].marketAccess, false);
});

test("market access is a preference, never a gate", () => {
  // Nothing has a market: both borders are still planned, in their old order.
  const none = plan(() => false);
  assert.equal(none.status, "READY");
  assert.equal(none.openings.length, plan(null).openings.length);
  assert.equal(none.marketAccessible, 0);
  // An authority that throws is unknown, not a refusal.
  const broken = plan(() => { throw new Error("scene unavailable"); });
  assert.equal(broken.status, "READY");
  assert.equal(broken.openings.length, none.openings.length);
});

test("without the authority the planner is byte-for-byte unchanged", () => {
  const base = plan(null);
  const refused = plan(undefined);
  assert.deepEqual(refused.openings.map((row) => row.plan.campaign.targetSystemID),
    base.openings.map((row) => row.plan.campaign.targetSystemID));
  assert.equal(base.marketAccessible, null);
  assert.equal(base.openings[0].marketAccess, null);
});
