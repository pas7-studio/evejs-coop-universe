import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';

// Measured on the work stack 2026-10-27: the hauler sat 37 km - 150 km from its own
// miner, the range GREW between retries, and every attempt still reported
// "living-haul-approach-issued". The orbit order never warps, so from 150 km the
// 2 500 m transfer range was unreachable, and a refused order was invisible because
// its result was dropped. This pins the generator that emits that block.
const root = path.dirname(fileURLToPath(import.meta.url));
const generator = fs.readFileSync(path.join(root, '..', 'scripts', 'patch-evejs-coop.cjs'), 'utf8');

test('a distant hauler is warped to the miner before it is put on orbit', () => {
  assert.ok(generator.includes('npcRuntime.warpToEntity(haulerID, minerID'),
    'the approach must warp to the miner entity, not only orbit it');
  assert.ok(generator.includes('gap > 10000'),
    'the warp is chosen by real measured distance');
});

test('a refused native order is reported, never assumed to have worked', () => {
  for (const marker of ['WARPED_TO_MINER', 'WARP_REFUSED', 'ORBIT_REFUSED', 'nativeReason'])
    assert.ok(generator.includes(marker), 'missing outcome marker ' + marker);
  assert.ok(generator.includes('...approach'),
    'the telemetry must carry the measured outcome');
});

test('the swallowed-result form cannot come back', () => {
  assert.equal(generator.includes('if (typeof npcRuntime.orbit === "function") npcRuntime.orbit(haulerID, minerID, 500);'),
    false, 'an orbit order whose result is discarded hid the stall for hours');
});

test('the approach stays rare enough for a real warp to finish', () => {
  assert.ok(generator.includes('attempts === 1 || attempts % 24 === 0'),
    're-issuing faster than a warp restarts the very approach it waits for');
});
