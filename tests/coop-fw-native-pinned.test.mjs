import test from 'node:test';
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import {existsSync,readFileSync} from 'node:fs';
import {join} from 'node:path';
const require=createRequire(import.meta.url);
const {readSources,auditSources}=require('../scripts/coop-fw-native-coverage-audit.cjs');
const fw=require('../scripts/coop-fw-native-enlistment-patch.cjs');
const pirate=require('../scripts/coop-fw-insurgency-visibility-patch.cjs');
const code=process.env.EVEJS_COOP_CODE_PATH || process.env.EVEJS_CODE_PATH || '';
const ready=Boolean(code&&existsSync(join(code,fw.FILE))&&existsSync(join(code,pirate.FILE)));
test('pinned source contract supports exact native methods',{skip:!ready?'authorized pinned EveJS/Code checkout unavailable':false},()=>{
 const report=auditSources(readSources(code));
 assert.deepEqual(Object.entries(report.files).filter(([,v])=>v.state!=='SOURCE_CONTRACT_PRESENT'),[]);
 assert.equal(report.evidence.clientLogin,false);
});
test('native direct enlistment source roundtrip',{skip:!ready?'authorized pinned EveJS/Code checkout unavailable':false},()=>{
 const source=readFileSync(join(code,fw.FILE),'utf8');
 const patched=fw.patchFwNative(source,fw.FILE);
 assert.equal((patched.match(/EVEJS_COOP_NATIVE_FW_ENLISTMENT_GUARD/g)||[]).length,6);
 assert.equal(fw.patchFwNative(patched,fw.FILE,{remove:true}),source);
});
test('native pirate campaign source roundtrip',{skip:!ready?'authorized pinned EveJS/Code checkout unavailable':false},()=>{
 const source=readFileSync(join(code,pirate.FILE),'utf8');
 assert.equal(pirate.patchFwInsurgency(pirate.patchFwInsurgency(source,pirate.FILE),pirate.FILE,{remove:true}),source);
});
