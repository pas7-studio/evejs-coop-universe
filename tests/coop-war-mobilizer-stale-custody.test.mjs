// FW-110: a war hull is a physical ship, not a stored row.
//
// MEASURED on the play stack 2026-10-30, one restart after the front reached ASSAULT:
// 6 of the 10 registered hulls pointed at an entity id the pilot no longer owned
// (coop-pilot-003: registry 980000062777, real hull 980000067050) and 4 pilots had no
// identity link at all. Every later muster answered PILOT_IN_USE for those pilots, both
// sides reported assigned 0, and r13..r17 expired without one defender hull ever dying.
// The registry was staffing campaigns with ghosts.
import test from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";
const require = createRequire(import.meta.url);
const { staleCustodyRows } = require("../integration/coopWarMobilizer.cjs");

const ship = (entityID, pilotID, extra = {}) => ({ entityID, pilotID,
  fleetID: "fw-c-500001", campaignID: "war:1-2:campaign:3:r1", systemID: 30003837,
  factionID: 500001, ...extra });

test("custody of a hull the pilot has provably left is stale", () => {
  const rows = staleCustodyRows({
    ships: { "980000062777": ship(980000062777, "coop-pilot-003") },
    links: [{ pilotID: "coop-pilot-003", entityID: 980000067050, systemID: 30003837 }],
  });
  assert.equal(rows.length, 1);
  assert.equal(rows[0].entityID, 980000062777);
  assert.equal(rows[0].currentEntityID, 980000067050,
    "the replacement is named, so a release can never be guessed");
  assert.equal(rows[0].campaignID, "war:1-2:campaign:3:r1");
});

test("a hull the pilot still flies is never released", () => {
  const rows = staleCustodyRows({
    ships: { "980000062777": ship(980000062777, "coop-pilot-003") },
    links: [{ pilotID: "coop-pilot-003", entityID: 980000062777, systemID: 30003837 }],
  });
  assert.deepEqual(rows, []);
});

test("a pilot with no identity link is not guessed at", () => {
  const rows = staleCustodyRows({
    ships: { "980000065920": ship(980000065920, "coop-pilot-019") },
    links: [],
  });
  assert.deepEqual(rows, [], "a missing link is not proof the pilot left");
});

test("a pilot with two live links is ambiguous and stays untouched", () => {
  const rows = staleCustodyRows({
    ships: { "980000065920": ship(980000065920, "coop-pilot-019") },
    links: [
      { pilotID: "coop-pilot-019", entityID: 980000067001, systemID: 30003837 },
      { pilotID: "coop-pilot-019", entityID: 980000067002, systemID: 30003837 },
    ],
  });
  assert.deepEqual(rows, []);
});

test("the sweep is deterministic and bounded by the registry itself", () => {
  const ships = {};
  const links = [];
  for (const n of [3, 8, 9, 2, 18]) {
    ships[String(980000062700 + n)] = ship(980000062700 + n, "coop-pilot-00" + n);
    links.push({ pilotID: "coop-pilot-00" + n, entityID: 980000067000 + n,
      systemID: 30003837 });
  }
  const rows = staleCustodyRows({ ships, links });
  assert.equal(rows.length, 5);
  const ids = rows.map((row) => row.entityID);
  assert.deepEqual(ids, [...ids].sort((a, b) => a - b), "same world, same order");
  assert.deepEqual(staleCustodyRows({ ships, links }).map((r) => r.entityID), ids);
});

test("garbage rows and garbage links never produce a release", () => {
  const rows = staleCustodyRows({
    ships: { a: null, b: { entityID: 0, pilotID: "coop-pilot-001" },
      c: { entityID: 1234, pilotID: "not-a-pilot" } },
    links: [{ pilotID: "coop-pilot-001", entityID: 999 }, null, { pilotID: 5 }],
  });
  assert.deepEqual(rows, []);
  assert.deepEqual(staleCustodyRows(), []);
  assert.deepEqual(staleCustodyRows({ ships: {}, links: "nope" }), []);
});
