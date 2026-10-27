import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {createRequire} from 'node:module';

const require = createRequire(import.meta.url);
const modulePath = path.join('C:', 'Games', 'EveCoop', 'upstream-evejs', 'Code', 'server',
  'src', 'space', 'coopNpcRunawayGoto.js');
const present = fs.existsSync(modulePath);
const mod = present ? require(modulePath) : null;

// Measured on the work stack 2026-10-27: a mining miner and its hauler both sat in mode
// GOTO with targetPoint ~1.0e16 m away while their belt was 28-54 km away. GOTO in this
// engine flies along entity.direction only, so nothing could ever stop them and the
// hauler never reached the 2 500 m transfer range.
function hull(overrides = {}) {
  return {
    subKind: 'ship',
    nativeNpc: true,
    mode: 'GOTO',
    speedFraction: 1,
    position: {x: -348510890556, y: 10167459476, z: 94674468561},
    targetPoint: {x: 8194559295673362, y: -683048013736806, z: -5689977167160013},
    velocity: {x: 10, y: 0, z: 0},
    targetEntityID: 0,
    ...overrides,
  };
}

test('a native NPC flying at the straight-line sentinel is stopped', {skip: !present}, () => {
  const entity = hull();
  assert.equal(mod.apply(entity), true);
  assert.equal(entity.mode, 'STOP');
  assert.equal(entity.speedFraction, 0);
  assert.deepEqual(entity.velocity, {x: 0, y: 0, z: 0});
  assert.deepEqual(entity.targetPoint, entity.position);
});

test('a real in-system destination is left alone', {skip: !present}, () => {
  const entity = hull({targetPoint: {x: -348510890556 + 54_000, y: 10167459476, z: 94674468561}});
  assert.equal(mod.apply(entity), false);
  assert.equal(entity.mode, 'GOTO');
});

test('a player ship keeps its own straight-line command', {skip: !present}, () => {
  const entity = hull({nativeNpc: false});
  assert.equal(mod.apply(entity), false);
  assert.equal(entity.mode, 'GOTO');
});

test('only GOTO is touched', {skip: !present}, () => {
  const entity = hull({mode: 'FOLLOW'});
  assert.equal(mod.apply(entity), false);
  assert.equal(entity.mode, 'FOLLOW');
});

test('the hook sits inside the native movement step', {skip: !present}, () => {
  const runtime = fs.readFileSync(path.join(path.dirname(modulePath), 'runtime.js'), 'utf8');
  const gotoCase = runtime.indexOf('    case "GOTO":');
  const hook = runtime.indexOf('require("./coopNpcRunawayGoto").apply(entity)');
  const advance = runtime.indexOf('return advanceGotoMovement(entity, deltaSeconds);');
  assert.ok(gotoCase > 0, 'the movement switch must still have a GOTO case');
  assert.ok(hook > gotoCase, 'the co-op guard must be inside the GOTO case');
  assert.ok(advance > hook, 'the guard runs before the straight-line advance');
});
