import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import crypto from 'node:crypto';
import {fileURLToPath} from 'node:url';
import {createRequire} from 'node:module';
import {spawnSync} from 'node:child_process';
const require=createRequire(import.meta.url);
const project=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const {inspect,inspectState,inspectWorkflows,inspectHooks,parseArgs,safeManifestPath,nativeHooks}=require('../scripts/coop-qa42-reconciliation.cjs');
const {assess,getSourceQuality,getGitRevision}=require('../scripts/coop-qa42-acceptance.cjs');
const SHA='a'.repeat(40);
const digest=x=>crypto.createHash('sha256').update(x).digest('hex');
function sample(t){
 const root=fs.mkdtempSync(path.join(os.tmpdir(),'qa42-reconcile-'));
 t.after(()=>fs.rmSync(root,{recursive:true,force:true}));
 const put=(name,text)=>{const dest=path.join(root,name);fs.mkdirSync(path.dirname(dest),{recursive:true});fs.writeFileSync(dest,text);};
 put('AGENTS.md','No CI. Do not add GitHub Actions.');
 put('qa/CHAT42_ACCEPTANCE_MATRIX.json',fs.readFileSync(path.join(project,'qa/CHAT42_ACCEPTANCE_MATRIX.json')));
 const state={'state/NOW.md':'Status snapshot\n','state/status.json':JSON.stringify({projectRev:SHA})+'\n',
  'state/ledger.json':'{}\n','state/digests/20261025-test.md':'Redacted test evidence\n'};
 for(const [p,content] of Object.entries(state))put(p,content);
 put('state/manifest.json',JSON.stringify({files:Object.entries(state).map(([p,content])=>({path:p,bytes:Buffer.byteLength(content),sha256:digest(content)}))}));
 return {root,put,state};
}
test('source evidence matching never proves current native gameplay',t=>{
 const s=sample(t);
 const result=inspect({root:s.root,revision:SHA,requireTracked:false});
 assert.equal(result.independentOwners,41);assert.equal(result.scenarios,45);
 assert.equal(result.state.publication,'SOURCE_MANIFEST_MATCH');
 assert.equal(result.state.manifestIntegrity,'HASH_MATCH');
 assert.equal(result.verdict,'NO_GO_NOT_PROVEN_COMPLETE');
 assert.equal(result.nativeRuntimeStatus,'NOT_OBSERVED');
 assert.equal(result.twoClientStatus,'NOT_OBSERVED');
});
test('forged or stale snapshot SHA is rejected rather than promoted to PASS',t=>{
 const s=sample(t);const r=inspectState(s.root,'b'.repeat(40),{requireTracked:false});
 assert.ok(r.errors.includes('STATE_REVISION_STALE'));
 assert.equal(r.publication,'STALE_OR_INCOMPLETE');
});
test('missing run digest, incorrect size or digest fails integrity',t=>{
 const s=sample(t);
 fs.rmSync(path.join(s.root,'state/digests/20261025-test.md'));
 fs.writeFileSync(path.join(s.root,'state/status.json'),JSON.stringify({projectRev:SHA,extra:true})+'\n');
 const r=inspectState(s.root,SHA,{requireTracked:false});
 assert.ok(r.errors.includes('STATE_EVIDENCE_MISSING'));
 assert.ok(r.errors.includes('STATE_EVIDENCE_DIGEST_MISMATCH'));
 assert.equal(r.manifestIntegrity,'INCOMPLETE');
});
test('manifest traversal, duplicates and injected paths fail closed',t=>{
 const s=sample(t);
 for(const p of ['state/../secrets','/etc/passwd','state//foo','state/./x','state/x\\y','state/abc\0def'])
  assert.equal(safeManifestPath(p),false,p);
 const name=path.join(s.root,'state/manifest.json');const m=JSON.parse(fs.readFileSync(name));
 m.files.push({...m.files[0]});fs.writeFileSync(name,JSON.stringify(m));
 assert.ok(inspectState(s.root,SHA,{requireTracked:false}).errors.includes('STATE_MANIFEST_INVALID_ENTRY'));
});
test('untracked state artifacts cannot pass a published manifest check',t=>{
 const s=sample(t);const r=inspectState(s.root,SHA,{requireTracked:true});
 assert.ok(r.errors.includes('STATE_EVIDENCE_NOT_TRACKED'));
 assert.ok(r.entries.every(x=>x.integrity==='NOT_TRACKED'));
});
test('forbidden workflows are detected without executing CI',t=>{
 const s=sample(t);s.put('.github/workflows/danger.yml','on: pull_request\n');
 assert.equal(inspectWorkflows(s.root).status,'OWNER_NO_CI_CONFLICT');
 fs.unlinkSync(path.join(s.root,'.github/workflows/danger.yml'));
 assert.equal(inspectWorkflows(s.root).status,'NO_WORKFLOW_VIOLATION_DETECTED');
});
test('copying a module is not equal to activating its native source hook',t=>{
 const s=sample(t);const h=nativeHooks.find(x=>x.owner===21);
 s.put('integration/'+h.module+'.cjs','module.exports={}');
 s.put('scripts/'+h.helper,'module.exports={patch:()=>{}}');
 s.put('scripts/patch-evejs-coop.cjs',`const names=["${h.module}"];\n`);
 let row=inspectHooks(s.root).find(x=>x.module===h.module);
 assert.equal(row.moduleRegistered,true);
 assert.equal(row.helperInvokedInInstaller,false);
 assert.equal(row.status,'COPIED_ONLY_HOOK_NOT_ASSEMBLED');
 s.put('scripts/patch-evejs-coop.cjs',`const names=["${h.module}"];\nrequire("./${h.helper}").patch;\n`);
 row=inspectHooks(s.root).find(x=>x.module===h.module);
 assert.equal(row.helperInvokedInInstaller,true);
 assert.equal(row.status,'SOURCE_HOOK_REFERENCED_NOT_DEPLOYMENT_PROOF');
});
test('repository revision must be explicit actual git HEAD, not a historical snapshot fallback',()=>{
 const matrix=JSON.parse(fs.readFileSync(path.join(project,'qa/CHAT42_ACCEPTANCE_MATRIX.json')));
 const snapshot=JSON.parse(fs.readFileSync(path.join(project,'qa/CHAT42_SOURCE_SNAPSHOT.json')));
 const r=assess({matrix,snapshot});
 assert.equal(r.auditedRevision,null);
 assert.ok(r.source.reasons.includes('CURRENT_REVISION_NOT_VERIFIED'));
 assert.equal(r.overall,'NO_GO_NOT_PROVEN_COMPLETE');
 const actual=getGitRevision(project);
 if(actual===null)assert.equal(actual,null);
 else assert.match(actual,/^[a-f0-9]{40}$/);
 assert.equal(getSourceQuality(snapshot,null).status,'SOURCE_INCOMPLETE');
});
test('claim with missing checkout SHA is REJECTED_EVIDENCE even if hashes match old snapshot',()=>{
 const matrix=JSON.parse(fs.readFileSync(path.join(project,'qa/CHAT42_ACCEPTANCE_MATRIX.json')));
 const snapshot=JSON.parse(fs.readFileSync(path.join(project,'qa/CHAT42_SOURCE_SNAPSHOT.json')));
 const claim={caseID:'QA42-BOOT',projectRev:snapshot.auditHeadAtSnapshot,upstreamPin:matrix.upstreamPin,
  operatorObserved:true,operatorLabel:'authorized operator',observedAt:'2026-10-25T21:00:00Z',correlationFingerprint:'sufficient-fingerprint',
  refs:[{kind:'server',sha256:'f'.repeat(64),sourceType:'native-server-event'}]};
 const r=assess({matrix,snapshot,claims:{schema:'coop-qa42-claims/v1',claims:[claim]}});
 const row=r.cases.find(x=>x.id==='QA42-BOOT');
 assert.equal(row.status,'REJECTED_EVIDENCE');
 assert.ok(row.reasons.includes('CURRENT_REVISION_NOT_VERIFIED'));
 assert.ok(row.reasons.includes('EVIDENCE_REVISION_OR_PIN_MISMATCH'));
});
test('CLI cannot accept an arbitrary fabricated --current-rev in a non-git directory',()=>{
 const result=spawnSync(process.execPath,[path.join(project,'scripts/coop-qa42-acceptance.cjs'),
  '--current-rev','b'.repeat(40)],{encoding:'utf8'});
 const actual=getGitRevision(project);
 if(actual){
  assert.equal(result.status,2);
  assert.match(result.stderr,/QA42_CURRENT_REVISION_MISMATCH/);
 }else{
  assert.equal(result.status,0);
  const output=JSON.parse(result.stdout);
  assert.equal(output.auditedRevision,null);
  assert.equal(output.overall,'NO_GO_NOT_PROVEN_COMPLETE');
 }
});
test('reconciliation CLI strictly rejects an expected HEAD without a checkout',()=>{
 const opts=parseArgs(['--strict','--root',project,'--expected-head',SHA]);
 assert.equal(opts.strict,true);
 const child=spawnSync(process.execPath,[path.join(project,'scripts/coop-qa42-reconciliation.cjs'),
  '--root',project,'--expected-head',SHA],{encoding:'utf8'});
 assert.equal(child.status,2);
 assert.match(child.stderr,/QA42_CHECKOUT_HEAD_MISMATCH/);
});
