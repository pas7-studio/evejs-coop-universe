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
  // A one-shot scene follow loses to the NPC behaviour loop: measured mode FOLLOW with
  // speedFraction 1 and a frozen 3 221 m gap across dozens of attempts.
  assert.ok(generator.includes('npcService.issueManualOrder(haulerID, {type: "follow"'),
    'a sub-warp approach must be a manual follow order the NPC loop honours');
  assert.ok(generator.includes('FOLLOWING_MINER'));
});

test('the follow order is re-issued every attempt while only the warp stays rare', () => {
  // Measured 2026-10-27: the miners were parked between attempts and something
  // re-accelerated them onto a straight full-throttle line, so a follow issued once per
  // two minutes lost the race every time (gaps 27.9 km and 78.9 km on two fleets).
  assert.ok(generator.includes('const rareRetry = attempts === 1 || attempts % 24 === 0;'),
    'the warp keeps its rare gate');
  assert.ok(generator.includes('if (rareRetry && !haulerWarping && gap !== null && gap > 150000'),
    'only the warp is gated by the rare retry');
  assert.ok(generator.includes('status: "ALREADY_WARPING"'),
    'a hauler mid-warp must not be re-commanded');
  const followAt = generator.indexOf('npcRuntime.follow(haulerID, minerID, 500)');
  const gateAt = generator.indexOf('const rareRetry =');
  assert.ok(followAt > gateAt && gateAt > 0, 'the follow sits outside the rare gate body');
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
