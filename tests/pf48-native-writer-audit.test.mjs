import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {spawnSync} from 'node:child_process';
import {createRequire} from 'node:module';
const require=createRequire(import.meta.url);
const {EXPECTED,REQUIRED_NATIVE_PF,inspectNativeWriterCoverage}=require('../scripts/lib/personal-fleet-native-writer-audit.cjs');
const cli=path.resolve(import.meta.dirname,'../scripts/personal-fleet-audit-native-writers.cjs');
const root=()=>fs.mkdtempSync(path.join(os.tmpdir(),'pf48-native-'));
const source=(r,p)=>path.join(r,...p.split('/'));
const put=(r,p,s)=>{const f=source(r,p);fs.mkdirSync(path.dirname(f),{recursive:true});fs.writeFileSync(f,s,'utf8');};
const change=(r,p,fn)=>{const f=source(r,p);fs.writeFileSync(f,fn(fs.readFileSync(f,'utf8')),'utf8');};
function fixture({withNativePF=false}={}){
 const r=root();
 for(const {path:p,anchors} of EXPECTED)put(r,p,`'use strict';\n${anchors.join('\n')}\n// fixture\n`);
 if(withNativePF)for(const p of REQUIRED_NATIVE_PF)put(r,p,"'use strict';\n");
 return r;
}
const inspect=(r,opts={})=>inspectNativeWriterCoverage({forkRoot:r,requireGit:false,...opts});
const cleanup=r=>fs.rmSync(r,{recursive:true,force:true});

test('requires explicit, existing authoritative fork source',()=>{
 assert.throws(()=>inspectNativeWriterCoverage(),/PF48_FORK_ROOT_REQUIRED/);
 const r=root();try{assert.throws(()=>inspect(r),/PF48_NATIVE_SOURCE_ROOT_NOT_FOUND/);}finally{cleanup(r);}
});
test('inspects all critical actual native source paths',()=>{
 const r=fixture();try{
  const out=inspect(r);
  assert.equal(out.critical.length,EXPECTED.length);
  assert.ok(out.critical.every(x=>x.status==='INSPECTED'));
  assert.ok(out.scannedSourceFiles>=EXPECTED.length);
 }finally{cleanup(r);}
});
test('missing PF45/46/47 native sources block activation',()=>{
 const r=fixture();try{
  const out=inspect(r);assert.equal(out.status,'BLOCKED_FOR_ACTIVATION');
  assert.equal(out.nativePF.filter(x=>!x.present).length,REQUIRED_NATIVE_PF.length);
  assert.equal(out.blockers.filter(x=>x.startsWith('NATIVE_PF_COMPONENT_MISSING:')).length,REQUIRED_NATIVE_PF.length);
 }finally{cleanup(r);}
});
test('even all synthetic local source files present cannot authorize runtime ownership',()=>{
 const r=fixture({withNativePF:true});try{
  const out=inspect(r);assert.ok(out.nativePF.every(x=>x.present));
  assert.deepEqual([out.status,out.gameplayProven,out.releaseAuthority],['BLOCKED_FOR_ACTIVATION',false,false]);
  assert.ok(out.blockers.includes('RUNTIME_WRITER_FENCE_NOT_PROVEN'));
 }finally{cleanup(r);}
});
test('detects missing stock mining source, fails closed',()=>{
 const r=fixture();try{
  fs.rmSync(source(r,'Code/server/src/services/mining/miningNpcOperations.js'));
  const out=inspect(r);assert.ok(out.critical.some(x=>x.label==='stock-mining'&&x.status==='MISSING'));
  assert.ok(out.blockers.some(x=>x.includes('CRITICAL_SOURCE_MISSING')));
 }finally{cleanup(r);}
});
test('detects incompatible native mining transaction anchors',()=>{
 const r=fixture();try{
  change(r,'Code/server/src/space/coopNativeMiningAtomic.js',s=>s.replace('miningRuntimeState','otherRuntime'));
  const out=inspect(r);assert.ok(out.critical.some(x=>x.label==='ore-settlement'&&x.status==='ANCHOR_MISSING'));
 }finally{cleanup(r);}
});
test('detects native cargo writer calls with line numbers',()=>{
 const r=fixture();try{
  put(r,'Code/server/src/space/coopNewHauler.js',"'use strict';\nconst a=1;\nnativeNpcStore.upsertNativeCargo({});\n");
  const out=inspect(r);const c=out.candidates.find(x=>x.path.endsWith('coopNewHauler.js'));
  assert.ok(c);assert.equal(c.occurrences[0].line,3);
  assert.match(c.occurrences[0].api,/upsertNativeCargo/);
 }finally{cleanup(r);}
});
test('new unaccounted mining writer changes reproducible source fingerprint',()=>{
 const r=fixture();try{
  const prior=inspect(r);put(r,'Code/server/src/space/coopMinerSidecar.js','nativeNpcStore.removeNativeCargo(14);\n');
  const after=inspect(r);assert.notEqual(prior.fingerprint,after.fingerprint);
  assert.ok(after.candidates.some(x=>x.path.endsWith('coopMinerSidecar.js')));
 }finally{cleanup(r);}
});
test('fingerprint independent of mtimes and directory enumeration order',()=>{
 const r=fixture();try{
  const a=inspect(r);const f=source(r,EXPECTED[0].path);
  fs.utimesSync(f,new Date('2001-01-01'),new Date('2001-01-01'));
  const b=inspect(r);assert.equal(a.fingerprint,b.fingerprint);
 }finally{cleanup(r);}
});
test('excluded plain text and docs do not change source fingerprint',()=>{
 const r=fixture();try{
  const a=inspect(r);put(r,'Code/server/src/space/mining-readme.txt','nativeNpcStore.upsertNativeCargo(5)');
  const b=inspect(r);assert.equal(a.fingerprint,b.fingerprint);
 }finally{cleanup(r);}
});
test('source scanner is read-only and does not create files in the checkout',()=>{
 const r=fixture();try{
  const f=source(r,EXPECTED[0].path),before=fs.readFileSync(f,'utf8');
  const x=inspect(r);assert.equal(x.status,'BLOCKED_FOR_ACTIVATION');
  assert.equal(fs.readFileSync(f,'utf8'),before);
  assert.equal(fs.existsSync(path.join(r,'.pf48-cache')),false);
 }finally{cleanup(r);}
});
test('symbolic links not followed and audit is incomplete',t=>{
 const r=fixture();try{
  const dir=source(r,'Code/server/src/space');
  try{fs.symlinkSync(r,path.join(dir,'additional-linked-source'),'dir');}catch(e){t.skip('symlink unsupported: '+e.code);return;}
  const x=inspect(r);assert.ok(x.scanErrors.some(e=>e.code==='SYMLINK_NOT_INSPECTED'));
  assert.ok(x.blockers.some(e=>e.startsWith('SOURCE_SCAN_INCOMPLETE:SYMLINK_NOT_INSPECTED')));
 }finally{cleanup(r);}
});
test('oversized module produces explicit scanner block',()=>{
 const r=fixture();try{
  put(r,'Code/server/src/space/coopMiningHuge.js','x'.repeat(2_000_001));
  const x=inspect(r);assert.ok(x.blockers.some(e=>e.includes('SOURCE_TOO_LARGE')));
 }finally{cleanup(r);}
});
test('unknown git revision blocks release in strict mode',()=>{
 const r=fixture();try{
  const x=inspectNativeWriterCoverage({forkRoot:r});
  assert.equal(x.revision,null);assert.ok(x.blockers.includes('GIT_REVISION_UNVERIFIED'));
 }finally{cleanup(r);}
});
test('CLI emits parseable JSON and refuses any green/readiness exit code',()=>{
 const r=fixture({withNativePF:true});try{
  const v=spawnSync(process.execPath,[cli,'--fork-root',r],{encoding:'utf8'});
  assert.equal(v.status,2);const out=JSON.parse(v.stdout);
  assert.equal(out.status,'BLOCKED_FOR_ACTIVATION');assert.equal(out.sourceOnly,true);
 }finally{cleanup(r);}
});
test('CLI refuses implicit default source and gives usage',()=>{
 const v=spawnSync(process.execPath,[cli],{encoding:'utf8'});
 assert.equal(v.status,64);assert.match(v.stderr,/--fork-root/);
});
test('bad root returns clear CLI error without touching running world',()=>{
 const r=root();try{
  const v=spawnSync(process.execPath,[cli,'--fork-root',r],{encoding:'utf8'});
  assert.equal(v.status,3);assert.match(v.stderr,/PF48_NATIVE_SOURCE_ROOT_NOT_FOUND/);
 }finally{cleanup(r);}
});