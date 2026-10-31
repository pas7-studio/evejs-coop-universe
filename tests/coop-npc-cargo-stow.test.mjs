import test from 'node:test';
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const require = createRequire(import.meta.url);
const {createCargoStow} = require('../integration/coopNpcCargoStow.cjs');

const HANGAR = 4;

function tempRoot() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'coop-stow-'));
}

// A minimal but honest world: one durable hull with real cargo rows, one physical station.
function world({gap = 1000, cargo = [], categoryOf = {}} = {}) {
  const rows = cargo.map((row, index) => ({cargoID: index + 1, entityID: 9001,
    moduleID: 0, quantity: row.quantity, singleton: row.singleton === true ? 1 : 0,
    typeID: row.typeID, ownerID: 1000129}));
  const hangar = [];
  const store = {
    getNativeEntity: (id) => (Number(id) === 9001 ? {entityID: 9001, systemID: 30000145} : null),
    listNativeCargoForEntity: (id) => (Number(id) === 9001 ? rows.map((r) => ({...r})) : []),
    removeNativeCargo: (cargoID) => {
      const at = rows.findIndex((r) => r.cargoID === Number(cargoID));
      if (at < 0) return {success: false, errorMsg: 'MISSING'};
      rows.splice(at, 1);
      return {success: true};
    },
  };
  const items = {
    ITEM_FLAGS: {HANGAR},
    grantItemToOwnerLocation: (ownerID, stationID, flagID, type, quantity) => {
      hangar.push({ownerID, stationID, flagID, typeID: Number(type.typeID), quantity});
      return {success: true, data: {quantity}};
    },
    removeNativeCargo: (cargoID) => store.removeNativeCargo(cargoID),
  };
  const scene = {
    getEntityByID: (id) => (Number(id) === 9001
      ? {position: {x: 0, y: 0, z: 0}, radius: 100} : null),
    staticEntities: [{kind: 'station', itemID: 60000682, radius: 2000,
      position: {x: 0, y: 0, z: gap}}],
  };
  return {store, items, scene, hangar, rows,
    sceneFor: () => scene,
    getStation: () => ({stationID: 60000682, solarSystemID: 30000145}),
    resolveType: (typeID) => ({typeID, categoryID: categoryOf[typeID] ?? 9})};
}

test('a blueprint bought in space is stowed into the corporation hangar once', () => {
  const root = tempRoot();
  const w = world({cargo: [{typeID: 785, quantity: 1}]});
  const stow = createCargoStow({store: w.store, items: w.items, sceneFor: w.sceneFor,
    getStation: w.getStation, resolveType: w.resolveType, ownerID: 1000129, root,
    probe: null, now: () => 1});
  const answer = stow.stow({haulerID: 9001, stationID: 60000682});
  assert.equal(answer.status, 'STOWED');
  assert.equal(answer.stowed.length, 1);
  assert.deepEqual(w.hangar, [{ownerID: 1000129, stationID: 60000682, flagID: HANGAR,
    typeID: 785, quantity: 1}]);
  assert.equal(w.rows.length, 0, 'the hold really shrank');
  const journal = JSON.parse(fs.readFileSync(path.join(root, 'stow', '1.json'), 'utf8'));
  assert.equal(journal.phase, 'COMPLETED');
  // A second call has nothing left to move and never grants twice.
  assert.equal(stow.stow({haulerID: 9001, stationID: 60000682}).status, 'NOTHING_TO_STOW');
  assert.equal(w.hangar.length, 1);
});

test('freight is never quietly unloaded: only the named category moves', () => {
  const root = tempRoot();
  const w = world({cargo: [{typeID: 785, quantity: 1}, {typeID: 34, quantity: 5000}],
    categoryOf: {785: 9, 34: 4}});
  const stow = createCargoStow({store: w.store, items: w.items, sceneFor: w.sceneFor,
    getStation: w.getStation, resolveType: w.resolveType, ownerID: 1000129, root});
  const answer = stow.stow({haulerID: 9001, stationID: 60000682});
  assert.equal(answer.status, 'STOWED');
  assert.deepEqual(answer.stowed.map((row) => row.typeID), [785]);
  assert.equal(w.rows.length, 1);
  assert.equal(w.rows[0].typeID, 34, 'the mineral cargo is still aboard');
});

test('a hull far from the station stows nothing', () => {
  const root = tempRoot();
  const w = world({gap: 400000, cargo: [{typeID: 785, quantity: 1}]});
  const stow = createCargoStow({store: w.store, items: w.items, sceneFor: w.sceneFor,
    getStation: w.getStation, resolveType: w.resolveType, ownerID: 1000129, root});
  const answer = stow.stow({haulerID: 9001, stationID: 60000682});
  assert.equal(answer.status, 'TOO_FAR_FROM_STATION');
  assert.equal(w.hangar.length, 0);
  assert.equal(w.rows.length, 1);
});

test('a station in another system is refused, not stowed somewhere else', () => {
  const root = tempRoot();
  const w = world({cargo: [{typeID: 785, quantity: 1}]});
  const stow = createCargoStow({store: w.store, items: w.items, sceneFor: w.sceneFor,
    getStation: () => ({stationID: 60003760, solarSystemID: 30000142}),
    resolveType: w.resolveType, ownerID: 1000129, root});
  assert.equal(stow.stow({haulerID: 9001, stationID: 60003760}).status, 'STATION_OTHER_SYSTEM');
  assert.equal(w.hangar.length, 0);
});

test('a refused grant leaves the hold untouched and a journal the operator can read', () => {
  const root = tempRoot();
  const w = world({cargo: [{typeID: 785, quantity: 1}]});
  w.items.grantItemToOwnerLocation = () => ({success: false, errorMsg: 'HANGAR_FULL'});
  const stow = createCargoStow({store: w.store, items: w.items, sceneFor: w.sceneFor,
    getStation: w.getStation, resolveType: w.resolveType, ownerID: 1000129, root});
  const answer = stow.stow({haulerID: 9001, stationID: 60000682});
  assert.equal(answer.status, 'GRANT_REFUSED');
  assert.equal(w.rows.length, 1, 'the cargo was not removed');
  const journal = JSON.parse(fs.readFileSync(path.join(root, 'stow', '1.json'), 'utf8'));
  assert.equal(journal.phase, 'NEEDS_OPERATOR_REPAIR');
});

test('a pending journal blocks a second grant of the same stack', () => {
  const root = tempRoot();
  const w = world({cargo: [{typeID: 785, quantity: 1}]});
  fs.mkdirSync(path.join(root, 'stow'), {recursive: true});
  fs.writeFileSync(path.join(root, 'stow', '1.json'),
    JSON.stringify({version: 1, cargoID: 1, phase: 'GRANT_OUTCOME_UNKNOWN'}));
  const stow = createCargoStow({store: w.store, items: w.items, sceneFor: w.sceneFor,
    getStation: w.getStation, resolveType: w.resolveType, ownerID: 1000129, root});
  const answer = stow.stow({haulerID: 9001, stationID: 60000682});
  assert.equal(answer.status, 'JOURNAL_PENDING');
  assert.equal(w.hangar.length, 0, 'an ambiguous record is never repeated');
});

// A blueprint bought in Jita is only useful where its materials are. The shelf-to-hold move is
// the inverse of a stow and must be just as honest: one real hangar row becomes one real hold
// row, with the intent written down before the move.
function hangarWorld({gap = 1000, stacks = []} = {}) {
  const held = stacks.map((row, index) => ({itemID: row.itemID ?? 500 + index,
    ownerID: 1000129, locationID: 60000682, typeID: row.typeID,
    quantity: row.quantity ?? 0, singleton: row.singleton === true ? 1 : 0,
    categoryID: 9, stacksize: row.quantity ?? 0}));
  const cargo = [];
  const store = {
    getNativeEntity: (id) => (Number(id) === 9001
      ? {entityID: 9001, systemID: 30000145, ownerID: 1000129} : null),
    listNativeCargoForEntity: (id) => (Number(id) === 9001 ? cargo.map((row) => ({...row})) : []),
    removeNativeCargo: () => ({success: true}),
    allocateCargoID: () => ({success: true, data: 77}),
    upsertNativeCargo: (row) => { cargo.push({...row}); return {success: true}; },
  };
  const items = {
    ITEM_FLAGS: {HANGAR},
    listOwnedItems: (ownerID, {locationID} = {}) => held
      .filter((row) => !locationID || Number(row.locationID) === Number(locationID))
      .map((row) => ({...row})),
    removeInventoryItem: (itemID) => {
      const at = held.findIndex((row) => Number(row.itemID) === Number(itemID));
      if (at < 0) return {success: false, errorMsg: 'MISSING'};
      held.splice(at, 1);
      return {success: true};
    },
    updateInventoryItem: (itemID, change) => {
      const at = held.findIndex((row) => Number(row.itemID) === Number(itemID));
      if (at < 0) return {success: false, errorMsg: 'MISSING'};
      held[at] = change({...held[at]});
      return {success: true};
    },
  };
  const scene = {
    getEntityByID: (id) => (Number(id) === 9001
      ? {position: {x: 0, y: 0, z: 0}, radius: 100} : null),
    staticEntities: [{kind: 'station', itemID: 60000682, radius: 2000,
      position: {x: 0, y: 0, z: gap}}],
  };
  return {store, items, cargo, held,
    sceneFor: () => scene,
    getStation: () => ({stationID: 60000682, solarSystemID: 30000145}),
    resolveType: (typeID) => ({typeID, categoryID: 9, groupID: 105, name: 'Blueprint ' + typeID})};
}

test('a blueprint the corporation owns comes off the shelf and into the hold once', () => {
  const root = tempRoot();
  const w = hangarWorld({stacks: [{itemID: 501, typeID: 1334, quantity: 0, singleton: true}]});
  const stow = createCargoStow({store: w.store, items: w.items, sceneFor: w.sceneFor,
    getStation: w.getStation, resolveType: w.resolveType, ownerID: 1000129, root,
    probe: null, now: () => 1});
  const answer = stow.lift({haulerID: 9001, stationID: 60000682, typeID: 1334});
  assert.equal(answer.status, 'LIFTED');
  assert.equal(answer.cargoID, 77);
  assert.equal(w.held.length, 0, 'the hangar row really left the shelf');
  assert.equal(w.cargo.length, 1, 'the same asset is now in the hold');
  assert.equal(w.cargo[0].typeID, 1334);
  assert.equal(w.cargo[0].singleton, true, 'a blueprint stays a singleton');
  const journal = JSON.parse(fs.readFileSync(path.join(root, 'lift', '501.json'), 'utf8'));
  assert.equal(journal.phase, 'COMPLETED');
  assert.equal(stow.lift({haulerID: 9001, stationID: 60000682, typeID: 1334}).status,
    'NOTHING_TO_LIFT', 'a second copy is never invented');
});

test('a refused shelf debit leaves the blueprint on the shelf and a journal behind', () => {
  const root = tempRoot();
  const w = hangarWorld({stacks: [{itemID: 502, typeID: 1334, quantity: 0, singleton: true}]});
  w.items.removeInventoryItem = () => ({success: false, errorMsg: 'LOCKED'});
  const stow = createCargoStow({store: w.store, items: w.items, sceneFor: w.sceneFor,
    getStation: w.getStation, resolveType: w.resolveType, ownerID: 1000129, root});
  const answer = stow.lift({haulerID: 9001, stationID: 60000682, typeID: 1334});
  assert.equal(answer.status, 'HANGAR_DEBIT_FAILED');
  assert.equal(w.held.length, 1, 'the asset is still on the shelf');
  assert.equal(w.cargo.length, 0, 'nothing appeared in the hold');
  const journal = JSON.parse(fs.readFileSync(path.join(root, 'lift', '502.json'), 'utf8'));
  assert.equal(journal.phase, 'NEEDS_OPERATOR_REPAIR');
});

test('a hull far from the station lifts nothing off its shelf', () => {
  const root = tempRoot();
  const w = hangarWorld({gap: 400000,
    stacks: [{itemID: 503, typeID: 1334, quantity: 0, singleton: true}]});
  const stow = createCargoStow({store: w.store, items: w.items, sceneFor: w.sceneFor,
    getStation: w.getStation, resolveType: w.resolveType, ownerID: 1000129, root});
  assert.equal(stow.lift({haulerID: 9001, stationID: 60000682, typeID: 1334}).status,
    'TOO_FAR_FROM_STATION');
  assert.equal(w.held.length, 1);
});
