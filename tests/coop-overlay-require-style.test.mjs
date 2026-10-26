import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {createRequire} from 'node:module';

const require = createRequire(import.meta.url);
const root = path.join(path.dirname(new URL(import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1')), '..');
const integrations = path.join(root, 'integration');
const {names} = require('../scripts/overlay-spec.cjs');

// The overlay installs integration/<name>.cjs as server/src/space/<name>.js, so a
// require("./sibling.cjs") inside an installed module resolves to nothing at
// runtime. The failure is invisible: the hook throws, the caller catches it per
// tick, and the feature looks "configured but idle". That is how the mining fleet
// ran for hours with a working controller, charged capacitors and zero activations.
const siblingCjsRequire = /require\("\.\/[A-Za-z][A-Za-z0-9]*\.cjs"\)/;

test('no installed overlay module requires a sibling with a .cjs extension', () => {
  const offenders = [];
  for (const name of names) {
    const file = path.join(integrations, name + '.cjs');
    if (!fs.existsSync(file)) continue;
    const text = fs.readFileSync(file, 'utf8');
    // The adaptive pattern (try "./sibling", fall back to "./sibling.cjs") works in
    // both trees and is allowed. A .cjs-only require cannot resolve once installed.
    for (const match of text.matchAll(/require\("\.\/([A-Za-z][A-Za-z0-9]*)\.cjs"\)/g)) {
      const sibling = match[1];
      if (text.includes('require("./' + sibling + '")')) continue;
      offenders.push(name + ' -> ' + match[0]);
    }
  }
  assert.deepEqual(offenders, [], 'require the sibling without an extension');
});

test('the mining modules load the way the overlay installs them', () => {
  const staging = fs.mkdtempSync(path.join(os.tmpdir(), 'coop-install-'));
  const modules = ['coopMiningActivate', 'coopMiningCapacitorGate', 'coopMiningTrace',
    'coopNativeCargoTransientIsolation', 'coopGameStoreAtomic'];
  for (const name of modules) {
    fs.copyFileSync(path.join(integrations, name + '.cjs'), path.join(staging, name + '.js'));
  }
  try {
    // Same shape as the installed tree: only .js files, no .cjs siblings.
    const installed = require(path.join(staging, 'coopMiningActivate.js'));
    assert.equal(typeof installed.activate, 'function');
    assert.ok(installed.MODULE_COST_GJ > 0);
    // The atomic store picks the cargo contract through an extensionless require.
    const store = require(path.join(staging, 'coopGameStoreAtomic.js'));
    assert.equal(typeof store.createGameStoreAdapter, 'function');
    const isolation = require(path.join(staging, 'coopNativeCargoTransientIsolation.js'));
    assert.equal(isolation.contractForTables(['miningRuntimeState', 'npcCargo']).name, 'mining-cycle');
  } finally {
    fs.rmSync(staging, {recursive: true, force: true});
  }
});
