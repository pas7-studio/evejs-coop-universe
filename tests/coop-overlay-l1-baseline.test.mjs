import test from 'node:test';
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import {readFileSync, readdirSync} from 'node:fs';
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

// The manifest is the declaration, so copying its file list into this test only
// creates a second place to forget. The invariants that actually matter are: the
// declared series is exactly what sits on disk, it is numbered without gaps, and
// every entry still carries the hash the repo pins it by.
test('the patch series is what the manifest declares', ()=>{
  const declared = (manifest.patches || []).map((entry) => entry.file).sort();
  const onDisk = readdirSync(join(root, 'patches/upstream'))
    .filter((name) => name.endsWith('.patch')).sort();
  assert.deepEqual(declared, onDisk, 'manifest and patches/upstream disagree');

  declared.forEach((name, index) => {
    assert.equal(name.slice(0, 4), String(index + 1).padStart(4, '0'),
      `${name} is out of sequence`);
  });
  for (const entry of manifest.patches || []) {
    assert.match(entry.sha256 || '', /^[0-9a-f]{64}$/, `${entry.file} has no pinned sha256`);
    assert.ok((entry.files || []).length > 0, `${entry.file} declares no targets`);
  }
});
