import test from 'node:test';
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';

const require = createRequire(import.meta.url);
const composition = require('../integration/coopFleetComposition.cjs');

// A fleet must not be one hull repeated. The live bug: every durable "hauler" slot
// was a Mining Venture (50 m3) while miners were Skiffs and Hulks, so ore could
// never move. The choice is now per role, per tier, and tied to the corporation's
// own wallet.
test('the default is off and never overrides the pinned spawner', () => {
  assert.equal(composition.query('miner', {env: {}}), '');
  assert.equal(composition.query('hauler', {env: {}}), '');
});

test('a poor corporation flies T1 hulls', () => {
  assert.equal(composition.tierFor(0), 't1');
  assert.equal(composition.tierFor(249_999_999), 't1');
});

test('a corporation that has earned real ISK upgrades to T2', () => {
  assert.equal(composition.tierFor(250_000_000), 't2');
});

test('haulers are real industrial hulls, never the miner pool', () => {
  const t1 = composition.HULLS.hauler.t1;
  const t2 = composition.HULLS.hauler.t2;
  assert.ok(t1.includes('ore_mining_badger_hauler'));
  assert.ok(t2.includes('ore_mining_occator_hauler'));
  for (const hull of [...t1, ...t2]) {
    assert.match(hull, /_hauler$/, hull + ' must be a hauler profile');
    assert.ok(!/venture|retriever|skiff|hulk/.test(hull), hull + ' is a mining barge');
  }
});

test('miner tiers stay inside their own class', () => {
  assert.deepEqual([...composition.HULLS.miner.t1], ['ore_mining_venture', 'ore_mining_retriever']);
  assert.deepEqual([...composition.HULLS.miner.t2], ['ore_mining_skiff', 'ore_mining_hulk']);
});

test('the roll picks one hull of the tier and clamps bad input', () => {
  assert.equal(composition.pickHull('hauler', 't1', 0), 'ore_mining_bestower_hauler');
  assert.equal(composition.pickHull('hauler', 't1', 0.999), 'ore_mining_mammoth_hauler');
  assert.equal(composition.pickHull('hauler', 't1', 7), 'ore_mining_mammoth_hauler');
  assert.equal(composition.pickHull('hauler', 't1', -3), 'ore_mining_bestower_hauler');
  assert.equal(composition.pickHull('unknown', 't1', 0), null);
});

test('the fleet budget is the corporation wallet, not a pilot ledger', () => {
  const wallet = composition.readCorpWallet({
    gameStore: {
      read(table, pointer) {
        assert.equal(table, 'corporationRuntime');
        assert.equal(pointer, '/corporations/1000129/wallet');
        return {success: true, data: {divisions: {1000: {balance: 120_000_000}, 1001: {balance: 5_000_000}}}};
      },
    },
    corporationID: 1000129,
  });
  assert.equal(wallet.status, 'OK');
  assert.equal(wallet.budgetISK, 125_000_000);
});

test('an unreadable wallet means T1, never a guess', () => {
  const wallet = composition.readCorpWallet({gameStore: {}, corporationID: 1000129});
  assert.equal(wallet.status, 'STORE_UNAVAILABLE');
  assert.equal(wallet.budgetISK, 0);
  assert.equal(composition.tierFor(wallet.budgetISK), 't1');
});

test('with the flag on, each role gets its own hull from the wallet tier', () => {
  const env = {EVEJS_COOP_FLEET_COMPOSITION: '1', EVEJS_COOP_MINING_CORP_ID: '1000129'};
  const gameStore = {
    read: () => ({success: true, data: {divisions: {1000: {balance: 900_000_000}}}}),
  };
  const miner = composition.query('miner', {env, gameStore, roll: () => 0});
  const hauler = composition.query('hauler', {env, gameStore, roll: () => 0});
  assert.equal(miner, 'ore_mining_skiff');
  assert.equal(hauler, 'ore_mining_bustard_hauler');
  assert.notEqual(miner, hauler, 'a mining hull must never be used as the hauler');
});
