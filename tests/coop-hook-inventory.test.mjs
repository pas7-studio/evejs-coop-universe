import test from 'node:test';
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import {readFileSync} from 'node:fs';
import {fileURLToPath} from 'node:url';
import {dirname, join} from 'node:path';

// The deploy path edits the pinned checkout three ways: L1 patches, the overlay
// spec, and hand-written coop-*-patch.cjs transformers. This test freezes the
// measured size of that debt so it can only shrink. Adding a new mechanism, or
// letting a hook turn back into an inline program, fails here before it ships.
const require = createRequire(import.meta.url);
const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const {inventory} = require('../scripts/coop-hook-inventory.cjs');
const baseline = JSON.parse(readFileSync(join(root, 'docs/coop-hook-inventory.json'), 'utf8'));

const current = inventory();

test('the number of legacy patch transformers does not grow', ()=>{
  assert.ok(
    current.legacyFiles <= baseline.legacyFiles,
    `legacy transformers ${baseline.legacyFiles} -> ${current.legacyFiles}: new behaviour belongs in the spec or an L1 patch`,
  );
  assert.ok(
    current.wiredModules <= baseline.wiredModules,
    `wired transformers ${baseline.wiredModules} -> ${current.wiredModules}`,
  );
});

test('a hook longer than 400 characters is a module that has not been extracted yet', ()=>{
  assert.ok(
    current.longHooks <= Number(baseline.longHooks),
    `long hooks ${baseline.longHooks} -> ${current.longHooks}: move the logic into integration/* and call it`,
  );
  // The mining loop is the file we just finished cleaning; it must stay clean.
  const spec = require('../scripts/overlay-spec.cjs');
  const mining = (spec.specs || []).find((block) => /mining\/miningNpcOperations\.js/.test(block.file));
  assert.ok(mining, 'mining spec block missing');
  for (const entry of mining.patches || []) {
    assert.ok(
      String(entry.line || '').length <= 400,
      'mining hook is ' + String(entry.line || '').length + ' characters: ' + String(entry.line || '').slice(0, 80),
    );
  }
});

test('the recorded baseline matches the repository today', ()=>{
  assert.equal(current.specEntries, baseline.specEntries, 'spec entries changed: refresh the baseline deliberately');
  assert.equal(current.specFiles, baseline.specFiles, 'spec file count changed: refresh the baseline deliberately');
  assert.equal(current.overlap, baseline.overlap, 'two mechanisms now edit the same file: migrate one of them first');
});
