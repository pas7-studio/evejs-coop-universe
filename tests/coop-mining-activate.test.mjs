import test from 'node:test';
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';

const require = createRequire(import.meta.url);
const activate = require('../integration/coopMiningActivate.cjs');

function scene(record){
  return {
    systemID: 30000144,
    activateGenericModule(...args){
      record.push(args);
      return {success: true};
    },
  };
}

const entry = {moduleItem: {itemID: 77, typeID: 17482}, effectRecord: {name: 'mining'}};
const target = {itemID: 5020484739081};
const fleet = {fleetID: 960004609};

test('a miner without the module cost waits and never touches the scene api', ()=>{
  const calls = [];
  const hull = {kind: 'ship', nativeNpc: true, itemID: 42, capacitorCapacity: 900, capacitorChargeRatio: 0.01};
  const outcome = activate.activate({scene: scene(calls), pseudoSession: {}, minerEntity: hull, entry, targetEntity: target, fleetRecord: fleet, trace: {note(){}, noteActivationFailure(){}}});
  assert.deepEqual(outcome, {attempted: false, reason: 'capacitor-wait'});
  assert.equal(calls.length, 0, 'a waiting miner must not call activateGenericModule');
});

test('a charged miner activates on the fleet target', ()=>{
  const calls = [];
  const hull = {kind: 'ship', nativeNpc: true, itemID: 42, capacitorCapacity: 900, capacitorChargeRatio: 0.5};
  const outcome = activate.activate({scene: scene(calls), pseudoSession: {characterID: 0}, minerEntity: hull, entry, targetEntity: target, fleetRecord: fleet, trace: {note(){}, noteActivationFailure(){}}});
  assert.deepEqual(outcome, {attempted: true, success: true});
  assert.equal(calls.length, 1);
  assert.equal(calls[0][1], entry.moduleItem);
  assert.equal(calls[0][2], 'mining');
  assert.deepEqual(calls[0][3], {targetID: 5020484739081});
});

test('a refused activation is reported, never retried silently', ()=>{
  const reported = [];
  const hull = {kind: 'ship', nativeNpc: true, itemID: 42, capacitorCapacity: 900, capacitorChargeRatio: 0.5};
  const refusing = {
    systemID: 30000144,
    activateGenericModule(){ return {success: false, errorMsg: 'NOT_ENOUGH_CAPACITOR'}; },
  };
  const outcome = activate.activate({
    scene: refusing,
    pseudoSession: {},
    minerEntity: hull,
    entry,
    targetEntity: target,
    fleetRecord: fleet,
    trace: {note(){}, noteActivationFailure(fleetArg, sceneArg, minerArg, entryArg, result){ reported.push(result.errorMsg); }},
  });
  assert.deepEqual(outcome, {attempted: true, success: false});
  assert.deepEqual(reported, ['NOT_ENOUGH_CAPACITOR']);
});

test('a player ship is never gated by the co-op rule', ()=>{
  const calls = [];
  const player = {kind: 'ship', itemID: 42, capacitorCapacity: 900, capacitorChargeRatio: 0.01};
  const outcome = activate.activate({scene: scene(calls), pseudoSession: {}, minerEntity: player, entry, targetEntity: target, fleetRecord: fleet, trace: {note(){}, noteActivationFailure(){}}});
  assert.deepEqual(outcome, {attempted: true, success: true});
  assert.equal(calls.length, 1);
});
