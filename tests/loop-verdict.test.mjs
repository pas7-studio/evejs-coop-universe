import test from 'node:test';
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';

const require = createRequire(import.meta.url);
const {verdict, format} = require('../scripts/loop-verdict.cjs');

// The acceptance answer must never be optimistic: each stage is proven by the
// event that produced it, and a missing stage names what is missing.
const at = (offsetSeconds) => new Date(Date.UTC(2026, 9, 26, 12, 0, offsetSeconds)).toISOString();
const cycle = (offset = 0) => ({at: at(offset), event: 'living-mining-cycle-settled', status: 'COMMITTED', quantity: 250, beforeRock: 9000, afterRock: 8750});
const attempt = (offset = 0) => ({at: at(offset), reason: 'MINING_CYCLE_ATTEMPT', locked: true, oreLeft: 9000});
const load = (offset = 30, quantity = 250) => ({at: at(offset), event: 'living-hauler-loaded', cargoQuantity: quantity, haulerID: 980000016027, fleetID: 960004609});
const delivered = (offset = 300, stationID = 60003760) => ({at: at(offset), event: 'living-native-haul-delivered', status: 'DELIVERED', stationID});
const sold = (offset = 330) => ({at: at(offset), event: 'living-npc-station-sold', soldQuantity: 250, revenue: 1500000, stationID: 60003760});
const skipped = (offset = 330) => ({at: at(offset), event: 'living-npc-station-sale-skipped', status: 'NO_BID', reason: 'MARKET_EMPTY'});

test('a full round trip passes and names its evidence', () => {
  const result = verdict([cycle(), load(), delivered(), sold()]);
  assert.equal(result.verdict, 'PASS');
  assert.equal(result.stages.mining.status, 'PROVEN');
  assert.equal(result.stages.haul.status, 'PROVEN');
  assert.equal(result.stages.deliver.status, 'PROVEN');
  assert.equal(result.stages.sale.status, 'PROVEN');
  assert.match(format(result), /LOOP_VERDICT PASS/);
});

test('a load with no delivery stops at deliver', () => {
  const result = verdict([cycle(), load()]);
  assert.equal(result.verdict, 'FAIL:deliver');
  assert.match(result.stages.deliver.detail, /stationID/);
});

test('a delivery to station 0 is not a delivery', () => {
  const result = verdict([cycle(), load(), delivered(300, 0), sold()]);
  assert.equal(result.stages.deliver.status, 'MISSING');
  assert.equal(result.verdict, 'FAIL:deliver');
});

test('a skipped sale is reported with the runtime reason, never as a pass', () => {
  const result = verdict([cycle(), load(), delivered(), skipped()]);
  assert.equal(result.stages.sale.status, 'SKIPPED');
  assert.match(result.stages.sale.detail, /NO_BID:MARKET_EMPTY/);
  assert.equal(result.verdict, 'FAIL:sale');
});

test('an empty hauler load is not a haul', () => {
  const result = verdict([cycle(), load(30, 0), delivered(), sold()]);
  assert.equal(result.stages.haul.status, 'MISSING');
  assert.equal(result.verdict, 'FAIL:haul');
});

test('a fleet holding ore proves mining even without cycle tracing', () => {
  const state = {at: at(0), reason: 'living-mining-fleet-state', fleets: [
    {fleetID: 1, state: 'mining', shipDetail: {ships: [{id: 1, quantity: 4200}, {id: 2, quantity: 0}]}},
  ]};
  // Ore in a hull without a settled cycle in this window is an attempt, not proof:
  // the window may simply start after the cycle that produced it.
  const result = verdict([state, load(), delivered(), sold()]);
  assert.equal(result.stages.mining.status, 'ATTEMPTED');
  const withCycle = verdict([cycle(), state, load(), delivered(), sold()]);
  assert.equal(withCycle.stages.mining.status, 'PROVEN');
  assert.equal(withCycle.verdict, 'PASS');
});

test('the sale stage can be waived only explicitly', () => {
  const result = verdict([cycle(), load(), delivered()], {requireSale: false});
  assert.equal(result.verdict, 'PASS');
  assert.equal(result.stages.sale.status, 'MISSING');
});

test('a since filter ignores earlier rounds', () => {
  const result = verdict([cycle(-600), load(-500), delivered(-400), sold(-300), cycle(0), load(30), delivered(300), sold(330)],
    {since: at(0)});
  assert.equal(result.verdict, 'PASS');
  assert.equal(result.stages.sale.status, 'PROVEN');
});

test('a cycle that only ran is not mining: the verdict says ATTEMPTED', () => {
  const result = verdict([attempt(), load(), delivered(), sold()]);
  assert.equal(result.stages.mining.status, 'ATTEMPTED');
  assert.equal(result.verdict, 'FAIL:mining');
  assert.match(result.stages.mining.detail, /none settled ore/);
});

test('a fleet holding ore without a settled cycle is an attempt, not proof', () => {
  const state = {at: at(0), reason: 'living-mining-fleet-state', fleets: [
    {fleetID: 1, state: 'mining', shipDetail: {ships: [{id: 1, quantity: 4200}]}},
  ]};
  const result = verdict([state, load(), delivered(), sold()]);
  assert.equal(result.stages.mining.status, 'ATTEMPTED');
  assert.equal(result.verdict, 'FAIL:mining');
});

test('a settled cycle with zero quantity does not count as mining', () => {
  const zero = {...cycle(), quantity: 0};
  const result = verdict([zero, load(), delivered(), sold()]);
  assert.equal(result.stages.mining.status, 'MISSING');
  assert.equal(result.verdict, 'FAIL:mining');
});
