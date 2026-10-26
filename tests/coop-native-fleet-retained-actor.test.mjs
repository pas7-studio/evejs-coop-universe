import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {readFileSync} from 'node:fs';
import {fileURLToPath} from 'node:url';
import {dirname, join} from 'node:path';

// L1 0004: a mining fleet dropped any actor whose runtime controller was gone,
// even when the persisted native controller row still existed. The fleet then
// reported miners=0 with live ships and never hauled again.
const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const patchPath = join(root, 'patches/upstream/0004-native-mining-fleet-retained-actor.patch');
const patch = readFileSync(patchPath, 'utf8');
const manifest = JSON.parse(readFileSync(join(root, 'patches/upstream/MANIFEST.json'), 'utf8'));

function addedLines(){
  return patch.split('\n').filter((line)=>line.startsWith('+')&&!line.startsWith('+++')).map((line)=>line.slice(1));
}

test('0004 is recorded in the manifest with a matching hash', ()=>{
  const entry = (manifest.patches||[]).find((p)=>p.file==='0004-native-mining-fleet-retained-actor.patch');
  assert.ok(entry, 'manifest entry missing');
  assert.deepEqual(entry.files, ['server/src/services/mining/miningNpcOperations.js']);
  const sha = createHash('sha256').update(readFileSync(patchPath)).digest('hex');
  assert.equal(entry.sha256, sha, 'manifest hash must match the patch file');
});

test('0004 keeps the actor when the store still owns it, in both fleet lists', ()=>{
  const added = addedLines().join('\n');
  assert.match(added, /function isRetainedFleetActor\(entityID\)/);
  assert.match(added, /npcService\.getControllerByEntityID\(entityID\)/);
  assert.match(added, /nativeNpcStore\.getNativeController\(entityID\)/);
  const retained = addedLines().filter((line)=>line.includes('filter((entityID) => isRetainedFleetActor(entityID))'));
  assert.equal(retained.length, 2, 'miner and hauler lists must both keep a stored actor');
  // The response wing stays on the stock rule: those actors are transient.
  assert.match(patch, /fleetRecord\.responseEntityIDs[\s\S]{0,160}npcService\.getControllerByEntityID\(entityID\)/);
  assert.doesNotMatch(added, /removeNativeEntityCascade/);
});

test('the retained-actor rule behaves as described', ()=>{
  const helperLines = [];
  let inside = false;
  for (const line of addedLines()) {
    if (line.startsWith('function isRetainedFleetActor')) inside = true;
    if (inside) helperLines.push(line);
    if (inside && line === '}') break;
  }
  const helperSource = helperLines.join('\n');
  assert.ok(helperSource.endsWith('}'), 'helper body not found in the patch');
  const make = (runtimeHas, storedHas)=>new Function(
    'npcService','nativeNpcStore',
    helperSource + '\nreturn isRetainedFleetActor(42);',
  )(
    {getControllerByEntityID:()=>runtimeHas},
    {getNativeController:()=>storedHas?{entityID:42}:null},
  );
  assert.equal(make(true,false), true, 'runtime controller is enough');
  assert.equal(make(false,true), true, 'a persisted controller keeps the actor');
  assert.equal(make(false,false), false, 'a destroyed NPC is pruned normally');
});
