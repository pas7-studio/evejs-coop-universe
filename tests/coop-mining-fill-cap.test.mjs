import test from 'node:test';
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';

const require = createRequire(import.meta.url);
const fillCap = require('../integration/coopMiningFillCap.cjs');

// Live measurement: miners reached 8 193 -> 12 781 -> 18 777 m3 of ore while the
// largest real industrial hull in the native mining pools holds 5 500 m3. The stock
// trigger waits for 85% of the MINER's own capacity, so no hauler could ever take the
// load. The cap makes the fleet plan with the hold it actually has.
const SYSTEM = 30000144;
const FLEET = {fleetID: SYSTEM * 32 + 1, haulerEntityIDs: [2]};

const haulerShip = (itemID, typeID) => ({kind: 'ship', itemID, typeID});

function sceneWith(ships) {
  return {systemID: SYSTEM, getEntityByID: (id) => ships.get(id) || null};
}

function storeWith(cargoByEntity) {
  return {listNativeCargoForEntity: (id) => cargoByEntity[id] || []};
}

const types = {
  648: {capacity: 3900, volume: 250000},   // Badger
  652: {capacity: 5500, volume: 255000},   // Mammoth
  34: {capacity: 0, volume: 0.1},          // Veldspar
  32880: {capacity: 50, volume: 29500},    // Venture (the mis-composed "hauler")
};
const resolveType = (id) => types[id] || null;

const state = (used, capacity) => ({minerUsedVolumeM3: used, minerCapacityM3: capacity,
  haulerCapacityM3: 65000, minerFillRatio: used / capacity});

test('the default is off and the stock numbers are untouched', () => {
  const cargo = state(5000, 8000);
  fillCap.apply(sceneWith(new Map([[2, haulerShip(2, 652)]])), FLEET, cargo,
    {env: {}, store: storeWith({}), resolveType});
  assert.equal(cargo.minerCapacityM3, 8000);
  assert.equal(cargo.coopFillCapM3, undefined);
});

test('the miners stop at one real hauler load, not at their own big hold', () => {
  const cargo = state(0, 8000);
  const result = fillCap.apply(sceneWith(new Map([[2, haulerShip(2, 652)]])), FLEET, cargo,
    {env: {EVEJS_COOP_MINING_FILL_CAP: '1'}, store: storeWith({}), resolveType});
  assert.equal(result.minerCapacityM3, 5500, 'a Mammoth holds 5 500 m3');
  assert.equal(result.coopHaulerFreeM3, 5500);
  assert.equal(result.minerFillRatio, 0);
});

test('ore already in the hauler raises the fill ratio instead of being ignored', () => {
  const cargo = state(0, 8000);
  fillCap.apply(sceneWith(new Map([[2, haulerShip(2, 652)]])), FLEET, cargo,
    {env: {EVEJS_COOP_MINING_FILL_CAP: '1'},
     store: storeWith({2: [{cargoID: 1, typeID: 34, quantity: 20000}]}), resolveType});
  assert.equal(cargo.coopHaulerFreeM3, 3500, '5 500 - 2 000 m3 already loaded');
  assert.equal(cargo.minerCapacityM3, 3500);
});

test('a hull that is a mining ship is not a usable hold, and mining is not silently stopped', () => {
  const cargo = state(0, 8000);
  const notified = [];
  fillCap.apply(sceneWith(new Map([[2, haulerShip(2, 32880)]])), FLEET, cargo,
    {env: {EVEJS_COOP_MINING_FILL_CAP: '1'}, store: storeWith({}), resolveType,
     observe: (_probe, event, _details, fields) => notified.push({event, fields})});
  assert.equal(cargo.minerCapacityM3, 8000, 'a 50 m3 hold must not cap the miners to 50');
  assert.equal(notified.length, 1);
  assert.equal(notified[0].fields.status, 'HAULER_HOLD_UNUSABLE');
});

test('an unprovable hold changes nothing', () => {
  const cargo = state(0, 8000);
  fillCap.apply(sceneWith(new Map([[2, haulerShip(2, 652)]])), FLEET, cargo,
    {env: {EVEJS_COOP_MINING_FILL_CAP: '1'}, store: {listNativeCargoForEntity: () => null},
     resolveType});
  assert.equal(cargo.minerCapacityM3, 8000);
});

test('no hauler at all is zero capacity, and the ratio cannot divide by zero', () => {
  const free = fillCap.transferableM3({scene: sceneWith(new Map()),
    fleet: {fleetID: SYSTEM * 32 + 1, haulerEntityIDs: []}, store: storeWith({}), resolveType});
  assert.equal(free, 0);
});

test('telemetry never breaks the mining tick', () => {
  const cargo = state(0, 8000);
  const applied = fillCap.apply(sceneWith(new Map([[2, haulerShip(2, 652)]])), FLEET, cargo,
    {env: {EVEJS_COOP_MINING_FILL_CAP: '1'}, store: storeWith({}), resolveType,
     observe: () => { throw new Error('telemetry down'); }});
  assert.equal(applied.minerCapacityM3, 5500);
});
