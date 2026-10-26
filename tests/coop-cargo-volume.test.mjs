import test from 'node:test';
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';

const require = createRequire(import.meta.url);
const cargoVolume = require('../integration/coopCargoVolume.cjs');

// Measured live: after a restart the fleet sat in state "mining" with 333 907 units of
// ore on one Hulk and never dispatched a hauler, because the stored cargo projection
// has no `volume` field and getNpcOreCargoVolume() therefore returned 0.
const resolveType = (typeID) => (typeID === 34 ? {typeID, volume: 0.1} : null);

test('the default is off and nothing is touched', () => {
  const entry = {itemID: 1, typeID: 34, quantity: 100};
  cargoVolume.ensure(entry, {env: {}, resolveType});
  assert.equal(entry.volume, undefined);
});

test('a projected entry gets the real volume of its own ore type', () => {
  const entry = {itemID: 1, typeID: 34, quantity: 100};
  cargoVolume.ensure(entry, {env: {EVEJS_COOP_CARGO_VOLUME_FALLBACK: '1'}, resolveType});
  assert.equal(entry.volume, 0.1);
  assert.equal(entry.stacksize, 100);
  assert.equal(100 * entry.volume, 10, 'one hundred units of veldspar is 10 m3');
});

test('an entry that already has a volume is never rewritten', () => {
  const entry = {itemID: 1, typeID: 34, quantity: 100, volume: 0.15};
  cargoVolume.ensure(entry, {env: {EVEJS_COOP_CARGO_VOLUME_FALLBACK: '1'}, resolveType});
  assert.equal(entry.volume, 0.15, 'a recorded volume is the truth, not the SDE default');
});

test('an unknown or invalid type is left alone', () => {
  const entry = {itemID: 1, typeID: 999, quantity: 100};
  cargoVolume.ensure(entry, {env: {EVEJS_COOP_CARGO_VOLUME_FALLBACK: '1'}, resolveType});
  assert.equal(entry.volume, undefined);
  const noType = {itemID: 2, quantity: 5};
  assert.doesNotThrow(() => cargoVolume.ensure(noType, {env: {EVEJS_COOP_CARGO_VOLUME_FALLBACK: '1'}, resolveType}));
  assert.equal(noType.volume, undefined);
  assert.equal(cargoVolume.ensure(null, {env: {EVEJS_COOP_CARGO_VOLUME_FALLBACK: '1'}, resolveType}), null);
});

test('a throwing resolver never breaks the mining tick', () => {
  const entry = {itemID: 1, typeID: 34, quantity: 100};
  cargoVolume.ensure(entry, {
    env: {EVEJS_COOP_CARGO_VOLUME_FALLBACK: '1'},
    resolveType: () => { throw new Error('SDE down'); },
  });
  assert.equal(entry.volume, undefined);
});

test('the quantity is never changed by this annotation', () => {
  const entry = {itemID: 1, typeID: 34, quantity: 7, ownerID: 1234, locationID: 9};
  cargoVolume.ensure(entry, {env: {EVEJS_COOP_CARGO_VOLUME_FALLBACK: '1'}, resolveType});
  assert.deepEqual({...entry}, {itemID: 1, typeID: 34, quantity: 7, ownerID: 1234,
    locationID: 9, volume: 0.1, stacksize: 7});
});
