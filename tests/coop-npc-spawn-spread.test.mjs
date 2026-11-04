import test from "node:test";
import assert from "node:assert/strict";
import {createRequire} from "node:module";
import path from "node:path";

// Three pirates anchored on the same station used to materialize inside a few hundred metres of each
// other: they looked like one ship standing still. The spread anchor is a real position around the
// real POI - never a made-up place in space - and it is off unless an operator asks for it.
const forkRoot = process.env.EVEJS_FORK_ROOT || "C:/Games/EveCoop/upstream-evejs";
const require = createRequire(import.meta.url);
const {anchorOptionsForRole} = require(path.join(
  forkRoot, "Code/server/src/space/coopNpcTopology.js"));

const STATION = {x: 1e12, y: 2e12, z: 3e12};
const scene = () => ({
  staticEntities: [
    {itemID: 40000001, kind: "asteroidBelt", itemName: "Jita Belt 1", position: STATION},
    {itemID: 60003760, kind: "station", itemName: "Jita IV - Moon 4", position: STATION},
    {itemID: 50000001, kind: "stargate", itemName: "Perimeter Gate",
      position: {x: STATION.x + 5e11, y: STATION.y, z: STATION.z}},
  ],
});

const distance = (a, b) => Math.hypot(a.x - b.x, a.y - b.y, a.z - b.z);

test("without a spread the anchor is the real POI, exactly as before", () => {
  const anchor = anchorOptionsForRole(scene(), "pirate");
  assert.deepEqual(anchor, {
    anchorDescriptor: {kind: "asteroidBelt", itemID: 40000001},
    anchorName: "Jita Belt 1",
  });
});

test("with a spread the hull is placed around the POI, not on top of it", () => {
  const anchor = anchorOptionsForRole(scene(), "pirate", {spreadMeters: 12000});
  assert.equal(anchor.anchorDescriptor.kind, "coordinates");
  assert.equal(anchor.anchorName, "Jita Belt 1", "the leash keeps the real POI name");
  const offset = distance(anchor.anchorDescriptor.position, STATION);
  assert.ok(offset > 4000, `expected a real offset, measured ${Math.round(offset)} m`);
  assert.ok(offset < 13000, `expected to stay near the POI, measured ${Math.round(offset)} m`);
});

test("two hulls spawned together do not land on the same point", () => {
  const first = anchorOptionsForRole(scene(), "pirate", {spreadMeters: 12000});
  const second = anchorOptionsForRole(scene(), "pirate", {spreadMeters: 12000});
  const gap = distance(first.anchorDescriptor.position, second.anchorDescriptor.position);
  assert.ok(gap > 1000, `two spawns must not stack, measured ${Math.round(gap)} m`);
});

test("a pirate is never anchored on a trade-hub station, and beltless Jita gives it nothing", () => {
  const stationOnly = () => ({
    staticEntities: [
      {itemID: 60003760, kind: "station", itemName: "Jita IV - Moon 4", position: STATION},
    ],
  });
  assert.equal(anchorOptionsForRole(stationOnly(), "pirate", {env: {}}), null,
    "no belt, no gate: a pirate does not camp the undock");
  const forced = anchorOptionsForRole(stationOnly(), "pirate",
    {env: {EVEJS_COOP_PIRATE_ALLOW_STATION_ANCHOR: "1"}});
  assert.equal(forced.anchorDescriptor.kind, "station",
    "the old behaviour stays available behind its own switch");

  const withGate = anchorOptionsForRole(scene(), "pirate", {env: {}});
  assert.equal(withGate.anchorDescriptor.kind, "asteroidBelt",
    "a real belt is still preferred");
  const gateOnly = {staticEntities: [
    {itemID: 50000001, kind: "stargate", itemName: "Perimeter Gate", position: STATION},
    {itemID: 60003760, kind: "station", itemName: "Jita IV - Moon 4", position: STATION},
  ]};
  assert.equal(anchorOptionsForRole(gateOnly, "pirate", {env: {}}).anchorDescriptor.kind, "stargate",
    "a gate is a real camp; the station is not");
  assert.equal(anchorOptionsForRole(gateOnly, "patrol", {env: {}}).anchorDescriptor.kind, "stargate",
    "patrols keep their own preference order and take a gate when there is no belt");
});
