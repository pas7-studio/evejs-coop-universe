import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {createRequire} from 'node:module';

const require = createRequire(import.meta.url);
const lift = require('../integration/coopNpcMineralLift.cjs');

const CORP = 1000129;
const HAULER = 7001;
const STATION = 60000682;
const SYSTEM = 30000145;

const mineral = (over = {}) => ({
  itemID: 1, ownerID: CORP, locationID: STATION, typeID: 34, quantity: 407192,
  stacksize: 407192, flagID: 4, customInfo: 'coop-refine:v1:9988400103325:23111:mineral:34', ...over,
});
const bid = (over = {}) => ({
  order_id: '9001', source: 'seed', station_id: STATION, type_id: 34,
  price: 2.96, vol_remaining: 5000, ...over,
});

function fakes({rows = [mineral()], buys = [bid()], journal = [], now = 1_700_000_000_000} = {}) {
  const items = [...rows];
  const cargo = new Map();
  let nextCargo = 900;
  const store = {
    getNativeEntity: (id) => Number(id) === HAULER ? {entityID: HAULER, systemID: SYSTEM, typeID: 648, ownerID: 9801} : null,
    allocateCargoID: () => ({success: true, data: nextCargo++}),
    upsertNativeCargo: (row) => { cargo.set(row.cargoID, {...row}); return {success: true}; },
    listNativeCargoForEntity: (id) => [...cargo.values()].filter((row) => Number(row.entityID) === Number(id)),
    removeNativeCargo: (id) => { cargo.delete(id); return {success: true}; },
  };
  const itemStore = {
    listOwnedItems: () => items.map((row) => ({...row})),
    updateInventoryItem: (id, updater) => {
      const at = items.findIndex((row) => Number(row.itemID) === Number(id));
      if (at < 0) return {success: false};
      items[at] = updater({...items[at]});
      return {success: true, data: items[at]};
    },
    removeInventoryItem: (id) => {
      const at = items.findIndex((row) => Number(row.itemID) === Number(id));
      if (at < 0) return {success: false};
      items.splice(at, 1);
      return {success: true};
    },
  };
  const observed = [];
  const options = {store, items: itemStore, corpID: CORP, clock: () => now,
    resolveType: (id) => ({typeID: id, groupID: 18, categoryID: 4, name: 'Tritanium', volume: 0.01}),
    getStation: () => ({regionID: 10000002}),
    call: async () => ({buys, sells: []}),
    root: fs.mkdtempSync(path.join(os.tmpdir(), 'lift-')),
    probe: {observe: (event, _a, extra) => observed.push({event, extra})}};
  for (const entry of journal) {
    fs.mkdirSync(path.join(options.root, 'journal'), {recursive: true});
    fs.writeFileSync(path.join(options.root, 'journal', entry.journalID + '.json'), JSON.stringify(entry));
  }
  return {options, items, cargo, observed};
}

test('only the refinery output of this corporation on this station is stock', () => {
  const rows = [mineral(), mineral({itemID: 2, customInfo: 'coop-warehouse:v1:x'}),
    mineral({itemID: 3, ownerID: 1}), mineral({itemID: 4, locationID: 60000358}),
    mineral({itemID: 5, flagID: 0}), mineral({itemID: 6, quantity: 0, stacksize: 0})];
  assert.deepEqual(lift.mineralStacks(rows, {ownerID: CORP, stationID: STATION}).map((row) => row.itemID), [1]);
});

test('a remote or non-seeded bid is never a buyer for this station', () => {
  assert.equal(lift.localBid([bid({station_id: 60000361})], {stationID: STATION, typeID: 34}), null);
  assert.equal(lift.localBid([bid({source: 'player'})], {stationID: STATION, typeID: 34}), null);
  assert.equal(lift.localBid([bid({vol_remaining: 0})], {stationID: STATION, typeID: 34}), null);
  assert.equal(lift.localBid([bid()], {stationID: STATION, typeID: 34}).price, 2.96);
});

test('the plan is bounded by the stack, the live bid volume and the cap', () => {
  const stacks = [mineral({quantity: 100}), mineral({itemID: 2, quantity: 100, typeID: 35})];
  const buys = [bid({vol_remaining: 40}), bid({order_id: '9002', type_id: 35, price: 16.35, vol_remaining: 5})];
  const plan = lift.planLift({stacks, buys, stationID: STATION, cap: 30});
  assert.deepEqual(plan.map((row) => [row.typeID, row.quantity]), [[34, 30], [35, 5]]);
  assert.equal(lift.planLift({stacks, buys, stationID: STATION, cap: 100}).find((row) => row.typeID === 34).quantity, 40);
});

test('a lift really moves stock into native cargo and leaves a receipt', async () => {
  const {options, items, cargo, observed} = fakes({buys: [bid({vol_remaining: 5000})]});
  const engine = lift.createMineralLift(options);
  const result = await engine.lift({systemID: SYSTEM, stationID: STATION, haulerID: HAULER});
  assert.equal(result.status, 'LIFTED');
  assert.equal(items[0].quantity, 402192);
  const row = [...cargo.values()][0];
  assert.equal(row.quantity, 5000);
  assert.equal(row.entityID, HAULER);
  assert.match(row.customInfo, /^coop-mineral-lift:v1:/);
  const receipts = fs.readdirSync(path.join(options.root, 'receipts'));
  assert.equal(receipts.length, 1);
  assert.equal(JSON.parse(fs.readFileSync(path.join(options.root, 'receipts', receipts[0]), 'utf8')).phase, 'SETTLED');
  assert.equal(fs.readdirSync(path.join(options.root, 'journal')).length, 0);
  assert.equal(observed[0].event, 'living-npc-mineral-lifted');
});

test('a stack sold to zero disappears instead of leaving an empty row', async () => {
  const {options, items} = fakes({rows: [mineral({quantity: 120})], buys: [bid({vol_remaining: 5000})]});
  const result = await lift.createMineralLift(options).lift({systemID: SYSTEM, stationID: STATION, haulerID: HAULER});
  assert.equal(result.status, 'LIFTED');
  assert.equal(items.length, 0);
});

test('no local bid means no lift, and the stock stays untouched', async () => {
  const {options, items, cargo} = fakes({buys: [bid({station_id: 60000361})]});
  const result = await lift.createMineralLift(options).lift({systemID: SYSTEM, stationID: STATION, haulerID: HAULER});
  assert.equal(result.status, 'NO_LOCAL_BID');
  assert.equal(items[0].quantity, 407192);
  assert.equal(cargo.size, 0);
});

test('a hauler that is not in that system never gets stock', async () => {
  const {options, cargo} = fakes();
  const result = await lift.createMineralLift(options).lift({systemID: 30000144, stationID: STATION, haulerID: HAULER});
  assert.equal(result.status, 'HAULER_NOT_HERE');
  assert.equal(cargo.size, 0);
});

test('recovery settles a journal whose cargo really is aboard', () => {
  const journal = {version: 1, phase: 'PREPARED', journalID: 'j1', corpID: CORP, systemID: SYSTEM,
    stationID: STATION, haulerID: HAULER, itemID: 1, typeID: 34, quantity: 500,
    beforeQuantity: 407192, afterQuantity: 406692, cargoTag: 'coop-mineral-lift:v1:j1'};
  const {options, cargo} = fakes({journal: [journal]});
  cargo.set(1, {cargoID: 1, entityID: HAULER, typeID: 34, quantity: 500, customInfo: journal.cargoTag});
  const engine = lift.createMineralLift(options);
  const report = engine.recover();
  assert.equal(report.status, 'RECOVERED');
  assert.equal(report.recovered, 1);
  assert.equal(engine.status, 'READY');
});

test('recovery halts when stock and cargo disagree instead of guessing', () => {
  const journal = {version: 1, phase: 'PREPARED', journalID: 'j2', corpID: CORP, systemID: SYSTEM,
    stationID: STATION, haulerID: HAULER, itemID: 1, typeID: 34, quantity: 500,
    beforeQuantity: 407192, afterQuantity: 406692, cargoTag: 'coop-mineral-lift:v1:j2'};
  const {options} = fakes({journal: [journal]});
  const engine = lift.createMineralLift(options);
  const report = engine.recover();
  assert.equal(report.status, 'NEEDS_OPERATOR_REPAIR');
  assert.equal(engine.status, 'NEEDS_OPERATOR_REPAIR');
});
