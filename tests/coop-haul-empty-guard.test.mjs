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
  assert.match(block, /fleetRecord\.state = "mining";/);
  assert.match(block, /fleetRecord\.nextThinkAtMs = now \+ 2000;/);
});

test('the empty-haul retry is observable, not silent', () => {
  assert.match(block, /living-haul-empty-retry/);
});

test('a real haul still becomes loaded and holds before the trip', () => {
  assert.match(block, /fleetRecord\.state = "loaded";/);
  assert.match(block, /EVEJS_COOP_HAULER_HOLD_MS/);
});
