import test from 'node:test';
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';

// The mining loop's telemetry used to be four inline blobs of up to 968
// characters inside string hooks: untestable and impossible to review. The shapes
// now live in integration/coopMiningTrace.cjs and this test pins them.
const require = createRequire(import.meta.url);
process.env.EVEJS_COOP_MINING_TRACE = '1';

const probePath = require.resolve('../integration/coopRuntimeProbe.cjs');
const observed = [];
require.cache[probePath] = {
  id: probePath,
  filename: probePath,
  loaded: true,
  exports: {observe: (name, _a, context, detail) => observed.push({name, context, detail})},
};
const trace = require('../integration/coopMiningTrace.cjs');

function take(name){
  const found = observed.filter((entry)=>entry.name === 'living-mining-blocker' && entry.detail.reason === name);
  return found[found.length - 1];
}

const scene = {
  systemID: 30000144,
  getEntityByID(id){
    if (id !== 980000016052) return null;
    return {
      mode: 'ORBIT',
      capacitorChargeRatio: 0.5,
      capacitorCapacity: 900,
      capacitorRechargeRate: 187500,
      capacitorRechargedAtMs: 1700000000000,
      transient: false,
      conditionState: {charge: 0.5},
      activeModuleEffects: new Map([[1, {}], [2, {}]]),
    };
  },
};

test('the fleet snapshot keeps its compact one-line ship format', ()=>{
  trace.noteFleetPostTick({fleetID: 960004641, state: 'mining', minerEntityIDs: [980000016052]}, scene);
  const event = take('FLEET_POST_TICK');
  assert.ok(event, 'no FLEET_POST_TICK event');
  assert.equal(event.detail.fleetID, 960004641);
  assert.equal(event.detail.systemID, 30000144);
  assert.equal(event.detail.state, 'mining');
  assert.match(event.detail.miners, /^980000016052\|ORBIT\|act2\|cap0\.5\|capmax900\|tau187500\|reAt1700000000000\|tr0\|ctl/);
  assert.match(event.detail.miners, /\|st0\.5$/);
});

test('an activation failure carries the fields that explain it', ()=>{
  trace.noteActivationFailure(
    {fleetID: 960004642},
    scene,
    {itemID: 42, capacitorCapacity: 625, capacitorChargeRatio: 0.02, nativeNpc: true, session: null},
    {moduleItem: {itemID: 77, typeID: 17482, locationID: 42}},
    {errorMsg: 'NOT_ENOUGH_CAPACITOR'},
  );
  const event = take('MODULE_ACTIVATE_FAILED');
  assert.equal(event.detail.errorMsg, 'NOT_ENOUGH_CAPACITOR');
  assert.equal(event.detail.typeID, 17482);
  assert.equal(event.detail.native, true);
  assert.equal(event.detail.hasSession, false);
  assert.equal(event.detail.ratio, 0.02);
});

test('a target observation carries module and effect counts', ()=>{
  const calls = [];
  trace.noteTargetSelected(
    {fleetID: 960004643},
    scene,
    {itemID: 980000016052, activeModuleEffects: new Map([[1, {}]])},
    {itemID: 5020484739081},
    [1],
    {
      getNpcFittedModuleItems: (entity) => { calls.push(['fitted', entity && entity.itemID]); return [1]; },
      // The mining loop's hook is scene-bound and takes exactly two arguments;
      // passing a scene in front of it silently returns a nonsense distance.
      getSurfaceDistance: (...args) => { calls.push(['distance', args.length, args[0] && args[0].itemID, args[1] && args[1].itemID]); return 1032.4; },
    },
  );
  const event = take('MINER_TARGET');
  assert.equal(event.detail.targetID, 5020484739081);
  assert.equal(event.detail.modules, 1);
  assert.equal(event.detail.activeEffects, 1);
  assert.equal(event.detail.distance, 1032);
  assert.deepEqual(calls, [
    ['fitted', 980000016052],
    ['distance', 2, 980000016052, 5020484739081],
  ]);
});

test('a belt with no free rock says so explicitly', ()=>{
  trace.noteNoMineableTarget(
    {fleetID: 960004644, activeAsteroidID: 0},
    scene,
    {itemID: 42},
    [],
    new Map(),
  );
  const event = take('NO_MINEABLE_TARGET');
  assert.equal(event.detail.rocks, 0);
  assert.equal(event.detail.claims, 0);
  assert.equal(event.detail.activeAsteroidID, 0);
});

test("a target mismatch names both ids", ()=>{
  trace.noteTargetMismatch(
    {fleetID: 960004645},
    scene,
    {itemID: 980000016052},
    {moduleItem: {itemID: 77}},
    {targetID: 5020484739000},
    {itemID: 5020484739081},
  );
  const event = take("MODULE_TARGET_MISMATCH");
  assert.ok(event, "no MODULE_TARGET_MISMATCH event");
  assert.equal(event.detail.effectTargetID, 5020484739000);
  assert.equal(event.detail.fleetTargetID, 5020484739081);
  assert.equal(event.detail.moduleID, 77);
});

test("one think emits both the tick marker and the fleet snapshot", ()=>{
  trace.noteTick({fleetID: 960004646, state: "mining", activeAsteroidID: 5020484739080, minerEntityIDs: [980000016052]}, scene, 1700000000000, 120000);
  const tick = take("TICK_mining");
  assert.ok(tick, "no TICK_mining event");
  assert.equal(tick.detail.activeAsteroidID, 5020484739080);
  assert.equal(tick.detail.nextThinkInMs, 120000);
  const snapshot = take("FLEET_POST_TICK");
  assert.ok(snapshot, "noteTick must also emit the fleet snapshot");
  assert.match(snapshot.detail.miners, /^980000016052\|ORBIT\|act2/);
});

test("a stopped mining module is reported with the caller reason", ()=>{
  const entity = {nativeNpc: true, itemID: 980000016144, activeModuleEffects: new Map([[77, {moduleID: 77, miningEffect: true, startedAtMs: Date.now() - 900}]])};
  trace.noteModuleStop({systemID: 30000144}, entity, 77, "state", "session");
  const stop = take("MODULE_STOP_SESSION");
  assert.ok(stop, "no MODULE_STOP_SESSION event");
  assert.equal(stop.detail.stopReason, "state");
  assert.equal(stop.detail.mining, true);
  assert.equal(stop.detail.shipID, 980000016144);
});

test("a stop for a hull without that effect, or for a player ship, is not reported", ()=>{
  const before = observed.length;
  trace.noteModuleStop({systemID: 30000144}, {nativeNpc: true, itemID: 1, activeModuleEffects: new Map()}, 77, "state", "session");
  trace.noteModuleStop({systemID: 30000144}, {itemID: 2, activeModuleEffects: new Map([[77, {miningEffect: true}]])}, 77, "state", "session");
  assert.equal(observed.length, before);
});
