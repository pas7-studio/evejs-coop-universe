import test from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";
const require = createRequire(import.meta.url);
const refinery = require("../integration/coopNpcRefineryTick.cjs");

// Measured 2026-10-28: 454 124 units of tagged warehouse ore sat in 60000682 while the
// refinery only worked at the fleet's own station, which held 1 535 units. The refinery
// therefore produced almost no Pyerite from the ore the corporation really owned, and the
// ammunition chain (4 578 Tritanium + 5 800 Pyerite per run) stalled on a material that
// was in fact on the shelf, unrefined. Both stations are PROVEN - the fleet's dock and the
// newest warehouse trip manifest - so both are called the right answer, not a guess.
const FLEET_STATION = 60014935;
const ORE_STATION = 60000682;
const TAG = "coop-warehouse:v1:cargo:1";

function fakeItems(stock) {
  return {
    ITEM_FLAGS: { HANGAR: 4 },
    listOwnedItems: (ownerID, options) => {
      const rows = stock[Number(options && options.locationID)] || [];
      return rows.map((row) => ({ flagID: 4, customInfo: TAG, ownerID, locationID: Number(options.locationID), ...row }));
    },
  };
}

function runWith({ stationID, stock, manifestStation }) {
  const refined = [];
  const outcome = refinery.run({
    env: { EVEJS_COOP_NPC_REFINERY: "1", EVEJS_COOP_FACTORY_CORP_ID: "1000129" },
    stationID,
    items: fakeItems(stock),
    manifestStation,
    treasury: { run: () => ({ status: "IDLE", moved: 0 }) },
    refinery: {
      refine: ({ oreItemID, stationID: at }) => {
        refined.push({ oreItemID, stationID: at });
        return { status: "COMMITTED", outputs: [{ typeID: 35, quantity: 1 }] };
      },
    },
    observe: () => true,
    probe: {},
    now: 1793219000000,
  });
  return { outcome, refined };
}

test("ore at the station the manifests prove is refined, not just the fleet's dock", () => {
  const { outcome, refined } = runWith({
    stationID: FLEET_STATION,
    stock: {
      [FLEET_STATION]: [],
      [ORE_STATION]: [{ itemID: 9988400005223, typeID: 17464, quantity: 191300 }],
    },
    manifestStation: () => ({ stationID: ORE_STATION, manifest: "30000145-1-x.json" }),
  });
  assert.deepEqual(refined.map((r) => r.stationID), [ORE_STATION],
    "the refinery flies to the station that really holds the tagged ore");
  assert.equal(outcome.refined, 1);
});

test("the fleet's own station is still served first", () => {
  const { refined } = runWith({
    stationID: FLEET_STATION,
    stock: {
      [FLEET_STATION]: [{ itemID: 9988400000001, typeID: 1228, quantity: 5000 }],
      [ORE_STATION]: [{ itemID: 9988400005223, typeID: 17464, quantity: 191300 }],
    },
    manifestStation: () => ({ stationID: ORE_STATION, manifest: "30000145-1-x.json" }),
  });
  assert.deepEqual(refined.map((r) => r.stationID), [FLEET_STATION],
    "a station that has ore is never skipped for a fallback");
});

test("an empty refinery reports both stations it tried", () => {
  const { outcome, refined } = runWith({
    stationID: FLEET_STATION,
    stock: { [FLEET_STATION]: [], [ORE_STATION]: [] },
    manifestStation: () => ({ stationID: ORE_STATION, manifest: "30000145-1-x.json" }),
  });
  assert.equal(refined.length, 0);
  assert.deepEqual(outcome.triedStations, [FLEET_STATION, ORE_STATION]);
});
