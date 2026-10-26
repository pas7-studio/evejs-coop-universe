import test from 'node:test';
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import {readFileSync} from 'node:fs';
import {fileURLToPath} from 'node:url';
import {dirname, join} from 'node:path';

// L1 runs before the overlay. A file changed by a pinned patch is the baseline the
// overlay installs on, not drift. Before this rule, adding L1 0006 to runtime.js
// made the installer refuse the whole overlay with OVERLAY_DRIFT even though every
// patch hash had been verified.
const require = createRequire(import.meta.url);
const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const overlay = require('../scripts/patch-evejs-coop.cjs');
const manifest = JSON.parse(readFileSync(join(root, 'patches/upstream/MANIFEST.json'), 'utf8'));

test('every L1 patch target is recognised as an overlay baseline', ()=>{
  const covered = overlay.l1CoveredFiles();
  const targets = new Set();
  for (const entry of manifest.patches || []) {
    for (const file of entry.files || []) targets.add(file);
  }
  assert.ok(targets.size > 0, 'manifest lists no targets');
  for (const target of targets) {
    assert.ok(covered.has(target), `L1 target not allowed as a baseline: ${target}`);
  }
});

test('the patch series is what the manifest declares', ()=>{
  const files = (manifest.patches || []).map((entry) => entry.file).sort();
  assert.deepEqual(files, [
    '0001-native-npc-store-export-list-cargo.patch',
    '0002-native-npc-capacitor-recharge.patch',
    '0003-native-npc-sessionless-capacitor.patch',
    '0004-native-mining-fleet-retained-actor.patch',
    '0005-native-npc-durable-not-dormant.patch',
    '0006-native-npc-live-capacitor-wins.patch',
  ]);
});
