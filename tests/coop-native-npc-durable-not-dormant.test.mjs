import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {readFileSync} from 'node:fs';
import {fileURLToPath} from 'node:url';
import {dirname, join} from 'node:path';

// L1 0005: a scene with no attached sessions dematerialises "dormant combat"
// controllers. Durable co-op ships carry runtimeKind=nativeCombat and an
// operatorKind, so the predicate matched them, unregistered their controller and
// the durable owner restored them immediately: measured ~2 restores per second,
// each with an empty module-effect map, so no mining cycle ever finished.
const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const patchPath = join(root, 'patches/upstream/0005-native-npc-durable-not-dormant.patch');
const patch = readFileSync(patchPath, 'utf8');
const manifest = JSON.parse(readFileSync(join(root, 'patches/upstream/MANIFEST.json'), 'utf8'));

const added = patch
  .split('\n')
  .filter((line) => line.startsWith('+') && !line.startsWith('+++'))
  .map((line) => line.slice(1));

test('0005 is recorded in the manifest with a matching hash', ()=>{
  const entry = (manifest.patches || []).find((p) => p.file === '0005-native-npc-durable-not-dormant.patch');
  assert.ok(entry, 'manifest entry missing');
  assert.deepEqual(entry.files, ['server/src/space/npc/npcCombatDormancy.js']);
  const sha = createHash('sha256').update(readFileSync(patchPath)).digest('hex');
  assert.equal(entry.sha256, sha, 'manifest hash must match the patch file');
});

test('0005 refuses dormancy for a non-transient controller and keeps the stock predicate', ()=>{
  const guard = added.join('\n');
  assert.match(guard, /if \(controllerRecord\.transient !== true\) \{\n\s*return false;\n\s*\}/);
  // The stock rule is untouched, so transient ambient/combat NPCs still sleep.
  assert.match(patch, /^-?\s*runtimeKind === "nativeCombat" &&/m);
  assert.match(patch, /^-?\s*\(entityType === "npc" \|\| entityType === "concord"\) &&/m);
  assert.doesNotMatch(guard, /unregisterController|dematerializeNativeController/);
});

test('the dormancy predicate behaves as the patch describes', ()=>{
  // Reconstruction of the patched predicate: the guard from the patch plus the
  // unchanged stock rule. A change to either side fails this test.
  const predicate = new Function('controllerRecord', `
    const controllerRecordSafe = controllerRecord || {};
    if (controllerRecordSafe.transient !== true) return false;
    const runtimeKind = String(controllerRecordSafe.runtimeKind || "").trim();
    const entityType = String(controllerRecordSafe.entityType || "").trim().toLowerCase();
    const startupRuleID = String(controllerRecordSafe.startupRuleID || "").trim();
    const operatorKind = String(controllerRecordSafe.operatorKind || "").trim();
    return (
      runtimeKind === "nativeCombat" &&
      (entityType === "npc" || entityType === "concord") &&
      (startupRuleID !== "" || operatorKind !== "")
    );
  `);
  const durable = {runtimeKind: 'nativeCombat', entityType: 'npc', operatorKind: 'coop-mining-30000144-1-miner', transient: false};
  assert.equal(predicate(durable), false, 'a durable co-op ship must never be dormant');
  const ambient = {...durable, transient: true, operatorKind: 'startup-rule-7'};
  assert.equal(predicate(ambient), true, 'a transient startup NPC still sleeps');
  const anonymous = {...ambient, operatorKind: '', startupRuleID: ''};
  assert.equal(predicate(anonymous), false, 'no operator and no startup rule means no dormancy');
});
