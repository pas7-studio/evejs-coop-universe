import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import {createRequire} from "node:module";
import path from "node:path";

// The client draws faction-warfare occupation states only for the systems of its own
// frontlines map (res:/staticdata/warZonesPositionData.fsdbinary). It picks the newest
// dateTaken among the states we publish and indexes that map with it
// (warZoneMap.py load_fw_maps -> systems[focus_system_id]), so one state outside the
// map kills the whole panel:
//   2026-11-04 12:42:44 KeyError: 30002803 (Juunigaishi)
//   2026-11-03 22:38:41 KeyError: 30000132 (Ansila)
// The fork therefore publishes only the ids below.
const forkRoot = process.env.EVEJS_FORK_ROOT || "C:/Games/EveCoop/upstream-evejs";
const require = createRequire(import.meta.url);
const modulePath = path.join(forkRoot, "Code/server/src/space/coopFwFrontlineMapSystems.js");
const {
  FRONTLINE_MAP_SYSTEM_IDS,
  isFrontlineMapSystem,
  filterFrontlineMapSystems,
} = require(modulePath);

const CLIENT_RESFILE =
  "W:/EVE Online - 3396210/ResFiles/9b/9bb1f9a5fd7397d9_76076130da97b1175b77f8d6e5c8ec0a";

function extractFromClientFile(file) {
  const buffer = fs.readFileSync(file);
  const ids = new Set();
  for (let offset = 4; offset + 4 <= buffer.length; offset += 4) {
    const value = buffer.readInt32LE(offset);
    if (value >= 30_000_000 && value <= 30_999_999) ids.add(value);
  }
  return [...ids].sort((left, right) => left - right);
}

test("the allowlist is a unique, sorted array of real solar system ids", () => {
  assert.ok(FRONTLINE_MAP_SYSTEM_IDS.length > 200, "both warzones must be covered");
  const sorted = [...FRONTLINE_MAP_SYSTEM_IDS].sort((left, right) => left - right);
  assert.deepEqual([...FRONTLINE_MAP_SYSTEM_IDS], sorted);
  assert.equal(new Set(FRONTLINE_MAP_SYSTEM_IDS).size, FRONTLINE_MAP_SYSTEM_IDS.length);
  for (const id of FRONTLINE_MAP_SYSTEM_IDS) {
    assert.ok(Number.isSafeInteger(id) && id > 30_000_000 && id < 31_000_000, String(id));
  }
});

test("the two systems that broke the map live are excluded, known warzone systems stay", () => {
  assert.equal(isFrontlineMapSystem(30002803), false, "Juunigaishi (0.62) is not on the map");
  assert.equal(isFrontlineMapSystem(30000132), false, "Ansila (0.91) is not on the map");
  assert.equal(isFrontlineMapSystem(30045324), true, "Onnamon (Caldari HQ) is on the map");
  assert.equal(isFrontlineMapSystem(30003788), true, "Intaki (Gallente HQ) is on the map");
  assert.equal(isFrontlineMapSystem(0), false);
  assert.equal(isFrontlineMapSystem("nope"), false);
});

test("filtering keeps objects and pairs of exactly the map systems", () => {
  const rows = [
    {solarSystemID: 30045324, factionID: 500001},
    {solarSystemID: 30002803, factionID: 500001},
    [30003788, 500004],
    [30000132, 500001],
  ];
  const kept = filterFrontlineMapSystems(rows);
  assert.deepEqual(kept.map((row) => (Array.isArray(row) ? row[0] : row.solarSystemID)),
    [30045324, 30003788]);
});

test("the allowlist matches the client resfile it was extracted from", (t) => {
  if (!fs.existsSync(CLIENT_RESFILE)) {
    t.skip("client resfile not present on this machine");
    return;
  }
  const fromClient = extractFromClientFile(CLIENT_RESFILE);
  assert.deepEqual([...FRONTLINE_MAP_SYSTEM_IDS], fromClient,
    "regenerate with node scripts/coop-fw-frontline-ids.mjs when the client build changes");
});
