import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';

// The haul transition is generated into the stock mining file by our L2 patcher, so
// a regression here is invisible until a fleet flies to a station with nothing
// aboard. Measured on the work stack: lastHauledVolumeM3 0 while the state still
// became "loaded", and living-native-haul-delivered repeated NO_CARGO.
const root = path.dirname(fileURLToPath(import.meta.url));
const patcher = fs.readFileSync(path.join(root, '..', 'scripts', 'patch-evejs-coop.cjs'), 'utf8');
const block = patcher.slice(patcher.indexOf("'  if (process.env.EVEJS_COOP_NATIVE_HAUL_CARGO === \"1\") {'"),
  patcher.indexOf("const loadedHandler="));

test('a haul that moved no cargo never becomes a loaded fleet', () => {
  assert.match(block, /if \(!\(hauledVolumeM3 > 0\)\) \{/);
  // The retry must NOT restart the warp every few seconds: the hauler would never
  // close the distance (measured: 99 528 m forever while mining restarted the haul).
  assert.match(block, /fleetRecord\.state = "hauling";/);
  assert.match(block, /fleetRecord\.haulCompleteAtMs = now \+ 5000;/);
});

test('an unproductive haul is only re-issued after a bounded number of waits', () => {
  assert.match(block, /coopEmptyHaulAttempts/);
  // Measured 2026-10-27: at 5 s per think, 24 waits is two minutes - shorter than the
  // sub-warp approach the hauler actually needs (24-90 km), so the fleet re-entered
  // mining before the hull could ever arrive.
  assert.match(block, /if \(attempts >= 120\) \{/);
  assert.match(block, /living-haul-empty-reissue/);
});

test('a far hauler is ordered to the miner itself, never left on an orbit label', () => {
  // Landing 750 m from the rock while the miner orbits kilometres away means the
  // 2 500 m transfer range is never reached (measured: ranges 24 km - 150 km). A warp
  // to a target that close answers WARP_DISTANCE_TOO_CLOSE, so the fallback must be a
  // real follow order and the outcome must be published.
  assert.match(block, /living-haul-approach-issued/);
  assert.match(block, /npcRuntime\.follow\(haulerID, minerID, 500\)/);
  assert.match(block, /attempts === 1 \|\| attempts % 24 === 0/);
});

test('a successful load clears the retry counter', () => {
  const reset = block.indexOf('fleetRecord.coopEmptyHaulAttempts = 0;');
  const loaded = block.indexOf("fleetRecord.state = \"loaded\";");
  assert.ok(reset > 0 && loaded > reset, 'the counter is cleared before the fleet is loaded');
});

test('the empty-haul retry is observable, not silent', () => {
  assert.match(block, /living-haul-empty-retry/);
});

test('a real haul still becomes loaded and holds before the trip', () => {
  assert.match(block, /fleetRecord\.state = "loaded";/);
  assert.match(block, /EVEJS_COOP_HAULER_HOLD_MS/);
});
