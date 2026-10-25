import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { Script } from 'node:vm';
const require = createRequire(import.meta.url);
const guard = require('../integration/coopNativePveObjectiveGuard.cjs');
const {patch, FILE, HOOK} = require('../scripts/coop-pve-native-objective-patch.cjs');
const active = (extra = {}) => ({siteKind:'anomaly', lifecycleState:'active', ...extra});
const empty = {completion:{mode:'encounter_group_cleared'}};
const explicit = {completion:{mode:'objective_target_destroyed'}};
const optedOut = {completion:{completeObjectiveOnEncounterClear:false}};
test('ordinary native combat anomalies retain encounter-clear completion',()=>{
 assert.equal(guard.canCompleteAnomaly(active(), empty),true);
 assert.equal(guard.canCompleteAnomaly(active(), {completion:{mode:'encounter_groups_cleared'}}),true);
});
test('destroy-objective modes require actual native objective receipt',()=>{
 for(const mode of guard.EXPLICIT_DESTRUCTION_MODES){
  assert.equal(guard.canCompleteAnomaly(active(),{completion:{mode}}),false);
  assert.equal(guard.canCompleteAnomaly(active({objectiveSatisfiedAtMs:1234}),{completion:{mode}}),true);
 }
});
test('explicitly disabled encounter-clear needs real native satisfaction, irrespective of waves',()=>{
 assert.equal(guard.canCompleteAnomaly(active(),optedOut),false);
 assert.equal(guard.canCompleteAnomaly(active(),{completeObjectiveOnEncounterClear:false}),false);
 assert.equal(guard.canCompleteAnomaly(active({metadata:{objectiveSatisfiedAtMs:20}}),optedOut),true);
});
test('Objective mode alone does not override pinned native fallback semantics',()=>{
 assert.equal(guard.canCompleteAnomaly(active(),{objectiveMode:'investigate'}),true);
 assert.equal(guard.canCompleteAnomaly(active(),{completion:{objectiveMode:'mine'}}),true);
});
test('other lifecycle, kind, no hints or absent instance fail closed only under flag',()=>{
 for(const instance of [null,active({siteKind:'signature'}),active({lifecycleState:'completed'}),active({lifecycleState:'seeded'})])
  assert.equal(guard.canCompleteAnomaly(instance,empty),false);
 for(const hints of [null,[],0]) assert.equal(guard.canCompleteAnomaly(active(),hints),false);
});
test('fake receipts, negative timestamps and string dates do not permit premature completion',()=>{
 for(const at of [-1,0,1.5,'1234',Infinity,NaN])
  assert.equal(guard.canCompleteAnomaly(active({objectiveSatisfiedAtMs:at}),explicit),false);
});
const fixture = [
'function maybeCompleteClearedEncounterSite(instance, populationHints, options = {}) {',
'  if (!instance) return false;',
'  if (normalizeLowerText(instance && instance.siteKind, "") !== "anomaly") return false;',
'  if (normalizeLowerText(instance && instance.lifecycleState, "") !== "active") return false;',
'  const plans = resolveEncounterPlans(populationHints);',
'  if (plans.length <= 0) return false;',
'  return true;',
'}',
'function isDataRelicUniverseSignatureInstance(instance) {return false;}',
].join('\n')+'\n';
test('reversible, idempotent, LF/CRLF byte exact, with native helper untouched',()=>{
 for(const source of [fixture,fixture.replace(/\n/g,'\r\n')]){
  const once=patch(source,FILE);
  assert.notEqual(once,source);
  assert.ok(once.includes(HOOK));
  assert.equal(patch(once,FILE),once);
  assert.equal(patch(once,FILE,{remove:true}),source);
  assert.equal(patch(source,FILE,{remove:true}),source);
  new Script(once);
 }
});
test('unrecognized source and changed/duplicated anchors refuse to patch',()=>{
 assert.throws(()=>patch(fixture,'server/src/services/agent/agentMissionRuntime.js'),/UNSUPPORTED/);
 assert.throws(()=>patch(fixture.replace('  const plans = resolveEncounterPlans(populationHints);','  const plans = [];'),FILE),/ANCHOR_MISMATCH/);
 assert.throws(()=>patch(fixture+fixture,FILE),/CONTEXT_MISMATCH/);
 assert.throws(()=>patch(fixture.replace('"active"','"paused"'),FILE),/ANCHOR_MISMATCH/);
});
test('one-call flag OFF preserves native, flag ON blocks premature but accepts witnessed objective',()=>{
 const source=patch(fixture,FILE);
 for(const [flag,expected] of [['0',true],['1',false]]){
  const normalizeLowerText=(v)=>String(v||'').trim().toLowerCase();
  const fn=new Function('process','require','normalizeLowerText','resolveEncounterPlans',source+';return maybeCompleteClearedEncounterSite;')(
   {env:{EVEJS_COOP_NATIVE_PVE_OBJECTIVE_GUARD:flag}},
   key=>{assert.equal(key,'../../space/coopNativePveObjectiveGuard');return guard;},
   normalizeLowerText,()=>[{key:'native-wave'}]);
  assert.equal(fn(active(),explicit),expected);
  assert.equal(fn(active({objectiveSatisfiedAtMs:34}),explicit),true);
 }
});
test('patch refuses partially injected malformed hook instead of duplicating',()=>{
 const source=patch(fixture,FILE);
 const broken=source.replace(HOOK,HOOK.slice(0,-1));
 assert.throws(()=>patch(broken,FILE),/ANCHOR_MISMATCH|CONTEXT_MISMATCH/);
});
