import test from 'node:test';
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
const require=createRequire(import.meta.url);
const {KEY,assertPersonalFleetActorFree:guard}=
 require('../scripts/lib/personal-fleet-writer-guard.cjs');
const pilot='coop-pilot-001',entityID=500;
const context=(value,throws=false)=>({
 get(table,key){
  assert.equal(table,'corporationRuntime');assert.equal(key,KEY);
  if(throws)throw Error('DB_DOWN');
  return structuredClone(value);
 }
});
const empty=()=>({version:1,claims:{},generations:{},processed:{}});
const claim=(changes={})=>({entityID:500,pilotID:pilot,
 ownerCharacterID:90,systemID:30000144,
 assignmentID:'pf-assignment-001',generation:1,ownerType:'PERSONAL_FLEET',...changes});
test('reader must be a transaction accessor',()=>{
 assert.equal(guard(null,{entityID,pilotID:pilot}).reason,'PF_WRITER_GUARD_INVALID_CONTEXT');
});
test('missing identifiers are denied',()=>{
 assert.equal(guard(context(null),{entityID:0,pilotID:pilot}).ok,false);
 assert.equal(guard(context(null),{entityID,pilotID:'fake-pilot'}).ok,false);
});
test('missing claim row is compatible with legacy writer',()=>{
 assert.deepEqual(guard(context(null),{entityID,pilotID:pilot}),
 {ok:true,reason:'PF_CLAIM_ROW_ABSENT'});
});
test('empty valid registry admits legacy writer',()=>{
 assert.equal(guard(context(empty()),{entityID,pilotID:pilot}).ok,true);
});
test('occupied entity blocks WAR writer',()=>{
 const s=empty();s.claims['500']=claim();s.generations['500']=1;
 assert.equal(guard(context(s),{entityID:500,pilotID:'coop-pilot-999'}).reason,
  'PF_ACTOR_ALREADY_RESERVED');
});
test('occupied pilot blocks mining writer even for different ship',()=>{
 const s=empty();s.claims['500']=claim();s.generations['500']=1;
 assert.equal(guard(context(s),{entityID:999,pilotID:pilot}).reason,
  'PF_ACTOR_ALREADY_RESERVED');
});
test('different physical actor is admissible',()=>{
 const s=empty();s.claims['500']=claim();s.generations['500']=1;
 assert.equal(guard(context(s),{entityID:999,pilotID:'coop-pilot-999'}).ok,true);
});
test('corrupt claim version blocks all writers',()=>{
 assert.equal(guard(context({...empty(),version:999}),{entityID,pilotID:pilot}).reason,
 'PF_WRITER_GUARD_CORRUPT');
});
test('corrupt claim identity blocks all writers, even if unrelated',()=>{
 const s=empty();s.claims['500']=claim({ownerType:'WAR'});s.generations['500']=1;
 assert.equal(guard(context(s),{entityID:999,pilotID:'coop-pilot-999'}).reason,
 'PF_WRITER_GUARD_CORRUPT');
});
test('corrupt generation blocks all writers',()=>{
 const s=empty();s.claims['500']=claim();s.generations['500']=0;
 assert.equal(guard(context(s),{entityID:999,pilotID:'coop-pilot-999'}).reason,
 'PF_WRITER_GUARD_CORRUPT');
});
test('duplicate pilot records block all writers',()=>{
 const s=empty();s.claims['500']=claim();
 s.claims['501']=claim({entityID:501,assignmentID:'pf-assignment-002'});
 s.generations['500']=1;s.generations['501']=1;
 assert.equal(guard(context(s),{entityID:999,pilotID:'coop-pilot-999'}).reason,
 'PF_WRITER_GUARD_CORRUPT');
});
test('store exception blocks writer',()=>{
 assert.equal(guard(context(null,true),{entityID,pilotID:pilot}).reason,
 'PF_WRITER_GUARD_STORE_UNAVAILABLE');
});
test('invalid generation map blocks writer',()=>{
 const s=empty();s.generations['500']=0;
 assert.equal(guard(context(s),{entityID:999,pilotID:'coop-pilot-999'}).reason,
 'PF_WRITER_GUARD_CORRUPT');
});
