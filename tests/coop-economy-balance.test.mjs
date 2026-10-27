import test from 'node:test';
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';

const require = createRequire(import.meta.url);
const audit = require('../scripts/coop-economy-balance.cjs');

const CORP = 1000129;
const row = (over = {}) => ({ownerID: CORP, locationID: 60000682, typeID: 34, quantity: 100,
  flagID: 4, ...over});
const bid = (over = {}) => ({order_id: '1', source: 'seed', station_id: 60000682,
  type_id: 34, price: 3, vol_remaining: 5000, ...over});

test('stock is grouped per station and type, and only for this owner', () => {
  const rows = [row(), row({quantity: 50}), row({ownerID: 1}), row({flagID: 0}),
    row({locationID: 0}), row({quantity: 0})];
  const stock = audit.stockByStation(rows, {ownerID: CORP});
  assert.equal(stock.length, 1);
  assert.equal(stock[0].quantity, 150);
  assert.equal(stock[0].stacks, 2);
});

test('a bid only counts on its own station and only for its remaining volume', () => {
  assert.equal(audit.localDemand([bid({station_id: 60000361})], {stationID: 60000682, typeID: 34}).units, 0);
  assert.equal(audit.localDemand([bid({source: 'player'})], {stationID: 60000682, typeID: 34}).units, 0);
  assert.equal(audit.localDemand([bid({vol_remaining: 0})], {stationID: 60000682, typeID: 34}).units, 0);
  const found = audit.localDemand([bid({vol_remaining: 40}), bid({order_id: '2', vol_remaining: 60, price: 2})],
    {stationID: 60000682, typeID: 34});
  assert.equal(found.units, 100);
  assert.equal(found.bestPrice, 3);
  assert.equal(found.orders, 2);
});

test('the balance names a station with no buyer instead of hiding it in a total', () => {
  const stock = [{stationID: 60000358, typeID: 34, quantity: 900, stacks: 1},
    {stationID: 60000682, typeID: 34, quantity: 5000, stacks: 1}];
  const demand = {'60000358:34': {units: 0, bestPrice: null, isk: 0, orders: 0},
    '60000682:34': {units: 5000, bestPrice: 2, isk: 10000, orders: 1}};
  const report = audit.balance({stock, demand});
  assert.equal(report.status, 'PARTIAL_DEMAND');
  assert.equal(report.rows[0].status, 'NO_BUYER_ON_THIS_STATION');
  assert.equal(report.rows[0].isk, 0);
  assert.equal(report.rows[1].status, 'SELLABLE');
  assert.equal(report.totals.stranded, 900);
  assert.equal(report.totals.isk, 10000);
});

test('a partly absorbed stack is demand limited, never assumed sold', () => {
  const report = audit.balance({stock: [{stationID: 60000682, typeID: 35, quantity: 9000, stacks: 2}],
    demand: {'60000682:35': {units: 4000, bestPrice: 10, isk: 40000, orders: 1}}});
  assert.equal(report.rows[0].status, 'DEMAND_LIMITED');
  assert.equal(report.rows[0].sellable, 4000);
  assert.equal(report.rows[0].isk, 40000);
  assert.equal(report.totals.stranded, 5000);
});

test('empty stock is reported as no stock, not as a pass', () => {
  const report = audit.balance({stock: [], demand: {}});
  assert.equal(report.status, 'NO_STOCK');
  assert.equal(report.totals.stock, 0);
  assert.match(audit.format(report), /^status=NO_STOCK/);
});
