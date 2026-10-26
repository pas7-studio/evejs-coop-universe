import test from 'node:test';
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';

const require = createRequire(import.meta.url);
// Works with both the repo layout (integration/*.cjs) and the installed .js tree.
const atomic = require('../integration/coopNativeMiningAtomic.cjs');

const settler = atomic.createAtomicMiningSettler({
  gameStore: {},
  nativeStore: {},
  resolveType: () => null,
});

function hull(){
  return {itemID: 980000016144, nativeNpc: true, transient: false, ownerID: 1};
}

test('a configuration refusal never marks the hull for operator repair', ()=>{
  const entity = hull();
  const result = settler.settle({entity});
  assert.equal(result.success, false);
  assert.match(String(result.reason), /ALIFE07_(ATOMIC_FLAGS_REQUIRED|PERSISTENT_NPC_REQUIRED|YIELD_INVALID)/);
  assert.equal(entity.coopMiningCargoNeedsOperatorRepair, undefined);
  assert.ok(entity.coopMiningCargoLastError, 'the refusal is still visible on the entity');
});

test('an uncertain custody block keeps the first reason when it blocks again', ()=>{
  const entity = hull();
  entity.coopMiningCargoNeedsOperatorRepair = 'ALIFE07_POSTCOMMIT_SCENE_DIVERGED';
  const result = settler.settle({entity});
  assert.equal(result.success, false);
  assert.match(String(result.reason), /ALIFE07_POSTCOMMIT_SCENE_DIVERGED/,
    'the original reason must survive the repair-required short circuit');
  assert.equal(entity.coopMiningCargoNeedsOperatorRepair, 'ALIFE07_POSTCOMMIT_SCENE_DIVERGED');
});

test('an invalid yield names the input that failed', ()=>{
  process.env.EVEJS_COOP_NATIVE_MINING_CYCLE_ATOMIC = '1';
  process.env.EVEJS_COOP_NATIVE_ATOMIC_ROWS = '1';
  process.env.EVEJS_COOP_NATIVE_MINING_CARGO_INTEGRITY = '1';
  process.env.EVEJS_COOP_NATIVE_MINING_CYCLE_CONSERVATION = '1';
  const entity = hull();
  const scene = {systemID: 30000144, getEntityByID: () => null};
  const result = settler.settle({
    entity,
    scene,
    targetEntity: {itemID: 5020484726789},
    mineableState: {remainingQuantity: 100, yieldTypeID: 0},
    miningResult: {normalQuantity: 10, wastedQuantity: 0},
    transferredQuantity: 10,
    cycleBoundaryMs: 1700000000000,
    moduleItem: {itemID: 77},
    commitScene: () => true,
    readState: () => ({remainingQuantity: 90, yieldTypeID: 0}),
  });
  assert.equal(result.success, false);
  assert.equal(result.reason, 'ALIFE07_YIELD_INVALID:oreTypeID',
    'the refusal must name the failing input');
  delete process.env.EVEJS_COOP_NATIVE_MINING_CYCLE_ATOMIC;
  delete process.env.EVEJS_COOP_NATIVE_ATOMIC_ROWS;
  delete process.env.EVEJS_COOP_NATIVE_MINING_CARGO_INTEGRITY;
  delete process.env.EVEJS_COOP_NATIVE_MINING_CYCLE_CONSERVATION;
});
