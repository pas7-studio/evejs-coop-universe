'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const {issue,step,replay,dispatchPreflight,valid}=
 require('../scripts/lib/personal-fleet-intents.cjs');
const cmd=(changes={})=>({operationID:'pf-order-001',fleetID:'pf-fleet-001',
 pilotID:'coop-pilot-001',nativeEntityID:500,systemID:30000144,
 issuerCharacterID:90,assignmentGeneration:7,fleetRevision:1,
 type:'FOLLOW',targetID:700,createdAt:1000,expiresAt:6000,
 payloadHash:'a'.repeat(64),...changes});
const actor=(changes={})=>({pilotID:'coop-pilot-001',nativeEntityID:500,
 systemID:30000144,ownerCharacterID:90,assignmentGeneration:7,
 custodyActive:true,...changes});
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
