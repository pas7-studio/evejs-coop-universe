import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';

// Measured on the work stack 2026-10-27: the hauler sat 24 km - 90 km from its own
// miner, every warp answered WARP_DISTANCE_TOO_CLOSE, and the orbit fallback left it
// drifting AWAY (57 km -> 90 km between two retries) while the telemetry still said the
// approach had been issued. This pins the generator that emits that block.
const root = path.dirname(fileURLToPath(import.meta.url));
const generator = fs.readFileSync(path.join(root, '..', 'scripts', 'patch-evejs-coop.cjs'), 'utf8');

test('the hauler is warped only beyond the native warp minimum', () => {
  assert.ok(generator.includes('gap > 150000'),
    '24-90 km is not warpable: every attempt answered WARP_DISTANCE_TOO_CLOSE');
  assert.ok(generator.includes('npcRuntime.warpToEntity(haulerID, minerID'));
});

test('a short approach is a real follow order, not an orbit label', () => {
  assert.ok(generator.includes('npcRuntime.follow(haulerID, minerID, 500)'),
    'a sub-warp approach must follow the moving miner');
  assert.ok(generator.includes('FOLLOWING_MINER'));
});

test('a refused native order is reported, never assumed to have worked', () => {
  for (const marker of ['WARPED_TO_MINER', 'WARP_REFUSED', 'FOLLOW_REFUSED', 'nativeReason'])
    assert.ok(generator.includes(marker), 'missing outcome marker ' + marker);
  assert.ok(generator.includes('...approach'), 'the telemetry must carry the measured outcome');
});

test('the approach stays rare enough for a real approach to finish', () => {
  assert.ok(generator.includes('attempts === 1 || attempts % 24 === 0'),
    're-issuing faster than the approach restarts the very approach it waits for');
});

test('an empty haul is given ten minutes before the fleet re-enters mining', () => {
  assert.ok(generator.includes('attempts >= 120'),
    'two minutes is shorter than a 90 km sub-warp approach');
  assert.equal(generator.includes('attempts >= 24'), false,
    'the 24-wait budget re-armed the haul before the hauler could arrive');
});
