import test from 'node:test';
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import {readFileSync} from 'node:fs';
import {fileURLToPath} from 'node:url';
import {dirname,join} from 'node:path';
const require=createRequire(import.meta.url);
const {assess}=require('../scripts/coop-qa42-acceptance.cjs');
const root=dirname(dirname(fileURLToPath(import.meta.url)));
const read=path=>readFileSync(join(root,path),'utf8');
const matrix=JSON.parse(read('qa/CHAT42_ACCEPTANCE_MATRIX.json'));
const source=JSON.parse(read('qa/CHAT42_SOURCE_SNAPSHOT.json'));
const defects=JSON.parse(read('qa/CHAT42_DEFECT_HANDOFF.json'));
const units=JSON.parse(read('qa/CHAT42_ISOLATED_RETEST.json'));
const doc=read('docs/COOP_42_INDEPENDENT_GAMEPLAY_ACCEPTANCE.md');
test('41 ownership assignments and 45 cases are all documented exactly once',()=>{
 for(const owner of matrix.owners)
   assert.ok(doc.includes('| '+String(owner.owner).padStart(2,'0')+' | '+owner.title+' |'));
 for(const row of matrix.cases)
   assert.equal(doc.split('| '+row.id+' |').length-1,1,row.id);
});
test('all defects routed by owner and actionable issues published',()=>{
 assert.equal(defects.defects.length,10);
 for(const d of defects.defects){
  assert.ok(matrix.owners.some(o=>d.owners.includes(o.owner)));
  assert.ok(d.evidence?.length&&d.requiredFix?.length);
  assert.ok(doc.includes('['+d.key+'](')||doc.includes(d.key+':'));
 }
 for(const key of ['Q42-001','Q42-002','Q42-003','Q42-004']){
  const d=defects.defects.find(x=>x.key===key);
  assert.match(d.trackingIssue,/^https:\/\/github\.com\/pas7-studio\/evejs-coop-universe\/issues\/[0-9]+$/);
 }
});
test('89 re-executed local passes are not a current main wide PASS',()=>{
 assert.equal(units.totals.pass,89);assert.equal(units.totals.fail,0);
 assert.equal(units.totals.skip,10);
 assert.equal(units.rows.length,5);
 assert.equal(units.rows.find(x=>x.owner===21).allRepoBlobsMatched,false);
 assert.equal(assess({matrix,snapshot:source}).overall,'NO_GO_NOT_PROVEN_COMPLETE');
 assert.match(doc,/NO-GO \/ NOT PROVEN COMPLETE/);
});
test('doctrine forbids remote CI and QA package creates no workflow or game modifications',()=>{
 assert.ok(source.forbiddenWorkflowsObserved.length===2);
 assert.ok(doc.includes('did not run them or edit the workflows'));
 assert.ok(doc.includes('No source hook, test assertion, CI workflow or server port was modified'));
});
