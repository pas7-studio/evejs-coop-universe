import test from 'node:test';
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import {readFileSync,existsSync} from 'node:fs';
import {join} from 'node:path';
const require=createRequire(import.meta.url);
const {patch,FILE,HOOK} = require('../scripts/coop-pve-native-objective-patch.cjs');
const {readSources,auditSources} = require('../scripts/coop-pve-native-support-audit.cjs');
const code = process.env.EVEJS_COOP_CODE_PATH || process.env.EVEJS_CODE_PATH || '';
const available = code && existsSync(join(code,FILE));
test('real pinned anomaly lifecycle hook roundtrip (requires local authorized EveJS Code)',{skip:!available?'EVEJS_COOP_CODE_PATH not available':false},()=>{
 const src = readFileSync(join(code,FILE),'utf8');
 const next = patch(src,FILE);
 assert.ok(next.includes(HOOK));
 assert.equal(patch(next,FILE),next);
 assert.equal(patch(next,FILE,{remove:true}),src);
});
test('pinned source contracts not a claim of gameplay (requires Code)',{skip:!available?'EVEJS_COOP_CODE_PATH not available':false},()=>{
 const r=auditSources(readSources(code));
 assert.deepEqual(Object.values(r.files).filter(x=>x.state!=='PRESENT_CONTRACT_ONLY'),[]);
 assert.equal(r.activities.abyssalDeadspace.state,'ENTRY_REJECTED');
 assert.equal(r.activities.incursions.state,'REPORT_STATE_ONLY');
 assert.equal(r.activities.escalations.state,'EMPTY_NATIVE_PATH');
 assert.equal(r.activities.combatAnomalies.gameplayVerified,false);
});
