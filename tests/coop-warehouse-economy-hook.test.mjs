import test from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

// The live proof that the shadow sees a delivery was one real receipt in six hours, because the
// native mining loop runs in real time and there is no time-scale knob for it. The hook itself
// (two lines inside coopNativeWarehouse after COMMITTED) had no fast test at all: everything
// that exercised noteWarehouse called it directly, so a broken hook would have looked healthy.
// This drives the real deposit() path with injected ports and a fixed clock: milliseconds, and
// it covers the OFF case too - a flag that leaks writes is the worst failure mode here.
const require = createRequire(import.meta.url);
if (!process.env.EVEJS_FORK_ROOT) process.env.EVEJS_FORK_ROOT = "C:/Games/EveCoop/upstream-evejs";
const space = path.join((process.env.EVEJS_FORK_ROOT || "C:/Games/EveCoop/upstream-evejs").trim(), "Code/server/src/space");
const Warehouse = require(path.join(space, "coopNativeWarehouse.js"));
const V2_PATH = path.join(space, "coopEconomyV2.js");

const CLOCK = 1793552053418;
const SYSTEM = 30000144;
const STATION = 60000358;
const CORP = 1000129;

function harness({ cargoID, haulerID }) {
  const cargo = {
    entityID: haulerID, typeID: 17470, quantity: 1234, ownerID: CORP,
    coopHaulFleetID: 960004610, coopHaulFromMinerID: 980000111111,
    coopHaulSystemID: SYSTEM,
  };
  const cargos = new Map([[cargoID, cargo]]);
  const stationItems = new Map();
  let nextItemID = 700000000001;

  const store = {
    listNativeCargoForEntity: (id) => (Number(id) === haulerID ? (cargos.has(cargoID) ? [{ ...cargo, cargoID }] : []) : []),
    listNativeCargo: () => (cargos.has(cargoID) ? [{ ...cargo, cargoID }] : []),
    removeNativeCargo: (id) => {
      if (!cargos.has(id)) return { success: false };
      cargos.delete(id);
      return { success: true };
    },
  };
  const items = {
    ITEM_FLAGS: { HANGAR: 4 },
    findWarehouseItem: ({ cargoID: id }) => stationItems.get(id) || null,
    grantUniqueNpcDepotItem: ({ ownerID, stationID, typeID, quantity, cargoID: id }) => {
      const item = {
        itemID: nextItemID++, typeID, quantity, ownerID, locationID: stationID,
        flagID: 4, singleton: 0, stacksize: quantity,
        customInfo: Warehouse.marker(id),
      };
      stationItems.set(id, item);
      return { success: true, itemID: item.itemID };
    },
  };

  const warehouse = Warehouse.createWarehouse({
    root: fs.mkdtempSync(path.join(os.tmpdir(), "coop-wh-")),
    store, items,
    flush: () => ({ success: true }),
    getStation: (stationID) => (Number(stationID) === STATION ? { stationID, solarSystemID: SYSTEM } : null),
    getCorporation: (corporationID) => (Number(corporationID) === CORP ? { corporationID } : null),
    isNpcCorporation: (corporationID) => Number(corporationID) === CORP,
    verifyArrival: () => true,
    verifyDurableCargo: () => true,
    clock: () => CLOCK,
  });
  return { warehouse, stationItems, cargoID, haulerID };
}

function shadow() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "coop-v2-hook-"));
  process.env.EVEJS_COOP_ECONOMY_V2_FILE = path.join(dir, "shadow.json");
  process.env.EVEJS_COOP_ECONOMY_V2_ENABLE_FILE = path.join(dir, "enable");
  delete process.env.EVEJS_COOP_ECONOMY_V2;
  const enableFile = process.env.EVEJS_COOP_ECONOMY_V2_ENABLE_FILE;
  delete require.cache[V2_PATH];
  const v2 = require(V2_PATH);
  return {
    v2,
    enable: () => fs.writeFileSync(enableFile, "1"),
    disable: () => { try { fs.unlinkSync(enableFile); } catch (_error) { /* absent */ } },
  };
}

test("the warehouse hook is silent while the economy flag is off", () => {
  const { warehouse, stationItems, cargoID, haulerID } = harness({ cargoID: 980200300001, haulerID: 980000500001 });
  const s = shadow();
  s.disable();
  assert.equal(s.v2.enabled(), false, "the shadow is enabled without a flag or an enable file");
  const result = warehouse.deposit({
    cargoID, haulerID, fleetID: 960004610, systemID: SYSTEM, stationID: STATION,
    corporationID: CORP, arrivedAtMs: CLOCK - 1000, nowMs: CLOCK,
  });
  assert.equal(result.status, "COMMITTED", JSON.stringify(result));
  assert.equal(stationItems.size, 1, "the goods were not committed");
  const view = s.v2.status();
  assert.equal(view.deliveries, 0, "an OFF shadow recorded a delivery");
  assert.deepEqual(view.receipts, [], "an OFF shadow wrote a receipt");
});

test("a real committed deposit reaches the shadow with a physical proof", () => {
  const { warehouse, stationItems, cargoID, haulerID } = harness({ cargoID: 980200300002, haulerID: 980000500002 });
  const s = shadow();
  s.enable();
  assert.equal(s.v2.enabled(), true, "the enable file did not enable the shadow");
  const result = warehouse.deposit({
    cargoID, haulerID, fleetID: 960004610, systemID: SYSTEM, stationID: STATION,
    corporationID: CORP, arrivedAtMs: CLOCK - 1000, nowMs: CLOCK,
  });
  assert.equal(result.status, "COMMITTED", JSON.stringify(result));
  const view = s.v2.status();
  assert.equal(view.deliveries, 1, "the hook did not observe the commit");
  assert.equal(view.proofs.proven, 1, "the station stock was not proven: " + JSON.stringify(view.proofs));
  assert.equal(view.proofs.blocked, 0);
  const receipt = view.receipts[0];
  assert.equal(receipt.cargoID, cargoID);
  assert.equal(receipt.quantity, 1234);
  assert.equal(receipt.typeID, 17470);
  assert.equal(receipt.stationID, STATION);
  assert.equal(receipt.proof, "STOCK_PROVEN");
  assert.equal(receipt.durable, true);
  assert.equal(view.stations[STATION][17470], 1234, "the station total is wrong");
  // the shadow is an observer: the native store must be exactly what the deposit wrote
  assert.equal(stationItems.size, 1, "the shadow added a station item");
  assert.equal(stationItems.get(cargoID).quantity, 1234, "the shadow changed the committed stack");
});
