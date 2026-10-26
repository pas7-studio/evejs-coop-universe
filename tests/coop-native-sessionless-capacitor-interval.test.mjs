import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {readFileSync} from 'node:fs';
import {fileURLToPath} from 'node:url';
import {dirname, join} from 'node:path';

// L1 0003 (second hunk): the sessionless capacitor advance measured its own dt
// from capacitorRechargedAtMs, a shared stamp other code also refreshes, so each
// call covered a few milliseconds and hulls charged ~53x too slowly (measured
// +0.0109 ratio over 121 s against 0.0048/s expected). They starved at 2% and
// every mining activation failed with NOT_ENOUGH_CAPACITOR.
const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const patchPath = join(root, 'patches/upstream/0003-native-npc-sessionless-capacitor.patch');
const patch = readFileSync(patchPath, 'utf8');
const manifest = JSON.parse(readFileSync(join(root, 'patches/upstream/MANIFEST.json'), 'utf8'));

const added = patch
  .split('\n')
  .filter((line) => line.startsWith('+') && !line.startsWith('+++'))
  .map((line) => line.slice(1));

function functionSource(name){
  const start = added.findIndex((line) => line.startsWith('function ' + name + '('));
  assert.ok(start >= 0, name + ' not found in the patch');
  const body = [];
  let depth = 0;
  for (let index = start; index < added.length; index += 1) {
    const line = added[index];
    body.push(line);
    for (const char of line) {
      if (char === '{') depth += 1;
      else if (char === '}') depth -= 1;
    }
    if (depth === 0) break;
  }
  return body.join('\n');
}

const advanceSource = functionSource('advanceSessionlessCapacitor');

function makeAdvance(){
  return new Function('toFiniteNumber', 'npcRechargeRateOf', `
    ${advanceSource}
    return advanceSessionlessCapacitor;
  `)(
    (value, fallback) => (Number.isFinite(Number(value)) ? Number(value) : fallback),
    (entity) => Number(entity.capacitorRechargeRate) || 0,
  );
}

function makeHull(overrides = {}){
  return {
    kind: 'ship',
    session: null,
    capacitorCapacity: 900,
    capacitorRechargeRate: 187500,
    capacitorChargeRatio: 0.01,
    capacitorRechargedAtMs: 0,
    conditionState: {charge: 0.01},
    ...overrides,
  };
}

test('0003 is recorded in the manifest with a matching hash', ()=>{
  const entry = (manifest.patches || []).find((p) => p.file === '0003-native-npc-sessionless-capacitor.patch');
  assert.ok(entry, 'manifest entry missing');
  const sha = createHash('sha256').update(readFileSync(patchPath)).digest('hex');
  assert.equal(entry.sha256, sha, 'manifest hash must match the patch file');
});

test('the advance keeps its own interval stamp and still refreshes the shared one', ()=>{
  assert.match(patch, /coopCapacitorAdvancedAtMs/, 'private stamp missing');
  assert.match(added.join('\n'), /entity\.capacitorRechargedAtMs = now;/, 'the client-visible stamp must stay fresh');
});

test('one second of advance charges the hull like the CCP curve', ()=>{
  const advance = makeAdvance();
  const hull = makeHull();
  advance(hull, 1_000_000);
  const first = hull.capacitorChargeRatio;
  advance(hull, 1_001_000);
  const second = hull.capacitorChargeRatio;
  const perSecond = second - first;
  // tau = 187.5 s, ratio 0.01 -> dRatio/s = (10/tau) * (sqrt(r) - r) ~= 0.0048.
  assert.ok(perSecond > 0.004 && perSecond < 0.006, 'advance per second was ' + perSecond);
});

test('another writer touching the shared stamp cannot shrink our interval', ()=>{
  const advance = makeAdvance();
  const hull = makeHull();
  advance(hull, 2_000_000);
  const before = hull.capacitorChargeRatio;
  // Someone else refreshes the client-visible stamp a few milliseconds later.
  hull.capacitorRechargedAtMs = 2_000_020;
  advance(hull, 2_001_000);
  const gained = hull.capacitorChargeRatio - before;
  assert.ok(gained > 0.004, 'a foreign stamp refresh shrank the advance to ' + gained);
});

test('a ship with a session is left to the session tick', ()=>{
  const advance = makeAdvance();
  const hull = makeHull({session: {characterID: 1}});
  const before = hull.capacitorChargeRatio;
  advance(hull, 3_000_000);
  assert.equal(hull.capacitorChargeRatio, before);
});
