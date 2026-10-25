// Regression: a spec hook that is NOT registered for stripping made `--check`
// report phantom native drift, so the overlay could not be rebuilt at all — the
// whole deploy loop stopped. Inserting after an anchor is not idempotent by
// itself; strip() must know every unambiguously co-op inserted line.
import test from 'node:test';
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
const require=createRequire(import.meta.url);
const {specs,transform}=require('../scripts/patch-evejs-coop.cjs');

const spec=specs.find(entry=>entry.file.endsWith('chat/sessionRegistry.js'));
const hook=spec.patches[0].line;
const source=[
 'function indexCharacterSession(session) {',
 '  if (characterID) {',
 '    addToIndex(session, characterID);',
 '  }',
 '}',
 ''
].join('\n');
const patched=[source.split('\n')[2], hook].join('\n');

test('a co-op hook line is removed before re-applying, so reinstall is idempotent',()=>{
 const stripped=transform(patched,spec,true);
 assert.equal(stripped.includes('EVEJS_COOP_NPC_BUY_NOTIFY_CATCHUP'),false,
  'strip left the hook behind: the next install would duplicate it');
 assert.equal(transform(stripped,spec,true),stripped,'strip is not idempotent');
 const reapplied=transform(stripped,spec,false);
 assert.equal(reapplied.split(hook).length-1,1,'hook must be inserted exactly once');
 assert.equal(transform(reapplied,spec,true),stripped,'apply/strip roundtrip');
});

test('classifyFile calls an already patched synthetic source PATCHED, not DRIFTED',()=>{
 const {classifyFile}=require('../scripts/patch-evejs-coop.cjs');
 const applied=transform(transform(patched,spec,true),spec,false);
 assert.equal(classifyFile(applied,spec,process.cwd()),'PATCHED');
});
