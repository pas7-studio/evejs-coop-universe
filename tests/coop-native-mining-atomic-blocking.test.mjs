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

test('a fractional cycle boundary is rounded, not rejected', ()=>{
  process.env.EVEJS_COOP_NATIVE_MINING_CYCLE_ATOMIC = '1';
  process.env.EVEJS_COOP_NATIVE_ATOMIC_ROWS = '1';
  process.env.EVEJS_COOP_NATIVE_MINING_CARGO_INTEGRITY = '1';
  process.env.EVEJS_COOP_NATIVE_MINING_CYCLE_CONSERVATION = '1';
  const entity = hull();
  const rock = {itemID: 5020484726789};
  const scene = {systemID: 30000144, getEntityByID: (id) => (id === rock.itemID ? rock : null)};
  const result = settler.settle({
    entity,
    scene,
    targetEntity: rock,
    mineableState: {remainingQuantity: 100, yieldTypeID: 1230},
    miningResult: {normalQuantity: 10, wastedQuantity: 0},
    transferredQuantity: 10,
    cycleBoundaryMs: 1793031234567.5,
    moduleItem: {itemID: 77},
    commitScene: () => true,
    readState: () => ({remainingQuantity: 90, yieldTypeID: 1230}),
  });
  assert.notEqual(result.reason, 'ALIFE07_YIELD_INVALID:cycleBoundaryMs');
  delete process.env.EVEJS_COOP_NATIVE_MINING_CYCLE_ATOMIC;
  delete process.env.EVEJS_COOP_NATIVE_ATOMIC_ROWS;
  delete process.env.EVEJS_COOP_NATIVE_MINING_CARGO_INTEGRITY;
  delete process.env.EVEJS_COOP_NATIVE_MINING_CYCLE_CONSERVATION;
});

test('a block that provably happened before any write is cleared', ()=>{
  const entity = hull();
  entity.coopMiningCargoNeedsOperatorRepair =
    'ALIFE07_ATOMIC_COMMIT_UNKNOWN_OR_REJECTED:NATIVE_TRANSIENT_STATE_UNSAFE:npcCargo';
  entity.coopMiningCargoLastError = entity.coopMiningCargoNeedsOperatorRepair;
  settler.settle({entity});
  assert.equal(entity.coopMiningCargoNeedsOperatorRepair, undefined,
    'a pre-mutation refusal must not block the hull forever');
});

test('an uncertain custody block is never cleared automatically', ()=>{
  const entity = hull();
  entity.coopMiningCargoNeedsOperatorRepair = 'ALIFE07_POSTCOMMIT_SCENE_DIVERGED';
  settler.settle({entity});
  assert.equal(entity.coopMiningCargoNeedsOperatorRepair, 'ALIFE07_POSTCOMMIT_SCENE_DIVERGED');
});

test("a store refusal before the transaction never marks the hull for repair", ()=>{
  for (const flag of ["EVEJS_COOP_NATIVE_MINING_CYCLE_ATOMIC", "EVEJS_COOP_NATIVE_ATOMIC_ROWS",
    "EVEJS_COOP_NATIVE_MINING_CARGO_INTEGRITY", "EVEJS_COOP_NATIVE_MINING_CYCLE_CONSERVATION"]){
    process.env[flag] = "1";
  }
  const failing = atomic.createAtomicMiningSettler({
    gameStore: {coopAtomicNativeRows: {transact(){ throw new Error("NATIVE_TRANSIENT_STATE_UNSAFE:npcCargo"); }}},
    nativeStore: {allocateCargoID: () => ({success: true, data: 980200000077}), listNativeCargoForEntity: () => []},
    resolveType: (id) => ({typeID: id, groupID: 465, categoryID: 25, name: "Veldspar", volume: 0.1}),
  });
  const entity = hull();
  const rock = {itemID: 5020484726789, yieldTypeID: 1230, remainingQuantity: 1000};
  const result = failing.settle({
    scene: {systemID: 30000144, getEntityByID: (id) => (id === rock.itemID ? rock : null)},
    entity,
    targetEntity: rock,
    mineableState: {entityID: rock.itemID, yieldTypeID: 1230, originalQuantity: 1000, remainingQuantity: 1000},
    miningResult: {normalQuantity: 10, wastedQuantity: 0},
    transferredQuantity: 10,
    cycleBoundaryMs: 1793031234567,
    moduleItem: {itemID: 77},
    readState: () => ({remainingQuantity: 1000, yieldTypeID: 1230}),
    commitScene: () => ({success: true}),
  });
  assert.equal(result.success, false);
  assert.match(String(result.reason), /NATIVE_TRANSIENT_STATE_UNSAFE/);
  assert.equal(entity.coopMiningCargoNeedsOperatorRepair, undefined,
    "a pre-transaction refusal must not poison the hull");
  assert.match(String(entity.coopMiningCargoLastError), /NATIVE_TRANSIENT_STATE_UNSAFE/);
  for (const flag of ["EVEJS_COOP_NATIVE_MINING_CYCLE_ATOMIC", "EVEJS_COOP_NATIVE_ATOMIC_ROWS",
    "EVEJS_COOP_NATIVE_MINING_CARGO_INTEGRITY", "EVEJS_COOP_NATIVE_MINING_CYCLE_CONSERVATION"]){
    delete process.env[flag];
  }
});
