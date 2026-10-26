import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {readFileSync} from 'node:fs';
import {fileURLToPath} from 'node:url';
import {dirname, join} from 'node:path';

// L1 0006: refreshShipConditionFields copied the ship item's stored condition into
// the live entity on every presentation refresh. A native NPC always has a ship
// item, so a durable ship that never leaves its scene kept a frozen stored charge:
// measured 0.77 -> 0.014 over four minutes while the recharge loop advanced
// correctly, and every mining activation failed with NOT_ENOUGH_CAPACITOR.
const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const patchPath = join(root, 'patches/upstream/0006-native-npc-live-capacitor-wins.patch');
const patch = readFileSync(patchPath, 'utf8');
const manifest = JSON.parse(readFileSync(join(root, 'patches/upstream/MANIFEST.json'), 'utf8'));

// Rebuild the patched function from the hunk: context lines plus added lines.
// The hunk starts inside the function, so the signature is supplied by the test.
function patchedBody(){
  const lines = patch.split('\n');
  const start = lines.findIndex((line) => line.startsWith('@@'));
  assert.ok(start >= 0, 'patch has no hunk');
  const body = [];
  let capturing = false;
  for (let index = start + 1; index < lines.length; index += 1) {
    const line = lines[index];
    if (line.startsWith('@@') || line.startsWith('---') || line.startsWith('+++')) continue;
    if (!line.startsWith('+') && !line.startsWith('-') && !line.startsWith(' ')) break;
    if (line.startsWith('-')) continue;
    const content = line.slice(1);
    // The hunk opens with the tail of the early-return guard; the body starts at
    // the first statement after it.
    if (!capturing) {
      if (content.trim().startsWith('const shipItem')) capturing = true;
      else continue;
    }
    if (content === '}') {
      body.push('}');
      break;
    }
    body.push(content);
  }
  assert.ok(body.length > 3, 'hunk body was not captured');
  return body.join('\n');
}

function buildRefresh(){
  const source = 'function refreshShipConditionFields(entity) {\n' + patchedBody();
  const harness = new Function('findShipItemById', 'getShipConditionState', 'normalizeShipConditionState', `
    const clamp = (value, low, high) => Math.min(high, Math.max(low, value));
    const toFiniteNumber = (value, fallback) => (Number.isFinite(Number(value)) ? Number(value) : fallback);
    ${source}
    return refreshShipConditionFields;
  `);
  return harness;
}

const REFRESH_SOURCE = 'function refreshShipConditionFields(entity) {\n' + patchedBody();

test('0006 is recorded in the manifest with a matching hash', ()=>{
  const entry = (manifest.patches || []).find((p) => p.file === '0006-native-npc-live-capacitor-wins.patch');
  assert.ok(entry, 'manifest entry missing');
  assert.deepEqual(entry.files, ['server/src/space/runtime.js']);
  const sha = createHash('sha256').update(readFileSync(patchPath)).digest('hex');
  assert.equal(entry.sha256, sha, 'manifest hash must match the patch file');
});

test('a live charge is never knocked back to a stale stored snapshot', ()=>{
  const state = {charge: 0.01};
  const harness = new Function('findShipItemById', 'getShipConditionState', 'normalizeShipConditionState', `
    const clamp = (value, low, high) => Math.min(high, Math.max(low, value));
    const toFiniteNumber = (value, fallback) => (Number.isFinite(Number(value)) ? Number(value) : fallback);
    ${REFRESH_SOURCE}
    return refreshShipConditionFields;
  `);
  const refresh = harness(
    () => ({itemID: 42}),
    () => state,
    () => state,
  );
  const ship = {kind: 'ship', itemID: 42, capacitorChargeRatio: 0.77, conditionState: {charge: 0.01}};
  refresh(ship);
  assert.equal(ship.capacitorChargeRatio, 0.77, 'the live ratio must survive the refresh');
  assert.equal(ship.conditionState.charge, 0.77, 'the stored snapshot must follow the live value');
});

test('a fresh entity is still seeded from the stored snapshot', ()=>{
  const state = {charge: 0.42};
  const harness = new Function('findShipItemById', 'getShipConditionState', 'normalizeShipConditionState', `
    const clamp = (value, low, high) => Math.min(high, Math.max(low, value));
    const toFiniteNumber = (value, fallback) => (Number.isFinite(Number(value)) ? Number(value) : fallback);
    ${REFRESH_SOURCE}
    return refreshShipConditionFields;
  `);
  const refresh = harness(
    () => ({itemID: 43}),
    () => state,
    () => state,
  );
  const ship = {kind: 'ship', itemID: 43, conditionState: {charge: 0.42}};
  refresh(ship);
  assert.equal(ship.capacitorChargeRatio, 0.42);
});
