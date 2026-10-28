// FW-035 guard: a system may only flip military controller when the defending
// side is really gone - a verified defender wreck in this campaign and system,
// zero live defender hulls, sustained for 60 s - and the core must still refuse
// a stale revision.
import test from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";
const require = createRequire(import.meta.url);
const { createWarCaptureByForce } = require("../integration/coopWarCaptureByForce.cjs");
const warStore = require("../integration/coopFactionWarStore.cjs");
const fleetStore = require("../integration/coopWarFleetRegistry.cjs");
const casualtyLedger = require("../integration/coopWarCasualtyLedger.cjs");

const ON = {
  EVEJS_COOP_FACTION_WAR: "1",
  EVEJS_COOP_FACTION_WAR_FLEETS: "1",
  EVEJS_COOP_WAR_CAPTURE_BY_FORCE: "1",
  EVEJS_COOP_NATIVE_ATOMIC_ROWS: "1",
};

function baseWar() {
  return {
    version: 1,
    wars: { "war:a-b": { warID: "war:a-b", state: "ACTIVE", attackerFactionID: 500004, defenderFactionID: 500001 } },
    territories: {
      30045344: { systemID: 30045344, originalOwnerFactionID: 500001, militaryControllerFactionID: 500001, state: "CONTESTED", revision: 2, changedAt: 1 },
    },
    campaigns: {
      c1: {
        campaignID: "c1", warID: "war:a-b", attackerFactionID: 500004, defenderFactionID: 500001,
        sourceSystemID: 30003837, targetSystemID: 30045344, supplyReservationID: "paper:x",
        state: "ASSAULT", startedAt: 1, objectiveEvidence: [], revision: 1,
      },
    },
    enlistments: {},
    processed: {},
    history: [],
  };
}

function store({ war = baseWar(), ships = {}, wrecks = {} } = {}) {
  const rows = new Map();
  rows.set(warStore.KEY, war);
  rows.set(fleetStore.KEY, { version: 1, ships, processed: {}, history: [] });
  rows.set(casualtyLedger.KEY, { version: 1, byWreck: wrecks, count: Object.keys(wrecks).length });
  const written = [];
  return {
    written,
    coopAtomicNativeRows: {
      transact: (tables, fn) => fn({
        get: (table, key) => rows.get(key) || null,
        put: (table, key, value) => { rows.set(key, value); written.push(key); },
      }),
    },
    war: () => rows.get(warStore.KEY),
  };
}

const DEFENDER_WRECK = {
  900: {
    kind: "WARSHIP_DESTROYED", warID: "war:a-b", campaignID: "c1", systemID: 30045344,
    entityID: 501, wreckID: 900, pilotID: "coop-pilot-001", corporationID: 1000035,
    victimFactionID: 500001, observedAt: 10, nativeStoredItemCount: 2,
    attribution: "NATIVE_VICTIM_WRECK_ONLY_NO_KILLER",
  },
};

test("no defender wreck means no objective and no capture", () => {
  const s = store({ wrecks: {} });
  const view = createWarCaptureByForce({ gameStore: s, env: ON, clock: () => 100000 });
  const out = view.tick();
  assert.equal(out.captured.length, 0);
  assert.equal(out.skips[0].reason, "NO_DEFENDER_WRECK");
});

test("a live defender hull blocks the capture even with a wreck", () => {
  const s = store({
    wrecks: DEFENDER_WRECK,
    ships: { 501: { entityID: 501, systemID: 30045344, factionID: 500001, pilotID: "coop-pilot-001", corporationID: 1000035, fleetID: "f", warID: "war:a-b", campaignID: "c1" } },
  });
  const view = createWarCaptureByForce({ gameStore: s, env: ON, clock: () => 100000 });
  const out = view.tick();
  assert.equal(out.captured.length, 0);
  assert.equal(out.skips[0].reason, "DEFENDER_STILL_PRESENT");
});

test("wreck + empty defender side records the objective, then captures after the sustain", () => {
  const s = store({ wrecks: DEFENDER_WRECK, ships: {} });
  let now = 100000;
  const view = createWarCaptureByForce({ gameStore: s, env: ON, clock: () => now });
  const first = view.tick();
  assert.equal(first.skips[0].reason, "CAPTURE_SUSTAIN_STARTED");
  now += 30000;
  const pending = view.tick();
  assert.equal(pending.skips[0].reason, "CAPTURE_SUSTAIN_PENDING");
  now += 40000;
  const recorded = view.tick();
  assert.equal(recorded.captured[0].kind, "OBJECTIVE_RECORDED");
  assert.equal(recorded.captured[0].objectiveID, "warship:900");
  const captured = view.tick();
  assert.equal(captured.captured[0].kind, "CAPTURED");
  assert.equal(captured.captured[0].systemID, 30045344);
  assert.equal(captured.captured[0].receipt.militaryControllerFactionID, 500004);
  const war = s.war();
  assert.equal(war.territories["30045344"].militaryControllerFactionID, 500004);
  assert.equal(war.territories["30045344"].state, "OCCUPIED");
  assert.equal(war.territories["30045344"].revision, 3);
  assert.equal(war.campaigns.c1.state, "OCCUPIED");
});

test("a defender wreck from another campaign or system is ignored", () => {
  const wrongSystem = { ...DEFENDER_WRECK[900], systemID: 30003837 };
  const s = store({ wrecks: { 900: wrongSystem }, ships: {} });
  const view = createWarCaptureByForce({ gameStore: s, env: ON, clock: () => 100000 });
  assert.equal(view.tick().skips[0].reason, "NO_DEFENDER_WRECK");
});

test("flag OFF is inert and authorities are required", () => {
  const s = store({ wrecks: DEFENDER_WRECK, ships: {} });
  const off = createWarCaptureByForce({ gameStore: s, env: {}, clock: () => 100000 });
  assert.equal(off.tick().status, "DISABLED");
  assert.throws(() => createWarCaptureByForce({}), /WAR_CAPTURE_BY_FORCE_AUTHORITIES_REQUIRED/);
});

// FW-032 x FW-035 guard: a registry row is custody, not a ship.
// Measured on the work stack 2026-10-28: campaign:30045344 held two real
// defender wrecks and answered DEFENDER_STILL_PRESENT for three registry rows
// whose hulls were in no scene at all, so a physically empty system could never
// be captured. With a liveness authority the same rows are recognised as ghosts.
const GHOSTS = () => ({
  wrecks: DEFENDER_WRECK,
  ships: {
    501: { entityID: 501, systemID: 30045344, factionID: 500001, pilotID: "coop-pilot-001", corporationID: 1000035, fleetID: "f", warID: "war:a-b", campaignID: "c1" },
    502: { entityID: 502, systemID: 30045344, factionID: 500001, pilotID: "coop-pilot-002", corporationID: 1000035, fleetID: "f", warID: "war:a-b", campaignID: "c1" },
  },
});

test("a ghost custody row does not block the capture when liveness is known", () => {
  let now = 100000;
  const s = store(GHOSTS());
  const view = createWarCaptureByForce({
    gameStore: s, env: ON, clock: () => now,
    isHullLive: () => false,
  });
  const first = view.tick();
  assert.equal(first.captured.length, 0);
  assert.equal(first.skips[0].reason, "CAPTURE_SUSTAIN_STARTED");
  now += 61000;
  const second = view.tick();
  assert.equal(second.captured[0].kind, "OBJECTIVE_RECORDED");
  now += 1000;
  const third = view.tick();
  assert.equal(third.status, "CAPTURE_APPLIED", JSON.stringify(third.skips));
  assert.equal(third.captured[0].kind, "CAPTURED");
});

test("a hull that is really in the scene still blocks, and names the ghosts", () => {
  const s = store(GHOSTS());
  const view = createWarCaptureByForce({
    gameStore: s, env: ON, clock: () => 100000,
    isHullLive: (systemID, entityID) => entityID === 502,
  });
  const out = view.tick();
  assert.equal(out.captured.length, 0);
  assert.equal(out.skips[0].reason, "DEFENDER_STILL_PRESENT");
  assert.equal(out.skips[0].liveDefenders, 1);
  assert.equal(out.skips[0].ghostDefenders, 1);
});

test("without a liveness authority the old row-counting behaviour is unchanged", () => {
  const s = store(GHOSTS());
  const view = createWarCaptureByForce({ gameStore: s, env: ON, clock: () => 100000 });
  const out = view.tick();
  assert.equal(out.skips[0].reason, "DEFENDER_STILL_PRESENT");
  assert.equal(out.skips[0].liveDefenders, 2);
});
