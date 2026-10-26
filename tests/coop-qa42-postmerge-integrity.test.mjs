import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const read=p=>fs.readFileSync(path.join(root,p),'utf8');
const summary=JSON.parse(read('qa/CHAT42_RECONCILIATION_20261026.json'));
const doc=read('docs/COOP_42_POST_MERGE_RECONCILIATION_20261026.md');
test('frozen reconciliation snapshot is explicit and never claims runtime PASS',()=>{
 assert.match(summary.mainHeadAtReview,/^[0-9a-f]{40}$/);
 assert.match(summary.originalQA42Commit,/^[0-9a-f]{40}$/);
 assert.equal(summary.acceptanceMatrix.ownerDirections,41);
 assert.equal(summary.acceptanceMatrix.cases,45);
 assert.equal(summary.acceptanceMatrix.twoClientGameplayPass,0);
 assert.equal(summary.verdict,'NO_GO_NOT_PROVEN_COMPLETE');
 for(const k of ['runtime','twoClient','restart']) assert.equal(summary[k],'NOT_OBSERVED');
});
test('source repair, missing digest and 6 uninstalled helpers remain distinct',()=>{
 assert.equal(summary.policy.status,'RESOLVED_IN_SOURCE_NOT_RUNTIME_PROOF');
 assert.equal(summary.policy.githubActionsYmlCount,0);
 assert.match(summary.currentState.missingManifestEntry,/^state\/digests\//);
 assert.equal(summary.currentState.statusManifestSha256Match,true);
 assert.equal(summary.nativeDedicatedHelpersNotInvokedByCentralInstaller.length,6);
 assert.deepEqual([...new Set(summary.nativeDedicatedHelpersNotInvokedByCentralInstaller.map(x=>x.owner))].sort((a,b)=>a-b),[10,21,28,35]);
});
test('documented owner commits and merge SHAs are anchored to immutable review head',()=>{
 assert.ok(doc.includes(summary.mainHeadAtReview));
 for(const sha of ['e9bc93d28bba','ba8cc94c1289','3bed34f4f9f6','37700c874f9e',
 '81b6469b463a','b6e590406658','fcc15c5d3eee','1e79d7122543','7e1d291e36ff','f863d41ce6d2'])
  assert.ok(doc.includes(sha),sha);
 assert.equal(summary.postQA42Commits,66);
 assert.equal(summary.danbalanAuthoredMainCommits,54);
});
test('operator handoff does not ask bots to edit state or activate unsupported content',()=>{
 assert.match(doc,/Do not hand-edit `state\/`/);
 assert.match(doc,/NO-GO \/ NOT PROVEN COMPLETE/);
 assert.match(doc,/flags OFF/);
 assert.match(doc,/no-CI/);
 assert.match(doc,/Two real independent private authenticated clients/);
});
