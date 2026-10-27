import test from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import path from "node:path";
const require = createRequire(import.meta.url);
const ROOT = path.join(import.meta.dirname, "..");
const { createMiningFleetDiagnose } = require(path.join(ROOT, "integration", "coopMiningFleetDiagnose.cjs"));

const AU = 149_597_870_700;
const NOW = 1_793_061_000_000;

function belt(id, position) {
  return { id, kind: "asteroidBelt", name: "belt " + id, position };
}
function sceneOf({ systemID = 30000145, entities = [], belts = [], stations = [] } = {}) {
  return {
    systemID,
    staticEntities: [...belts, ...stations],
    getEntityByID: (id) => entities.find((entity) => entity.itemID === Number(id)) || null,
  };
}
function miner(entityID, position, extra = {}) {
  return { itemID: entityID, kind: "ship", nativeNpc: true, position, mode: "STOP", ...extra };
}

test("a miner at an off-grid warp origin is reported AU-scale from the belt", () => {
  const diagnose = createMiningFleetDiagnose({
    getFleets: () => [{ fleetID: 960004641, systemID: 30000145, state: "mining", minerEntityIDs: [980000016052], haulerEntityIDs: [] }],
    getScene: () => sceneOf({
      entities: [miner(980000016052, { x: 4 * AU, y: 0, z: 0 })],
      belts: [belt(40000001, { x: 0, y: 0, z: 0 })],
    }),
    waypoints: (scene) => scene.staticEntities,
    now: () => NOW,
  });
  const [fleet] = diagnose.run({ systemIDs: [30000145] });
  assert.equal(fleet.miners.length, 1);
  assert.equal(fleet.miners[0].nearestBelt.id, 40000001);
  assert.equal(fleet.miners[0].nearestBelt.distanceMeters, Math.round(4 * AU));
});

test("an approach that is only a follow order is visible: no warp, controller order reported", () => {
  const diagnose = createMiningFleetDiagnose({
    getFleets: () => [{ fleetID: 7, systemID: 30000145, state: "mining", minerEntityIDs: [42], haulerEntityIDs: [] }],
    getScene: () => sceneOf({ entities: [miner(42, { x: 1e9, y: 0, z: 0 })], belts: [belt(40000001, { x: 0, y: 0, z: 0 })] }),
    waypoints: (scene) => scene.staticEntities,
    getController: () => ({ currentTargetID: 0, manualOrder: { type: "follow", targetID: 40000001, allowWeapons: false } }),
    orderDiagnose: () => ({ status: "BLOCKED", reason: "COOP_NPC_ORDER_NATIVE_COMMAND_ACTIVE", leaseOwner: "CIVILIAN" }),
    now: () => NOW,
  });
  const [fleet] = diagnose.run({ systemIDs: [30000145] });
  assert.equal(fleet.miners[0].warp, null);
  assert.equal(fleet.miners[0].controller.manualType, "follow");
  assert.equal(fleet.miners[0].order.leaseOwner, "CIVILIAN");
});

test("a warp in flight reports its own clock and the remaining distance", () => {
  const diagnose = createMiningFleetDiagnose({
    getFleets: () => [{
      fleetID: 8, systemID: 30000145, state: "hauling", minerEntityIDs: [], haulerEntityIDs: [43],
      coopStationArrival: {
        stationID: 60000682, corporationID: 1000004, manifestID: "30000145-8-1",
        startedAt: NOW - 2000, haulers: { 43: { arrivedAt: 0 } },
      },
    }],
    getScene: () => sceneOf({
      entities: [miner(43, { x: 0, y: 0, z: 0 }, {
        mode: "WARP",
        pendingWarp: false,
        sessionlessWarpIngress: {
          origin: { x: 0, y: 0, z: 0 },
          targetPoint: { x: 1000, y: 0, z: 0 },
          startTimeMs: NOW - 1000,
          travelCompleteAtMs: NOW + 4000,
          completeAtMs: NOW + 4000,
        },
      })],
      stations: [{ itemID: 60000682, kind: "station", position: { x: 5000, y: 0, z: 0 } }],
    }),
    waypoints: (scene) => scene.staticEntities,
    now: () => NOW,
  });
  const [fleet] = diagnose.run({ systemIDs: [30000145] });
  const ship = fleet.haulers[0];
  assert.equal(ship.mode, "WARP");
  assert.equal(ship.warp.fromIngress, true);
  assert.equal(ship.warp.elapsedMs, 1000);
  assert.equal(ship.warp.remainingMs, 4000);
  assert.equal(ship.warp.overdue, false);
  assert.equal(ship.distanceToStationMeters, 5000);
});

test("a loaded fleet stuck on an ack-less manifest is reported as such", () => {
  const files = new Map([
    ["trip-manifests/30000145-960004641-1793061893567.json",
      JSON.stringify({ key: "30000145-960004641-1793061893567", startedAt: NOW - 600000, cargo: [{ cargoID: 1 }, { cargoID: 2 }] })],
  ]);
  const ROOT_DIR = "/var/lib/evejs/coop-native-warehouse";
  const relative = (file) => String(file).replace(/\\/g, "/").replace(ROOT_DIR + "/", "");
  const io = {
    readdirSync: () => [...files.keys()].filter((name) => name.startsWith("trip-manifests/")).map((name) => name.slice(15)),
    readFileSync: (file) => files.get(relative(file)),
    statSync: (file) => {
      if (!files.has(relative(file))) { const error = new Error("ENOENT"); error.code = "ENOENT"; throw error; }
      return { size: 1 };
    },
  };
  const diagnose = createMiningFleetDiagnose({
    getFleets: () => [{
      fleetID: 960004641, systemID: 30000145, state: "loaded", startupKey: "30000145:1",
      minerEntityIDs: [], haulerEntityIDs: [], loadedUntilMs: NOW + 1000,
    }],
    getScene: () => sceneOf(),
    waypoints: () => [],
    journalRoot: "/var/lib/evejs/coop-native-warehouse",
    io,
    now: () => NOW,
  });
  const [fleet] = diagnose.run({ systemIDs: [30000145] });
  assert.equal(fleet.state, "loaded");
  assert.equal(fleet.trip, null);
  assert.equal(fleet.journal.status, "MANIFEST_PRESENT");
  assert.equal(fleet.journal.latestManifestKey, "30000145-960004641-1793061893567");
  assert.equal(fleet.journal.departureAck, false);
  assert.equal(fleet.journal.expired, false);
  assert.equal(fleet.journal.cargoRows, 2);
  assert.equal(fleet.journal.overdue, false);
  assert.equal(fleet.journal.ageMs, 600000);
});

test("an active trip reports its manifest, station and haulers", () => {
  const diagnose = createMiningFleetDiagnose({
    getFleets: () => [{
      fleetID: 9, systemID: 30000144, state: "loaded",
      minerEntityIDs: [], haulerEntityIDs: [44],
      coopStationArrival: {
        stationID: 60000358, corporationID: 1000004, manifestID: "30000144-9-1",
        startedAt: NOW - 5000, haulers: { 44: { arrivedAt: 0 } }, expectedCargoIDs: [1, 2, 3],
      },
    }],
    getScene: () => sceneOf({
      entities: [miner(44, { x: 100, y: 0, z: 0 })],
      stations: [{ itemID: 60000358, kind: "station", position: { x: 0, y: 0, z: 0 } }],
    }),
    waypoints: (scene) => scene.staticEntities,
    now: () => NOW,
  });
  const [fleet] = diagnose.run({ systemIDs: [30000144] });
  assert.equal(fleet.trip.manifestID, "30000144-9-1");
  assert.equal(fleet.trip.haulerCount, 1);
  assert.equal(fleet.trip.expectedCargoIDs, 3);
  assert.equal(fleet.trip.needsOperatorRepair, false);
  assert.equal(fleet.haulers[0].distanceToStationMeters, 100);
});

test("the probe refuses to guess a system and never moves anything", () => {
  let warps = 0;
  const fleet = { fleetID: 1, systemID: 30000145, state: "mining", minerEntityIDs: [1], haulerEntityIDs: [] };
  const diagnose = createMiningFleetDiagnose({
    getFleets: () => [fleet],
    getScene: () => sceneOf({ entities: [miner(1, { x: 0, y: 0, z: 0 })] }),
    waypoints: () => [],
    now: () => NOW,
  });
  assert.throws(() => diagnose.run({}), /MINING_DIAGNOSE_SYSTEM_REQUIRED/);
  const before = JSON.stringify(fleet);
  diagnose.run({ systemIDs: [30000145] });
  assert.equal(JSON.stringify(fleet), before, "the fleet record must not change");
  assert.equal(warps, 0);
  assert.equal(fleet.state, "mining");
});
