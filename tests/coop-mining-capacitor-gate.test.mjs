import test from 'node:test';
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';

const require = createRequire(import.meta.url);
const gate = require('../integration/coopMiningCapacitorGate.cjs');

// Measured: hulls sat at 1-2% capacitor while the recharge advance added its
// correct ~0.006/s; retrying activation kept draining it, so the ship could never
// reach the 23 GJ module cost and no ore was ever produced.
test('a native miner below the module cost waits instead of retrying', ()=>{
  const hull = {kind: 'ship', nativeNpc: true, capacitorCapacity: 900, capacitorChargeRatio: 0.01};
  assert.equal(gate.capacitorAmountGj(hull), 9);
  assert.equal(gate.shouldWait(hull, 30), true);
});

test('a native miner with enough capacitor proceeds', ()=>{
  const hull = {kind: 'ship', nativeNpc: true, capacitorCapacity: 900, capacitorChargeRatio: 0.5};
  assert.equal(gate.shouldWait(hull, 30), false);
});

test('player ships and session ships are never gated', ()=>{
  const player = {kind: 'ship', capacitorCapacity: 900, capacitorChargeRatio: 0.01};
  assert.equal(gate.shouldWait(player, 30), false, 'a player ship must never be gated');
  const sessionNpc = {kind: 'ship', nativeNpc: true, session: {characterID: 1}, capacitorCapacity: 900, capacitorChargeRatio: 0.01};
  assert.equal(gate.shouldWait(sessionNpc, 30), false, 'an owned NPC is handled by the session tick');
});

test('a broken entity is reported, not treated as ready', ()=>{
  assert.equal(gate.shouldWait(null, 30), false);
  assert.equal(gate.shouldWait({kind: 'ship', nativeNpc: true}, 30), true);
  const reason = gate.why({itemID: 42, capacitorCapacity: 625, capacitorChargeRatio: 0.02}, 30);
  assert.deepEqual(reason, {entityID: 42, capacityGj: 625, ratio: 0.02, amountGj: 12.5, requiredGj: 30});
});
