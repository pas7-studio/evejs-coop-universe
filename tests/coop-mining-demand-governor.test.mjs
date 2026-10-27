import test from 'node:test';
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';

const require = createRequire(import.meta.url);
const gov = require('../integration/coopMiningDemandGovernor.cjs');

const CORP = 1000129;
const row = (over = {}) => ({ownerID: CORP, locationID: 60000682, typeID: 34, quantity: 100,
  flagID: 4, ...over});
const bid = (over = {}) => ({order_id: '1', source: 'seed', station_id: 60000682,
  type_id: 34, vol_remaining: 5000, price: 3, ...over});

test('stock outside the hangar, or of another owner, never counts', () => {
  const rows = [row(), row({quantity: 50}), row({ownerID: 5}), row({flagID: 0}),
    row({locationID: 0}), row({quantity: 0})];
  const stock = gov.stockRows(rows, {ownerID: CORP});
  assert.equal(stock.length, 1);
  assert.equal(stock[0].quantity, 150);
});

test('a buyer only counts where the stock really sits', () => {
  const stock = [{stationID: 60000682, typeID: 34, quantity: 1000, regionID: 10000002}];
  const books = {'34:10000002': [bid({vol_remaining: 400}),
    bid({order_id: '2', station_id: 60000361, vol_remaining: 900}),
    bid({order_id: '3', source: 'player', vol_remaining: 700})]};
  assert.equal(gov.demandUnits(stock, books), 400);
  assert.equal(gov.demandUnits(stock, {}), 0);
});

test('production is allowed while stock stays within measured demand', () => {
  const decision = gov.decide({stock: 1000, demand: 4000, floorUnits: 0, factor: 1.5});
  assert.equal(decision.action, 'ALLOW');
  assert.equal(decision.allowance, 6000);
});

test('the floor keeps a small backlog from stopping the world', () => {
  const decision = gov.decide({stock: 15000, demand: 0, floorUnits: 20000});
  assert.equal(decision.action, 'ALLOW');
});

test('overstock holds, but one trickle window keeps a heartbeat', () => {
  const held = gov.decide({stock: 4_000_000, demand: 35000, floorUnits: 20000,
    lastTrickleAt: 0, now: 1_000_000});
  assert.equal(held.action, 'TRICKLE');
  const wait = gov.decide({stock: 4_000_000, demand: 35000, floorUnits: 20000,
    lastTrickleAt: 1_000_000, now: 1_000_000 + 60_000, trickleMs: 900_000});
  assert.equal(wait.action, 'HOLD');
  const again = gov.decide({stock: 4_000_000, demand: 35000, floorUnits: 20000,
    lastTrickleAt: 1_000_000, now: 1_000_000 + 900_000, trickleMs: 900_000});
  assert.equal(again.action, 'TRICKLE');
});

function governor({rows = [row({quantity: 4_000_000})], books = {}, now = 1_000_000,
  observe = () => {}} = {}) {
  return gov.createGovernor({
    items: {listOwnedItems: () => rows},
    getStation: () => ({regionID: 10000002}),
    market: {books: () => books},
    corpID: CORP,
    clock: () => now,
    cacheMs: 0,
    probe: {observe},
  });
}

test('an unread market book is unknown, so mining is not stopped by it', () => {
  const observed = [];
  const engine = governor({books: {}, observe: (event, _a, extra) => observed.push(extra.status)});
  assert.equal(engine.hold({systemID: 30000145}, {fleetID: 960004641}), false);
  assert.deepEqual(observed, ['DEMAND_UNKNOWN']);
});

test('a measured overstock really skips the native mining tick', () => {
  const observed = [];
  const stock = [row({quantity: 4_000_000})];
  const books = {'34:10000002': [bid({vol_remaining: 5000})]};
  const engine = governor({rows: stock, books,
    observe: (event, _a, extra) => observed.push(extra.status)});
  // First call is the trickle window, then the tick is skipped.
  assert.equal(engine.hold({systemID: 30000145}, {fleetID: 960004641}), false);
  assert.equal(engine.hold({systemID: 30000145}, {fleetID: 960004641}), true);
  assert.deepEqual(observed, ['TRICKLE_ALLOWED', 'HOLD']);
});

test('an unreadable stock never stops mining', () => {
  const engine = gov.createGovernor({
    items: {listOwnedItems: () => { throw new Error('boom'); }},
    getStation: () => ({regionID: 10000002}),
    market: {books: () => ({})},
    corpID: CORP,
    clock: () => 1,
    cacheMs: 0,
    probe: {observe: () => {}},
  });
  assert.equal(engine.hold({systemID: 30000145}, {fleetID: 1}), false);
});
