import test from 'node:test';
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';

const require = createRequire(import.meta.url);
const guard = require('../integration/coopMiningTargetGuard.cjs');

function hull(effects){
  return {itemID: 980000016144, nativeNpc: true, activeModuleEffects: new Map(effects)};
}

test('off by default: nothing changes without the flag', ()=>{
  delete process.env[guard.GATE];
  assert.equal(guard.keepTargetLock(hull([[7, {moduleID: 7, miningEffect: true}]])), false);
});

test('a hull with an active mining effect keeps its locks', ()=>{
  process.env[guard.GATE] = '1';
  assert.equal(guard.activeMiningModuleID(hull([[7, {moduleID: 7, miningEffect: true}]])), 7);
  assert.equal(guard.keepTargetLock(hull([[7, {moduleID: 7, miningEffect: true}]])), true);
  delete process.env[guard.GATE];
});

test('a hull with only combat effects still stands down', ()=>{
  process.env[guard.GATE] = '1';
  assert.equal(guard.keepTargetLock(hull([[7, {moduleID: 7, miningEffect: false}]])), false);
  assert.equal(guard.keepTargetLock(hull([])), false);
  assert.equal(guard.keepTargetLock({itemID: 1}), false);
  delete process.env[guard.GATE];
});
