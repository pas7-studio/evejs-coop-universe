import test from 'node:test';
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';

const require = createRequire(import.meta.url);
const {planSupply, heldAt} = require('../integration/coopNpcInputSupply.cjs');
const {planLift} = require('../integration/coopNpcMineralLift.cjs');

// The measured Miner I recipe (blueprint 785): Tritanium, Pyerite, Mexallon.
const miner = (runs = 1) => ({status: 'READY', blueprintTypeID: 785, productTypeID: 483,
  productName: 'Miner I',
  materials: [{typeID: 34, quantity: 1324 * runs}, {typeID: 35, quantity: 481 * runs},
    {typeID: 36, quantity: 119 * runs}]});
const chipset = (runs = 1) => ({status: 'READY', blueprintTypeID: 1076, productTypeID: 444,
  productName: 'Mining Survey Chipset I',
  materials: [{typeID: 34, quantity: 1111 * runs}]});
const recipeOf = (table) => (blueprintTypeID, runs) => {
  const make = table[Number(blueprintTypeID)];
  return make ? make(runs) : {status: 'RECIPE_UNAVAILABLE'};
};

test('the plan names the material the hangar really lacks', () => {
  const answer = planSupply({
    blueprints: [{blueprintTypeID: 785, stationID: 60000682}],
    recipe: recipeOf({785: miner}),
    // Measured 2026-10-31: 3.8 M Tritanium, zero Pyerite, zero Mexallon.
    held: {34: 3892702},
    stationID: 60000682,
  });
  assert.equal(answer.status, 'SHORT');
  assert.deepEqual(answer.needs.map((row) => row.typeID).sort((a, b) => a - b), [35, 36]);
  const pyerite = answer.totals.find((row) => row.typeID === 35);
  assert.equal(pyerite.need, 481);
  assert.equal(pyerite.have, 0);
  assert.equal(pyerite.short, 481);
  const trit = answer.totals.find((row) => row.typeID === 34);
  assert.equal(trit.short, -3891378, 'a surplus is reported, never bought');
});

test('two blueprints that need the same material need the SUM, not the largest', () => {
  const answer = planSupply({
    blueprints: [{blueprintTypeID: 785}, {blueprintTypeID: 1076}],
    recipe: recipeOf({785: miner, 1076: chipset}),
    held: {},
  });
  assert.equal(answer.totals.find((row) => row.typeID === 34).need, 1324 + 1111);
});

test('a fully stocked hangar needs nothing and buys nothing', () => {
  const answer = planSupply({
    blueprints: [{blueprintTypeID: 785}],
    recipe: recipeOf({785: miner}),
    held: {34: 5000, 35: 900, 36: 400},
  });
  assert.equal(answer.status, 'SUPPLIED');
  assert.deepEqual(answer.needs, []);
  assert.equal(answer.totals.length, 3, 'the full requirement is still reported');
});

test('one trip buys a bounded number of material types, biggest hole first', () => {
  const answer = planSupply({
    blueprints: [{blueprintTypeID: 785}], recipe: recipeOf({785: miner}),
    held: {34: 3892702}, maxTypes: 1,
  });
  assert.equal(answer.needs.length, 1);
  assert.equal(answer.needs[0].typeID, 35, 'Pyerite is the biggest hole once Tritanium is stocked');
});

test('an unknown recipe is refused, never guessed', () => {
  const answer = planSupply({
    blueprints: [{blueprintTypeID: 999999}], recipe: recipeOf({}), held: {},
  });
  assert.equal(answer.status, 'SUPPLIED');
  assert.equal(answer.needs.length, 0);
  assert.deepEqual(answer.refusals, [{blueprintTypeID: 999999, reason: 'RECIPE_UNAVAILABLE'}]);
  const partial = planSupply({
    blueprints: [{blueprintTypeID: 999999}, {blueprintTypeID: 785}],
    recipe: recipeOf({785: miner}), held: {},
  });
  assert.equal(partial.status, 'SHORT');
  assert.deepEqual(partial.refusals, [{blueprintTypeID: 999999,
    reason: 'RECIPE_UNAVAILABLE'}]);
});

test('heldAt counts a singleton blueprint as one asset, not a negative amount', () => {
  const items = {ITEM_FLAGS: {HANGAR: 4}, listOwnedItems: () => [
    {typeID: 34, flagID: 4, quantity: 5000, singleton: 0},
    {typeID: 785, flagID: 4, quantity: -1, singleton: 1},
    {typeID: 35, flagID: 5, quantity: 9000, singleton: 0},
  ]};
  const held = heldAt({items, ownerID: 1000129, stationID: 60000682});
  assert.equal(held[34], 5000);
  assert.equal(held[785], 1);
  assert.equal(held[35], undefined, 'another hangar flag is not this station hangar');
});

test('the lift will not take material the corporation still needs at home', () => {
  const stacks = [{itemID: 1, typeID: 35, quantity: 3000}];
  const buys = [{station_id: 60000682, type_id: 35, price: 15.13, vol_remaining: 500000,
    source: 'seed', order_id: '9001'}];
  const planned = planLift({stacks, buys, stationID: 60000682, cap: 1e6, demand: null,
    reserve: {35: 900}});
  assert.equal(planned.length, 1);
  assert.equal(planned[0].quantity, 2100, 'the factory keeps 900 units at home');
  const nothing = planLift({stacks: [{itemID: 1, typeID: 35, quantity: 800}], buys,
    stationID: 60000682, cap: 1e6, demand: null, reserve: {35: 900}});
  assert.deepEqual(nothing, [], 'a short stack is not shipped at all');
});
