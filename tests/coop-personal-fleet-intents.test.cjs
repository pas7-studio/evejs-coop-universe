'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const {issue,step,replay,dispatchPreflight,reconcile,valid}=
 require('../scripts/lib/personal-fleet-intents.cjs');
const cmd=(changes={})=>({operationID:'pf-order-001',fleetID:'pf-fleet-001',
 pilotID:'coop-pilot-001',nativeEntityID:500,systemID:30000144,
 issuerCharacterID:90,assignmentGeneration:7,fleetRevision:1,
 type:'FOLLOW',targetID:700,createdAt:1000,expiresAt:6000,
 payloadHash:'a'.repeat(64),...changes});
const actor=(changes={})=>({pilotID:'coop-pilot-001',nativeEntityID:500,
 systemID:30000144,ownerCharacterID:90,assignmentGeneration:7,
 fleetRevision:1,custodyActive:true,...changes});
const authorized=(changes={})=>({now:1100,authenticatedIssuer:90,
 actorProof:actor(),targetPermitted:true,...changes});
const start=(c=cmd(),authority=authorized())=>{
 const r=issue(c,authority);assert.equal(r.status,'QUEUED',JSON.stringify(r));return r.intent;
};
const proof=(row,type,changes={})=>({id:'proof-'+type,type,
 operationID:row.operationID,nativeEntityID:row.nativeEntityID,
 assignmentGeneration:row.assignmentGeneration,...changes});
const move=(row,to,type,changes={})=>step(row,{to,expectedRevision:row.revision,
 now:1200+row.revision,proof:proof(row,type,changes)});
test('valid authenticated FOLLOW queues without native dispatch',()=>{
 const r=start();assert.equal(valid(r),true);assert.equal(r.phase,'QUEUED');
 assert.equal(r.receipts.length,0);
});
test('forged authenticated character denied',()=>assert.equal(
 issue(cmd(),authorized({authenticatedIssuer:91})).reason,'PF_ISSUER_UNAUTHORIZED'));
test('stale assignment generation denied',()=>assert.equal(
 issue(cmd(),authorized({actorProof:actor({assignmentGeneration:6})})).reason,
 'PF_ACTOR_CUSTODY_UNVERIFIED'));
test('native actor mismatch denied',()=>assert.equal(
 issue(cmd(),authorized({actorProof:actor({nativeEntityID:501})})).reason,
 'PF_ACTOR_CUSTODY_UNVERIFIED'));
test('missing original active custody denied',()=>assert.equal(
 issue(cmd(),authorized({actorProof:actor({custodyActive:false})})).reason,
 'PF_ACTOR_CUSTODY_UNVERIFIED'));
test('unverified target legality denied',()=>assert.equal(
 issue(cmd(),authorized({targetPermitted:false})).reason,
 'PF_TARGET_LEGALITY_UNVERIFIED'));
test('expired or overlong order denied',()=>{
 assert.equal(issue(cmd(),authorized({now:6000})).reason,'PF_INTENT_INVALID_OR_EXPIRED');
 assert.equal(issue(cmd({expiresAt:400000}),authorized()).reason,
 'PF_INTENT_INVALID_OR_EXPIRED');
});
test('ATTACK requires positive target and permission',()=>assert.equal(
 issue(cmd({type:'ATTACK',targetID:null}),authorized()).reason,'PF_INTENT_INVALID_OR_EXPIRED'));
test('RETREAT must not carry stale target ID',()=>{
 assert.equal(issue(cmd({type:'RETREAT',targetID:700}),authorized()).reason,
 'PF_INTENT_INVALID_OR_EXPIRED');
 assert.equal(issue(cmd({type:'RETREAT',targetID:null}),authorized()).status,'QUEUED');
});
test('supported RETURN_TO_BASE can queue but does not dock',()=>{
 const r=start(cmd({type:'RETURN_TO_BASE',targetID:null}));
 assert.equal(r.phase,'QUEUED');
});
test('dispatch preflight checks arbiter and never executes order',()=>{
 const row=start();
 assert.equal(dispatchPreflight(row,{...authorized(),leaseAvailable:false}).reason,
 'PF_NATIVE_ARBITER_BLOCKED');
 assert.deepEqual(dispatchPreflight(row,{...authorized(),leaseAvailable:true}),
 {status:'READY_TO_FENCE',nativeAction:'follow'});
});
test('dispatch preflight revalidates rights and target at dispatch time',()=>{
 const row=start();
 assert.equal(dispatchPreflight(row,{...authorized({authenticatedIssuer:20}),
 leaseAvailable:true}).reason,'PF_ISSUER_UNAUTHORIZED');
 assert.equal(dispatchPreflight(row,{...authorized({targetPermitted:false}),
 leaseAvailable:true}).reason,'PF_TARGET_LEGALITY_UNVERIFIED');
});
test('ISSUING requires durable fence and increments revision',()=>{
 const row=start();
 assert.equal(move(row,'ISSUING','NATIVE_ORDER_ACK').reason,'PF_INTENT_EVIDENCE_REQUIRED');
 const x=move(row,'ISSUING','DURABLE_DISPATCH_FENCE');
 assert.equal(x.status,'APPLIED');assert.equal(x.intent.revision,1);
 assert.equal(row.phase,'QUEUED');
});
test('cannot acknowledge native completion from QUEUED',()=>assert.equal(
 move(start(),'COMPLETED','ORIGINAL_NATIVE_EFFECT_VERIFIED').reason,
 'PF_INTENT_ILLEGAL_TRANSITION'));
test('native ACK is not physical completion',()=>{
 let row=move(start(),'ISSUING','DURABLE_DISPATCH_FENCE').intent;
 row=move(row,'NATIVE_REQUESTED','NATIVE_ORDER_ACK').intent;
 assert.equal(row.phase,'NATIVE_REQUESTED');
 assert.equal(row.receipts.length,2);
});
test('physical completion requires independent native evidence',()=>{
 let row=move(start(),'ISSUING','DURABLE_DISPATCH_FENCE').intent;
 row=move(row,'NATIVE_REQUESTED','NATIVE_ORDER_ACK').intent;
 assert.equal(move(row,'COMPLETED','ORIGINAL_NATIVE_EFFECT_VERIFIED').reason,
 'PF_INTENT_NATIVE_COMPLETION_UNVERIFIED');
 assert.equal(move(row,'COMPLETED','ORIGINAL_NATIVE_EFFECT_VERIFIED',{
 effectType:'FOLLOW',systemID:30000144,physicalComplete:true}).status,'APPLIED');
});
test('wrong effect cannot complete order',()=>{
 let row=move(start(),'ISSUING','DURABLE_DISPATCH_FENCE').intent;
 row=move(row,'NATIVE_REQUESTED','NATIVE_ORDER_ACK').intent;
 assert.equal(move(row,'COMPLETED','ORIGINAL_NATIVE_EFFECT_VERIFIED',{
 effectType:'ATTACK',systemID:30000144,physicalComplete:true}).reason,
 'PF_INTENT_NATIVE_COMPLETION_UNVERIFIED');
});
test('ISSUING without definite native result becomes permanently unknown',()=>{
 let row=move(start(),'ISSUING','DURABLE_DISPATCH_FENCE').intent;
 row=move(row,'OUTCOME_UNKNOWN','NATIVE_OUTCOME_UNCERTAIN').intent;
 assert.equal(move(row,'ISSUING','DURABLE_DISPATCH_FENCE').reason,
 'PF_INTENT_ILLEGAL_TRANSITION');
 assert.equal(dispatchPreflight(row,{...authorized(),leaseAvailable:true}).reason,
 'PF_INTENT_ALREADY_DISPATCHED');
});
test('native definitive rejection cannot reissue same operation',()=>{
 let row=move(start(),'ISSUING','DURABLE_DISPATCH_FENCE').intent;
 row=move(row,'NATIVE_REJECTED','NATIVE_DEFINITE_NO_EFFECT').intent;
 assert.equal(replay(row,cmd()).status,'DUPLICATE');
 assert.equal(dispatchPreflight(row,{...authorized(),leaseAvailable:true}).reason,
 'PF_INTENT_ALREADY_DISPATCHED');
});
test('duplicate operation returns prior state without native action',()=>{
 const row=start();assert.deepEqual(replay(row,cmd()),{
 status:'DUPLICATE',phase:'QUEUED',revision:0,dispatchAllowed:false});
});
test('same operation ID but changed payload rejected',()=>{
 const row=start();assert.equal(replay(row,{operationID:row.operationID,
 payloadHash:'b'.repeat(64)}).reason,'PF_INTENT_REPLAY_CONFLICT');
});
test('stale revision blocks late ACK',()=>{
 const row=move(start(),'ISSUING','DURABLE_DISPATCH_FENCE').intent;
 assert.equal(step(row,{to:'NATIVE_REQUESTED',expectedRevision:0,now:1400,
 proof:proof(row,'NATIVE_ORDER_ACK')}).reason,'PF_INTENT_STALE_REVISION');
});
test('reused native proof ID across phases rejected',()=>{
 const row=move(start(),'ISSUING','DURABLE_DISPATCH_FENCE').intent;
 assert.equal(move(row,'NATIVE_REQUESTED','NATIVE_ORDER_ACK',{
 id:'proof-DURABLE_DISPATCH_FENCE'}).reason,'PF_INTENT_PROOF_REPLAY');
});
test('expired queued dispatch cannot start after TTL',()=>{
 const row=start();assert.equal(dispatchPreflight(row,{...authorized({now:6001}),
 leaseAvailable:true}).reason,'PF_INTENT_EXPIRED');
});
test('malformed durable row fails closed',()=>{
 const row={...start(),nativeEntityID:0};
 assert.equal(replay(row,cmd()).reason,'PF_INTENT_RECORD_CORRUPT');
});

test('initial fleet revision zero is a valid authoritative snapshot',()=>{
 const r=issue(cmd({fleetRevision:0}),authorized({actorProof:actor({fleetRevision:0})}));
 assert.equal(r.status,'QUEUED');assert.equal(r.intent.fleetRevision,0);
});

test('stale fleet roster revision cannot issue or dispatch',()=>{
 assert.equal(issue(cmd(),authorized({actorProof:actor({fleetRevision:2})})).reason,
  'PF_ACTOR_CUSTODY_UNVERIFIED');
 const row=start();
 assert.equal(dispatchPreflight(row,{...authorized({
  actorProof:actor({fleetRevision:2})}),leaseAvailable:true}).reason,
  'PF_ACTOR_CUSTODY_UNVERIFIED');
});
const unknown=()=>{
 let row=move(start(),'ISSUING','DURABLE_DISPATCH_FENCE').intent;
 return move(row,'OUTCOME_UNKNOWN','NATIVE_OUTCOME_UNCERTAIN').intent;
};
const reconciliation=(row,to,rest={})=>({
 type:'INDEPENDENT_NATIVE_RECONCILIATION',id:'reconcile-001',
 operationID:row.operationID,nativeEntityID:row.nativeEntityID,
 assignmentGeneration:row.assignmentGeneration,payloadHash:row.payloadHash,
 resolvedPhase:to,...rest
});
test('unknown outcome cannot reconcile from an untrusted receipt',()=>{
 const row=unknown();
 assert.equal(reconcile(row,{to:'NATIVE_REQUESTED',expectedRevision:row.revision,
  proof:{type:'INDEPENDENT_NATIVE_RECONCILIATION'}}).reason,
  'PF_INTENT_RECONCILIATION_PROOF_REQUIRED');
});
test('unknown outcome cannot be marked definitive rejection without no-issue proof',()=>{
 const row=unknown();
 assert.equal(reconcile(row,{to:'NATIVE_REJECTED',expectedRevision:row.revision,
  proof:reconciliation(row,'NATIVE_REJECTED')}).reason,
  'PF_INTENT_NATIVE_RECONCILIATION_INCOMPLETE');
});
test('independent native in-flight proof can resolve unknown without redispatch',()=>{
 const row=unknown();
 const r=reconcile(row,{to:'NATIVE_REQUESTED',expectedRevision:row.revision,
  proof:reconciliation(row,'NATIVE_REQUESTED',{originalNativeInFlight:true})});
 assert.equal(r.status,'RECONCILED');assert.equal(r.intent.phase,'NATIVE_REQUESTED');
 assert.equal(dispatchPreflight(r.intent,{...authorized(),leaseAvailable:true}).reason,
  'PF_INTENT_ALREADY_DISPATCHED');
});
test('verified original physical completion can resolve unknown',()=>{
 const row=unknown();
 const r=reconcile(row,{to:'COMPLETED',expectedRevision:row.revision,
  proof:reconciliation(row,'COMPLETED',{originalEffectComplete:true,
   effectType:'FOLLOW',systemID:30000144})});
 assert.equal(r.status,'RECONCILED');assert.equal(r.intent.phase,'COMPLETED');
});
test('unknown reconciliation cannot replace a newer revision or be replayed',()=>{
 const row=unknown();const proof=reconciliation(row,'COMPLETED',
  {originalEffectComplete:true,effectType:'FOLLOW',systemID:30000144});
 assert.equal(reconcile(row,{to:'COMPLETED',expectedRevision:0,proof}).reason,
  'PF_INTENT_STALE_REVISION');
 const r=reconcile(row,{to:'COMPLETED',expectedRevision:row.revision,proof});
 assert.equal(reconcile(r.intent,{to:'COMPLETED',expectedRevision:r.intent.revision,proof}).reason,
  'PF_INTENT_NOT_UNKNOWN');
});


test('PF-13: same operation ID/hash but different target cannot replay',()=>{
 const row=start();
 assert.equal(replay(row,cmd({targetID:701})).reason,'PF_INTENT_REPLAY_CONFLICT');
});
test('PF-13: same operation ID/hash cannot swap command type',()=>{
 const row=start();
 assert.equal(replay(row,cmd({type:'ATTACK'})).reason,'PF_INTENT_REPLAY_CONFLICT');
});
test('PF-13: same operation ID/hash cannot reuse a new assignment generation',()=>{
 const row=start();
 assert.equal(replay(row,cmd({assignmentGeneration:8})).reason,
 'PF_INTENT_REPLAY_CONFLICT');
});


test('PF-14: duplicated persisted proof IDs fail closed',()=>{
 const r=start(),receipt={id:'reused-proof',type:'DURABLE_DISPATCH_FENCE'};
 assert.equal(replay({...r,phase:'ISSUING',revision:2,receipts:[receipt,receipt]},cmd()).reason,
 'PF_INTENT_RECORD_CORRUPT');
});
test('PF-14: mismatched revision and receipt count are corrupt',()=>{
 const r=start();
 assert.equal(dispatchPreflight({...r,revision:1},{
 ...authorized(),leaseAvailable:true}).reason,'PF_INTENT_RECORD_CORRUPT');
});
test('PF-14: forged durable receipt type is rejected',()=>{
 const r=start();
 assert.equal(replay({...r,phase:'ISSUING',revision:1,
 receipts:[{id:'fake-01',type:'SYNTHETIC_SUCCESS'}]},cmd()).reason,
 'PF_INTENT_RECORD_CORRUPT');
});


test('PF-14: terminal completed state without native completion proof is corrupt',()=>{
 const r=start();
 assert.equal(replay({...r,phase:'COMPLETED',revision:1,
 receipts:[{id:'fence-only',type:'DURABLE_DISPATCH_FENCE'}]},cmd()).reason,
 'PF_INTENT_RECORD_CORRUPT');
});
