import test from 'node:test';
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';

const require = createRequire(import.meta.url);
const deploy = require('../scripts/coop-deploy.cjs');

// The deploy must reset every stock file the pipeline edits. A file that is edited
// but not reset keeps the previous overlay text, the installer refuses it as drift
// and a build silently ships the old behaviour (this happened once: the capacitor
// gate measured "wait 0" because it was never installed).
test('the reset list covers every L1 patch target', ()=>{
  const managed = deploy.managedFiles();
  const {files} = deploy.manifestFiles();
  for (const file of files) {
    assert.ok(managed.includes(file), 'L1 target missing from the reset list: ' + file);
  }
});

test('the reset list covers every file the overlay edits', ()=>{
  const managed = deploy.managedFiles();
  const overlay = deploy.overlayFiles();
  assert.ok(overlay.size > 0, 'the overlay edits no files');
  for (const file of overlay) {
    assert.ok(managed.includes(file), 'overlay target missing from the reset list: ' + file);
  }
});

test('the reset list never includes a file we do not manage', ()=>{
  const managed = deploy.managedFiles();
  assert.equal(new Set(managed).size, managed.length, 'duplicate entries');
  for (const file of managed) {
    assert.match(file, /^server\/src\//, 'unexpected path: ' + file);
  }
});

test('the reset list covers every file a legacy patch script edits', ()=>{
  const fs = require('node:fs');
  const path = require('node:path');
  const scripts = path.join(path.dirname(new URL(import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1')), '..', 'scripts');
  const managed = deploy.managedFiles();
  const targets = new Set();
  for (const name of fs.readdirSync(scripts).filter((file) => /-patch\.cjs$/.test(file))) {
    const text = fs.readFileSync(path.join(scripts, name), 'utf8');
    // Any quoted "server/src/....js" literal is a stock file this script edits,
    // whether it is a map key, a const or an object value.
    for (const match of text.matchAll(/["'](server\/src\/[^"']+\.js)["']/g)) targets.add(match[1]);
  }
  for (const target of targets) {
    assert.ok(managed.includes(target), 'legacy patch target missing from the reset list: ' + target);
  }
});
