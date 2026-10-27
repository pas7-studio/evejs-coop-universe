import test from 'node:test';
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';

const require = createRequire(import.meta.url);
const audit = require('../scripts/coop-mineral-audit.cjs');

const mineral = (over = {}) => ({
  itemID: 1, ownerID: 1000129, locationID: 60000358, typeID: 34, quantity: 100,
  flagID: 4, customInfo: 'coop-refine:v1:9988400103325:23111:mineral:34', ...over,
});
const order = (over = {}) => ({
  order_id: '9001', source: 'seed', station_id: 60000358, type_id: 34,
  price: 6.5, vol_remaining: 1000, ...over,
});

test('only the refinery own output in a corporation hangar counts as stock', () => {
  const rows = [
    mineral(),
    mineral({itemID: 2, customInfo: 'coop-warehouse:v1:cargo:9988400103333'}),
    mineral({itemID: 3, ownerID: 1000007}),
    mineral({itemID: 4, flagID: 0}),
    mineral({itemID: 5, quantity: 0}),
    mineral({itemID: 6, customInfo: 'loot:v1:mineral'}),
  ];
  const got = audit.mineralRows(rows, {ownerID: 1000129});
  assert.deepEqual(got.map((x) => x.itemID), [1]);
});

test('the best seeded buy order wins on price and ignores other sources or stations', () => {
  const best = audit.bestSeededBuy([
    order({order_id: '1', price: 5}),
    order({order_id: '2', price: 7.2, vol_remaining: 5}),
    order({order_id: '3', price: 99, source: 'player'}),
    order({order_id: '4', price: 99, station_id: 60000682}),
    order({order_id: '5', price: 99, vol_remaining: 0}),
  ], {stationID: 60000358, typeID: 34});
  assert.equal(best.order_id, '2');
  assert.equal(best.price, 7.2);
});

test('a market book is read from its real buy side, never the empty generic field', () => {
  assert.deepEqual(audit.bookBuys({buys: [order()], sells: [order()]}).length, 1);
  assert.deepEqual(audit.bookBuys({orders: [order()]}), []);
  assert.deepEqual(audit.bookBuys(null), []);
});

test('an audit prices the real stock and says exactly where no buyer exists', async () => {
  const report = await audit.audit({
    ownerID: 1000129,
    rows: [mineral({quantity: 100}), mineral({itemID: 2, quantity: 50})],
    regionForStation: () => 10000002,
    orders: async ({typeID}) => typeID === 34 ? [order()] : [],
  });
  assert.equal(report.status, 'BUYERS_FOUND');
  assert.equal(report.stacks, 2);
  assert.equal(report.isk, 975);
  assert.equal(report.stations.length, 1);
  assert.equal(report.stations[0].quantity, 150);
});

test('no buyer is reported, never invented', async () => {
  const report = await audit.audit({
    ownerID: 1000129, rows: [mineral()],
    regionForStation: () => 10000002, orders: async () => [],
  });
  assert.equal(report.status, 'PARTIAL_BUYER');
  assert.equal(report.isk, 0);
  assert.equal(report.stations[0].status, 'NO_SEEDED_COUNTERPARTY');
});

test('empty stock is an explicit state, not a zero-ISK success', () => {
  const report = audit.format({status: 'NO_MINERAL_STOCK', stacks: 0, stations: [], isk: 0});
  assert.match(report, /status=NO_MINERAL_STOCK/);
  assert.match(report, /no coop-refine mineral rows/);
});
