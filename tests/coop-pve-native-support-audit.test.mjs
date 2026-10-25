import test from 'node:test';
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
const require=createRequire(import.meta.url);
const {auditSources,CONTRACTS} = require('../scripts/coop-pve-native-support-audit.cjs');
const pretend = () => Object.fromEntries(Object.entries(CONTRACTS).map(([path,tokens])=>[path,tokens.join('\n')]));
test('source tokens never claim native rewards, client login, duo completion',()=>{
 const r=auditSources(pretend());
 assert.equal(r.runtimeObserved,false);
 for(const value of Object.values(r.activities)){
  assert.equal(value.clientValidated,false);
  assert.equal(value.duoValidated,false);
  assert.equal(value.nativeRewardsValidated,false);
  assert.equal(value.gameplayVerified,false);
 }
});
test('unsupported entry and report-only categories remain blocked, not synthetic sites',()=>{
 const sources=pretend();
 sources['dungeon/dungeonExplorationMgrService.js'] += '\nbuildEscalatingPathDetails() { return buildRowset([...ESCALATING_PATH_HEADER], [], "Rowset"); }';
 const r=auditSources(sources);
 assert.equal(r.activities.abyssalDeadspace.state,'ENTRY_REJECTED');
 assert.equal(r.activities.incursions.state,'REPORT_STATE_ONLY');
 assert.equal(r.activities.escalations.state,'EMPTY_NATIVE_PATH');
 assert.equal(r.activities.homefrontOperations.state,'DISCOVERY_BUCKET_ONLY');
});
test('missing/drifted sources fail closed and mark readiness unverified',()=>{
 const s=pretend();
 delete s['dungeon/dungeonUniverseRuntime.js'];
 s['activity/abyssalMgrService.js']='not implemented';
 const r=auditSources(s);
 assert.equal(r.files['dungeon/dungeonUniverseRuntime.js'].state,'MISSING');
 assert.equal(r.files['activity/abyssalMgrService.js'].state,'DRIFTED');
 assert.equal(r.activities.combatAnomalies.state,'SOURCE_UNVERIFIED');
 assert.equal(r.activities.abyssalDeadspace.state,'SOURCE_UNVERIFIED');
});
