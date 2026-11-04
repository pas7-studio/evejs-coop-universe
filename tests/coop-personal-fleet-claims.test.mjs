import test from 'node:test';
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
const require=createRequire(import.meta.url);
const {KEY,WAR_KEY,createPersonalFleetClaims,validate} =
  require('../scripts/lib/personal-fleet-claims.cjs');

function fixture({on=true,integrated=true,war=null,miningFree=true,otherFree=true,
 nativeReady=true,releaseReady=true,poisoned=false}={}){
 const rows=new Map();let writes=0, transactions=0;
 if(war!==null)rows.set(WAR_KEY,structuredClone(war));
 const tx={
  get(_table,key){return rows.has(key)?structuredClone(rows.get(key)):null;},
  put(_table,key,value){rows.set(key,structuredClone(value));writes++;},
 };
 const gameStore={coopAtomicNativeRows:{
  isPoisoned:()=>poisoned,
  transact(tables,fn){
   assert.deepEqual(tables,['corporationRuntime']);transactions++;
   const copy=new Map([...rows].map(([k,v])=>[k,structuredClone(v)]));
   const atomic={
    get(_table,key){return copy.has(key)?structuredClone(copy.get(key)):null;},
    put(_table,key,v){copy.set(key,structuredClone(v));},
   };
   const result=fn(atomic);
   for(const [key,v] of copy) if(JSON.stringify(rows.get(key))!==JSON.stringify(v)){
    rows.set(key,structuredClone(v));writes++;
   }
   return result;
  },
 }};
 const service=createPersonalFleetClaims({gameStore,
  enabled:()=>on,writersIntegrated:()=>integrated,
  verifyMiningFree:()=>miningFree,verifyOtherClaimsFree:()=>otherFree,
  verifyNativeActor:()=>nativeReady,verifyRelease:()=>releaseReady});
 return {service,rows,get writes(){return writes},get transactions(){return transactions},tx};
}
const claim=(overrides={})=>({type:'CLAIM',operationID:'pf-op-001',entityID:500,
 pilotID:'coop-pilot-001',ownerCharacterID:90,assignmentID:'pf-assignment-001',
 systemID:30000144,...overrides});
test('default disabled is no-op',()=>{
 const x=fixture({on:false});assert.equal(x.service.execute(claim()).status,'DISABLED');
 assert.equal(x.transactions,0);
});
test('global writers gate precedes database access',()=>{
 const x=fixture({integrated:false});
 assert.equal(x.service.execute(claim()).reason,'GLOBAL_WRITER_FENCE_NOT_INTEGRATED');
 assert.equal(x.transactions,0);
});
test('poisoned native atomic store fails closed',()=>{
 const x=fixture({poisoned:true});
 assert.equal(x.service.execute(claim()).reason,'ATOMIC_STORE_POISONED');
 assert.equal(x.transactions,0);
});
test('native verified claim is durable and generation starts at one',()=>{
 const x=fixture();const r=x.service.execute(claim());
 assert.equal(r.status,'APPLIED');assert.equal(r.receipt.generation,1);
 assert.equal(x.rows.get(KEY).claims['500'].pilotID,'coop-pilot-001');
});
test('idempotent identical command never writes twice',()=>{
 const x=fixture();x.service.execute(claim());const writes=x.writes;
 assert.equal(x.service.execute(claim()).status,'DUPLICATE');
 assert.equal(x.writes,writes);
});
test('operation key reused with different actor is denied',()=>{
 const x=fixture();x.service.execute(claim());
 assert.equal(x.service.execute(claim({entityID:501})).reason,'OPERATION_REPLAY_CONFLICT');
});
test('duplicate pilot or entity on another operation denied',()=>{
 const x=fixture();x.service.execute(claim());
 assert.equal(x.service.execute(claim({operationID:'pf-op-002',entityID:501}))
  .reason,'PF_ACTOR_RESERVED_OR_INVALID');
 assert.equal(x.service.execute(claim({operationID:'pf-op-003',
  pilotID:'coop-pilot-002'})).reason,'PF_ACTOR_RESERVED_OR_INVALID');
});
test('WAR reservation denies even if personal registry empty',()=>{
 const x=fixture({war:{version:1,ships:{500:{entityID:500,pilotID:'coop-pilot-999'}}}});
 assert.equal(x.service.execute(claim()).reason,'WAR_ACTOR_RESERVED');
});
test('WAR registry corruption denies claim',()=>{
 const x=fixture({war:{version:9,ships:{}}});
 assert.equal(x.service.execute(claim()).reason,'WAR_REGISTRY_UNVERIFIED');
});
test('in-flight WAR transfer denies claim',()=>{
 const x=fixture({war:{version:1,ships:{},transfers:{
  '500':{entityID:500,pilotID:'coop-pilot-999',phase:'PREPARED'}}}});
 assert.equal(x.service.execute(claim()).reason,'WAR_ACTOR_RESERVED');
});
test('unproven mining actor denies claim',()=>{
 const x=fixture({miningFree:false});
 assert.equal(x.service.execute(claim()).reason,'NATIVE_OR_CLAIM_UNVERIFIED');
});
test('unproven other directors deny claim',()=>{
 const x=fixture({otherFree:false});
 assert.equal(x.service.execute(claim()).reason,'NATIVE_OR_CLAIM_UNVERIFIED');
});
test('missing physical native proof denies claim',()=>{
 const x=fixture({nativeReady:false});
 assert.equal(x.service.execute(claim()).reason,'NATIVE_OR_CLAIM_UNVERIFIED');
});
test('release must match generation and assignment',()=>{
 const x=fixture();x.service.execute(claim());
 const base={...claim(),type:'RELEASE',operationID:'pf-op-rel-1'};
 assert.equal(x.service.execute({...base,expectedGeneration:9})
  .reason,'STALE_OR_FOREIGN_CLAIM');
 assert.equal(x.service.execute({...base,expectedGeneration:1,
  assignmentID:'different-assignment'}).reason,'STALE_OR_FOREIGN_CLAIM');
 assert.equal(x.service.execute({...base,expectedGeneration:1}).status,'APPLIED');
 assert.equal(x.rows.get(KEY).claims['500'],undefined);
});
test('release requires original native proof',()=>{
 const x=fixture({releaseReady:false});x.service.execute(claim());
 assert.equal(x.service.execute({...claim(),type:'RELEASE',operationID:'pf-op-rel-1',
  expectedGeneration:1}).reason,'NATIVE_RELEASE_UNVERIFIED');
});
test('new claim after release advances generation to fence stale commands',()=>{
 const x=fixture();x.service.execute(claim());
 x.service.execute({...claim(),type:'RELEASE',operationID:'pf-op-rel-1',expectedGeneration:1});
 const result=x.service.execute(claim({operationID:'pf-op-new-1'}));
 assert.equal(result.receipt.generation,2);
});
test('corrupt stored claim cannot be treated as empty',()=>{
 const x=fixture();x.rows.set(KEY,{version:1,claims:{500:{bad:true}},generations:{500:1},processed:{}});
 assert.equal(x.service.execute(claim()).reason,'ATOMIC_CLAIM_UNAVAILABLE');
});
test('invalid operation identifier is blocked before native transaction',()=>{
 const x=fixture();assert.equal(x.service.execute(claim({operationID:'!'})).reason,'INVALID_COMMAND');
 assert.equal(x.transactions,0);
});
test('invalid registry shape rejects silently duplicated pilots',()=>{
 const v={version:1,claims:{
  500:{entityID:500,pilotID:'coop-pilot-001',ownerCharacterID:1,systemID:2,
   assignmentID:'a1',generation:1,ownerType:'PERSONAL_FLEET'},
  501:{entityID:501,pilotID:'coop-pilot-001',ownerCharacterID:1,systemID:2,
   assignmentID:'a2',generation:1,ownerType:'PERSONAL_FLEET'}},
  generations:{500:1,501:1},processed:{}};
 assert.throws(()=>validate(v),/PF_CLAIM_CORRUPT/);
});
