'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const {prepare,advance,observe}=require('../scripts/lib/personal-fleet-custody.cjs');
const h='a'.repeat(64),c='b'.repeat(64);
const ids={operationID:'pf-op-001',assignmentID:'pf-a1',pilotID:'coop-pilot-001',
 ownerCharacterID:90,shipItemID:500,systemID:30000144,generation:1,fittingHash:h,cargoHash:c};
const proof=(type,other={})=>({type,proofID:'proof-'+type,shipItemID:500,
 assignmentID:'pf-a1',generation:1,...other});
const initial=()=>prepare({...ids,proof:proof('ORIGINAL_HANGAR_ITEM_VERIFIED',{
 ownerCharacterID:90,systemID:30000144,fittingHash:h,cargoHash:c,exclusiveUnavailable:true})}).record;
const advanceOne=(record,to,type,other={})=>advance(record,{to,expectedRevision:record.revision,
 expectedGeneration:record.generation,proof:proof(type,other)});
test('prepare requires exclusive custody',()=>assert.equal(prepare({...ids}).reason,'ORIGINAL_HANGAR_CUSTODY_UNVERIFIED'));
test('prepare accepts exact original owner and hash witness',()=>assert.equal(initial().phase,'PREPARED'));
test('rejects forged item identity',()=>assert.equal(prepare({...ids,shipItemID:501,proof:proof('ORIGINAL_HANGAR_ITEM_VERIFIED',{ownerCharacterID:90,systemID:30000144,fittingHash:h,cargoHash:c,exclusiveUnavailable:true})}).reason,'ORIGINAL_HANGAR_CUSTODY_UNVERIFIED'));
test('PREPARED cannot turn ACTIVE from an ACK',()=>assert.equal(advanceOne(initial(),'ACTIVE','ORIGINAL_NATIVE_ACTOR_VERIFIED').reason,'ILLEGAL_CUSTODY_TRANSITION'));
test('PREPARED to NATIVE_REQUESTED requires durable dispatch intent',()=>assert.equal(advanceOne(initial(),'NATIVE_REQUESTED','NATIVE_DISPATCH_INTENT_DURABLE').status,'APPLIED'));
test('native activation needs exact original item and fitting hashes',()=>{let r=advanceOne(initial(),'NATIVE_REQUESTED','NATIVE_DISPATCH_INTENT_DURABLE').record;assert.equal(advanceOne(r,'ACTIVE','ORIGINAL_NATIVE_ACTOR_VERIFIED').reason,'NATIVE_ITEM_CONSERVATION_UNVERIFIED');assert.equal(advanceOne(r,'ACTIVE','ORIGINAL_NATIVE_ACTOR_VERIFIED',{originalItemID:500,fittingHash:h,cargoHash:c,singleLocation:true}).status,'APPLIED');});
test('repeated proof id cannot authorize second transition',()=>{let r=advanceOne(initial(),'NATIVE_REQUESTED','NATIVE_DISPATCH_INTENT_DURABLE').record;assert.equal(advanceOne(r,'ACTIVE','ORIGINAL_NATIVE_ACTOR_VERIFIED',{proofID:'proof-ORIGINAL_HANGAR_ITEM_VERIFIED',originalItemID:500,fittingHash:h,cargoHash:c,singleLocation:true}).reason,'EVIDENCE_REPLAY_CONFLICT');});
test('generation fences stale callback',()=>assert.equal(advance(initial(),{to:'NATIVE_REQUESTED',expectedRevision:0,expectedGeneration:2,proof:proof('NATIVE_DISPATCH_INTENT_DURABLE')}).reason,'STALE_CUSTODY_FENCE'));
test('original lost ship requires native wreck and system',()=>{let r=advanceOne(initial(),'NATIVE_REQUESTED','NATIVE_DISPATCH_INTENT_DURABLE').record;r=advanceOne(r,'ACTIVE','ORIGINAL_NATIVE_ACTOR_VERIFIED',{originalItemID:500,fittingHash:h,cargoHash:c,singleLocation:true}).record;assert.equal(advanceOne(r,'CONFIRMED_LOST','NATIVE_WRECK_VERIFIED',{wreckID:22}).reason,'WRECK_EVIDENCE_UNVERIFIED');assert.equal(advanceOne(r,'CONFIRMED_LOST','NATIVE_WRECK_VERIFIED',{wreckID:22,systemID:30000144}).status,'APPLIED');});
test('dock needs original item in hangar AND absent native ship',()=>{let r=advanceOne(initial(),'NATIVE_REQUESTED','NATIVE_DISPATCH_INTENT_DURABLE').record;r=advanceOne(r,'ACTIVE','ORIGINAL_NATIVE_ACTOR_VERIFIED',{originalItemID:500,fittingHash:h,cargoHash:c,singleLocation:true}).record;r=advanceOne(r,'RETURN_REQUESTED','RETURN_INTENT_DURABLE').record;r=advanceOne(r,'DOCKING','NATIVE_STATION_APPROACH_VERIFIED').record;assert.equal(advanceOne(r,'COMMITTED_DOCKED','ORIGINAL_HANGAR_CUSTODY_VERIFIED',{originalItemID:500,fittingHash:h,cargoHash:c,singleLocation:true}).reason,'NATIVE_SHIP_STILL_PRESENT');assert.equal(advanceOne(r,'COMMITTED_DOCKED','ORIGINAL_HANGAR_CUSTODY_VERIFIED',{originalItemID:500,fittingHash:h,cargoHash:c,singleLocation:true,nativeActorAbsent:true}).status,'APPLIED');});
test('unknown observations quarantine not respawn',()=>assert.equal(observe(initial(),{}).status,'OUTCOME_UNKNOWN'));
test('same ship in hangar and native scene quarantines',()=>assert.equal(observe(initial(),{nativeEntity:{},hangarItem:{},wreck:null}).reason,'DUPLICATE_PHYSICAL_CUSTODY'));
test('exact native observation reports active without effect',()=>assert.equal(observe(initial(),{nativeEntity:{originalItemID:500,pilotID:'coop-pilot-001',systemID:30000144,fittingHash:h,cargoHash:c,controllerVerified:true},hangarItem:null,wreck:null}).status,'OBSERVED_ACTIVE'));
test('a missing ship without a wreck is NOT destroyed',()=>assert.equal(observe(initial(),{nativeEntity:null,hangarItem:null,wreck:null}).reason,'ORIGINAL_SHIP_LOCATION_UNKNOWN'));
test('observed valid wreck does not mint replacement',()=>assert.equal(observe(initial(),{nativeEntity:null,hangarItem:null,wreck:{wreckID:15,originalItemID:500}}).status,'OBSERVED_LOST'));
test('invalid native identity quarantines',()=>assert.equal(observe(initial(),{nativeEntity:{originalItemID:501},hangarItem:null,wreck:null}).reason,'NATIVE_ACTOR_IDENTITY_CONFLICT'));
