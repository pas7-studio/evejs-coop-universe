// FW-033 guard: a front must refill itself, but only through the sanctioned
// spawn path (real doctrine row + real native ship + a real free pilot identity).
// Never an invented hull, never an unearned kill, never a silent failure.
import test from "node:test";
import assert from "node:assert/strict";
import { createWarGarrison, enabled } from "../integration/coopWarGarrison.cjs";

const ON = {
  EVEJS_COOP_FACTION_WAR: "1",
  EVEJS_COOP_FACTION_WAR_FLEETS: "1",
  EVEJS_COOP_WAR_GARRISON: "1",
};

const STATE = {
  version: 1,
  wars: {
    "war:a-b": { warID: "war:a-b", state: "ACTIVE", attackerFactionID: 500004, defenderFactionID: 500001 },
  },
  campaigns: {
    c1: { campaignID: "c1", warID: "war:a-b", state: "ASSAULT", targetSystemID: 30045344 },
  },
};

function fixture({ ships = [], free = ["coop-pilot-001", "coop-pilot-002"], spawnOk = true } = {}) {
  const calls = [];
  const garrison = createWarGarrison({
    readWarState: () => STATE,
    registry: { snapshot: () => ({ ships: Object.fromEntries(ships.map(s => [String(s.entityID), s])) }) },
    listFreePilots: () => free,
    spawnFleet: (input) => {
      calls.push(input);
      return spawnOk
        ? { ok: true, fleetID: "coop-fleet-x", ships: [{ entityID: 900 + calls.length }] }
        : { ok: false, error: "DOCTRINE_REFUSED" };
    },
    env: ON,
    clock: () => 1000,
  });
  return { garrison, calls };
}

test("refills a side that lost its whole garrison, one real hull per tick", () => {
  const f = fixture({ ships: [{ entityID: 1, systemID: 30045344, factionID: 500001 }] });
  const out = f.garrison.tick();
  assert.equal(out.status, "GARRISON_APPLIED");
  assert.equal(f.calls.length, 1);
  // The defender already holds one hull, so the first refill is the attacker side.
  assert.equal(f.calls[0].factionID, 500004);
  assert.equal(f.calls[0].systemID, 30045344);
  assert.equal(f.calls[0].commanderPilotID, "coop-pilot-001");
  assert.equal(out.applied[0].status, "NATIVE_GARRISON_SPAWNED");
  assert.deepEqual(out.applied[0].ships, [901]);
});

test("a full garrison is left alone", () => {
  const f = fixture({
    ships: [
      { entityID: 1, systemID: 30045344, factionID: 500001 },
      { entityID: 2, systemID: 30045344, factionID: 500001 },
      { entityID: 3, systemID: 30045344, factionID: 500004 },
      { entityID: 4, systemID: 30045344, factionID: 500004 },
    ],
  });
  const out = f.garrison.tick();
  assert.equal(out.status, "NO_CHANGE");
  assert.equal(f.calls.length, 0);
});

test("hulls in another system do not count towards the garrison", () => {
  const f = fixture({
    ships: [
      { entityID: 1, systemID: 30003837, factionID: 500001 },
      { entityID: 2, systemID: 30003837, factionID: 500001 },
      { entityID: 3, systemID: 30003837, factionID: 500004 },
      { entityID: 4, systemID: 30003837, factionID: 500004 },
    ],
  });
  const out = f.garrison.tick();
  assert.equal(f.calls.length, 1);
  assert.equal(out.applied[0].missing, 2);
});

test("no free pilot identity is reported, never a guessed commander", () => {
  const f = fixture({ free: [] });
  const out = f.garrison.tick();
  assert.equal(f.calls.length, 0);
  assert.equal(out.skips[0].reason, "NO_FREE_PILOT_IDENTITY");
});

test("a refused native spawn is reported with its own reason", () => {
  const f = fixture({ spawnOk: false });
  const out = f.garrison.tick();
  assert.equal(out.applied[0].status, "DOCTRINE_REFUSED");
});

test("a registry row whose hull is not in the scene does not count as present", () => {
  const calls = [];
  const garrison = createWarGarrison({
    readWarState: () => STATE,
    registry: {
      snapshot: () => ({
        ships: {
          1: { entityID: 1, systemID: 30045344, factionID: 500001 },
          2: { entityID: 2, systemID: 30045344, factionID: 500001 },
          3: { entityID: 3, systemID: 30045344, factionID: 500004 },
          4: { entityID: 4, systemID: 30045344, factionID: 500004 },
        },
      }),
    },
    // Only the Gallente pair is really on the field; the Caldari rows are ghosts.
    isHullLive: (systemID, entityID) => entityID >= 3,
    listFreePilots: () => ["coop-pilot-001"],
    spawnFleet: (input) => { calls.push(input); return { ok: true, ships: [{ entityID: 901 }] }; },
    env: ON,
    clock: () => 1000,
  });
  const out = garrison.tick();
  assert.equal(calls.length, 1);
  assert.equal(calls[0].factionID, 500001);
  assert.equal(out.applied[0].missing, 2);
});

test("cooldown stops a spawn loop when the native spawn cannot keep up", () => {
  const calls = [];
  let now = 1000;
  const garrison = createWarGarrison({
    readWarState: () => STATE,
    registry: { snapshot: () => ({ ships: {} }) },
    listFreePilots: () => ["coop-pilot-001", "coop-pilot-002", "coop-pilot-003"],
    spawnFleet: (input) => { calls.push(input); return { ok: true, ships: [] }; },
    env: ON,
    clock: () => now,
  });
  garrison.tick();
  assert.equal(calls.length, 1);
  assert.equal(calls[0].factionID, 500004);
  now = 30000;
  // The next tick may refill the OTHER side, but never the same side again
  // inside its cooldown.
  garrison.tick();
  assert.equal(calls.length, 2);
  assert.equal(calls[1].factionID, 500001);
  now = 60000;
  garrison.tick();
  assert.equal(calls.length, 2);
  now = 200000;
  garrison.tick();
  assert.equal(calls.length, 3);
  assert.equal(calls[2].factionID, 500004);
});

test("flag OFF is inert and authorities are required", () => {
  const off = createWarGarrison({
    readWarState: () => STATE,
    registry: { snapshot: () => ({ ships: {} }) },
    listFreePilots: () => [],
    spawnFleet: () => ({ ok: true }),
    env: {},
    clock: () => 1000,
  });
  assert.equal(off.tick().status, "DISABLED");
  assert.equal(enabled(ON), true);
  assert.equal(enabled({}), false);
  assert.throws(() => createWarGarrison({}), /WAR_GARRISON_AUTHORITIES_REQUIRED/);
});
