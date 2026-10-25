import test from 'node:test';
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import {readFileSync} from 'node:fs';
import {fileURLToPath} from 'node:url';
import {join,dirname} from 'node:path';
const require=createRequire(import.meta.url);
const {assertMatrix,assertSnapshot,getSourceQuality,validateTwoClients,assess,parseArgs}=
 require('../scripts/coop-qa42-acceptance.cjs');
const root=dirname(dirname(fileURLToPath(import.meta.url)));
const matrix=JSON.parse(readFileSync(join(root,'qa/CHAT42_ACCEPTANCE_MATRIX.json'),'utf8'));
const snapshot=JSON.parse(readFileSync(join(root,'qa/CHAT42_SOURCE_SNAPSHOT.json'),'utf8'));
const currentRev=snapshot.auditHeadAtSnapshot;
const none={schema:'coop-qa42-claims/v1',claims:[]};
const x=JSON.parse(JSON.stringify(matrix));
const report=()=>assess({matrix,snapshot,claims:none,currentRev});
const fp=x=>'attested-fingerprint-'+x;
const evidence=(id)=>{
 const row=matrix.cases.find(c=>c.id===id);
 return {
  caseID:id,projectRev:currentRev,upstreamPin:matrix.upstreamPin,
  operatorObserved:true,operatorLabel:'independent-authorized-operator',
  observedAt:'2026-10-25T21:50:00Z',correlationFingerprint:fp('same-native-occurrence'),
  refs:row.requiredKinds.map((kind,i)=>({kind,sha256:String(i+1).padStart(64,'a'),sourceType:kind==='clientA'||kind==='clientB'?'eve-client-log':'native-server-event'})),
  players:{A:{sessionFingerprint:fp('session-A'),characterFingerprint:fp('character-A'),clientFingerprint:fp('host-A'),accountFingerprint:fp('account-A'),solarSystemID:30000144,shipFingerprint:fp('ship-A')},
    B:{sessionFingerprint:fp('session-B'),characterFingerprint:fp('character-B'),clientFingerprint:fp('host-B'),accountFingerprint:fp('account-B'),solarSystemID:30000144,shipFingerprint:fp('ship-B')}},
  beforeBootFingerprint:fp('boot-1'),afterBootFingerprint:fp('boot-2')
 };
};
test('all 41 independent owner directions and 45 end-to-end cases are present',()=>{
 assert.equal(assertMatrix(matrix),true);assert.equal(matrix.owners.length,41);
 assert.equal(matrix.cases.length,45);
 assert.deepEqual(matrix.owners.map(x=>x.owner),Array.from({length:41},(_,i)=>i+1));
 assert.equal(new Set(matrix.cases.flatMap(x=>x.owners)).size,41);
});
test('published state revision is stale for the inspected head and missing digest is explicit',()=>{
 assert.equal(assertSnapshot(snapshot,matrix),true);
 const s=getSourceQuality(snapshot,currentRev);
 assert.equal(s.status,'SOURCE_INCOMPLETE');
 assert.ok(s.reasons.includes('PUBLISHED_GAMEPLAY_STATE_IS_STALE'));
 assert.ok(s.reasons.includes('PUBLISHED_DIGEST_MISSING_FROM_GIT'));
 assert.ok(s.reasons.includes('FORBIDDEN_GITHUB_ACTIONS_WORKFLOWS_PRESENT'));
});
test('no user claims never invent gameplay PASS',()=>{
 const r=report();assert.equal(r.overall,'NO_GO_NOT_PROVEN_COMPLETE');
 assert.equal(r.counts.NOT_TESTED,45);
 assert.equal(r.counts.PASS_VERIFIED,0);
 assert.equal(r.twoAuthenticatedClientsVerified,false);
});
test('two TCP connections or two windows cannot stand for distinct authenticated game sessions',()=>{
 const players={A:{sessionFingerprint:fp('a'),characterFingerprint:fp('a'),accountFingerprint:fp('a'),clientFingerprint:fp('a')},
 B:{sessionFingerprint:fp('a'),characterFingerprint:fp('a'),accountFingerprint:fp('a'),clientFingerprint:fp('a')}};
 assert.equal(validateTwoClients(players).length,4);
});
test('one client log plus server event cannot pass a duo case',()=>{
 const claim=evidence('QA42-CLIENT_B');
 claim.refs=claim.refs.filter(x=>x.kind!=='clientB');
 const r=assess({matrix,snapshot,claims:{...none,claims:[claim]},currentRev});
 assert.equal(r.cases.find(x=>x.id==='QA42-CLIENT_B').status,'REJECTED_EVIDENCE');
 assert.ok(r.cases.find(x=>x.id==='QA42-CLIENT_B').reasons.includes('REQUIRED_EVIDENCE_MISSING_clientB'));
});
test('stale revision, wrong pin, forged PASS and absent operator are rejected',()=>{
 const claim=evidence('QA42-SCENE');claim.projectRev='a'.repeat(40);
 claim.upstreamPin='b'.repeat(40);claim.claimedStatus='PASS';claim.operatorObserved=false;
 const r=assess({matrix,snapshot,claims:{...none,claims:[claim]},currentRev});
 const row=r.cases.find(x=>x.id==='QA42-SCENE');
 assert.equal(row.status,'REJECTED_EVIDENCE');
 assert.ok(row.reasons.includes('EVIDENCE_REVISION_OR_PIN_MISMATCH'));
 assert.ok(row.reasons.includes('UNREVIEWED_AUTO_PASS_FORBIDDEN'));
 assert.ok(row.reasons.includes('INDEPENDENT_OPERATOR_OBSERVATION_MISSING'));
});
test('two different game clients with all hashes are still REVIEW_REQUIRED, never auto PASS',()=>{
 const claim=evidence('QA42-SCENE');
 const r=assess({matrix,snapshot,claims:{...none,claims:[claim]},currentRev});
 assert.equal(r.cases.find(x=>x.id==='QA42-SCENE').status,'REVIEW_REQUIRED');
 assert.equal(r.overall,'NO_GO_NOT_PROVEN_COMPLETE');
 assert.equal(r.counts.PASS_VERIFIED,0);
});
test('cross-system same-grid claim is rejected',()=>{
 const claim=evidence('QA42-SCENE');claim.players.B.solarSystemID=30000142;
 const r=assess({matrix,snapshot,claims:{...none,claims:[claim]},currentRev});
 assert.ok(r.cases.find(x=>x.id==='QA42-SCENE').reasons.includes('NO_COMMON_SOLAR_SYSTEM'));
});
test('duplicate scenario claims cannot masquerade as two separate players',()=>{
 const claim=evidence('QA42-SCENE');
 assert.throws(()=>assess({matrix,snapshot,claims:{...none,claims:[claim,claim]},currentRev}),/QA42_DUPLICATE/);
});
test('restart requires before/after distinct boots and durable evidence',()=>{
 const claim=evidence('QA42-PERSISTENCE');claim.afterBootFingerprint=claim.beforeBootFingerprint;
 const r=assess({matrix,snapshot,claims:{...none,claims:[claim]},currentRev});
 assert.ok(r.cases.find(x=>x.id==='QA42-PERSISTENCE').reasons.includes('NO_DISTINCT_RESTART_BOOT_WITNESSES'));
});
test('partial economy claims cannot be treated as market settlement',()=>{
 const claim=evidence('QA42-MARKET');claim.refs=claim.refs.filter(x=>!['rust','walletAfter','inventoryAfter'].includes(x.kind));
 const r=assess({matrix,snapshot,claims:{...none,claims:[claim]},currentRev});
 assert.ok(r.cases.find(x=>x.id==='QA42-MARKET').reasons.includes('REQUIRED_EVIDENCE_MISSING_rust'));
});
test('new HEAD invalidates snapshot evidence without claiming game regression',()=>{
 const claim=evidence('QA42-SCENE');const head='f'.repeat(40);
 const r=assess({matrix,snapshot,claims:{...none,claims:[claim]},currentRev:head});
 assert.ok(r.source.reasons.includes('QA_SNAPSHOT_NOT_CURRENT_FOR_HEAD'));
 assert.ok(r.cases.find(x=>x.id==='QA42-SCENE').reasons.includes('QA_SNAPSHOT_NOT_CURRENT_FOR_HEAD'));
});
test('matrix modifications cannot mark any owner duo PASS on paper',()=>{
 const m=structuredClone(matrix);m.owners[0].twoClient.status='PASS';
 assert.throws(()=>assertMatrix(m),/QA42_UNSUPPORTED_DUO_PASS/);
});
test('corrupted missing owner, duplicate owner or missing cases refuse acceptance',()=>{
 for(const update of [m=>m.owners.pop(),m=>m.owners[1].owner=1,m=>m.cases.pop(),m=>m.cases[0].requiredKinds=['nonsense']]){
  const m=structuredClone(matrix);update(m);assert.throws(()=>assertMatrix(m),/QA42_/);
 }
});
test('unknown case and invalid sha digest rejected',()=>{
 const m={...none,claims:[evidence('QA42-SCENE'),{...evidence('QA42-SCENE'),caseID:'QA42-NONEXISTENT'}]};
 assert.throws(()=>assess({matrix,snapshot,claims:m,currentRev}),/QA42_UNKNOWN_CASE/);
 const claim=evidence('QA42-SCENE');claim.refs[0].sha256='not-a-proof';
 const r=assess({matrix,snapshot,claims:{...none,claims:[claim]},currentRev});
 assert.ok(r.cases.find(x=>x.id==='QA42-SCENE').reasons.includes('INVALID_EVIDENCE_REFERENCE'));
});
test('unknown CLI flags rejected, strict mode is explicit',()=>{
 assert.deepEqual(parseArgs(['--strict','--current-rev','c'.repeat(40)]),{strict:true,'current-rev':'c'.repeat(40)});
 assert.throws(()=>parseArgs(['--create-ci']),/QA42_UNKNOWN_ARG/);
});
