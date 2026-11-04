'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const l=require('../scripts/lib/personal-fleet-loss-recovery.cjs');
const hash='a'.repeat(64);
const source={operationID:'pf-loss-001',pilotID:'coop-pilot-001',
 assignmentID:'pf-assignment-001',ownerCharacterID:90,originalShipItemID:500,
 nativeEntityID:500,systemID:30000144,generation:7,fittingHash:hash,cargoHash:hash};
const actor={type:'ORIGINAL_NATIVE_SHIP_AND_CONTROLLER',actorID:500,
 shipItemID:500,pilotID:'coop-pilot-001',systemID:30000144,
 generation:7,nativeExists:true};
const start=()=>{const r=l.begin({...source,trustedActor:actor});assert.equal(r.status,'ACTIVE');return r.record;};
const proof=(s,type,overrides={})=>({type,id:'proof-'+type,
 operationID:s.operationID,shipItemID:s.originalShipItemID,pilotID:s.pilotID,
 generation:s.generation,...overrides});
const step=(s,to,type,more={})=>l.advance(s,{to,expectedRevision:s.revision,
 now:10000+s.revision,proof:proof(s,type,more)});
const pending=()=>step(start(),'LOSS_PENDING','ORIGINAL_NATIVE_WRECK_INTENT',{
 wreckID:700,systemID:30000144,originalNativeWreckObserved:true}).record;
const confirmed=()=>step(pending(),'LOSS_CONFIRMED','ORIGINAL_NATIVE_WRECK_CONFIRMED',{
 wreckID:700,systemID:30000144,originalNativeShipAbsent:true,
 originalHangarShipAbsent:true,wreckItemIdentityVerified:true,
 nativeLossLedgerCommitted:true}).record;
const life=()=>step(confirmed(),'CLONE_RECOVERING',
 'DURABLE_CLONE_RECOVERY_STARTED',{readyAt:50000,
 durablePilotStatus:'RECOVERING',originalShipNotRestored:true}).record;
const observation=(overrides={})=>({nativeShip:null,hangarItem:null,
 wreck:{wreckID:700,originalShipItemID:500,systemID:30000144},
 lossLedger:{wreckID:700,shipItemID:500,status:'COMMITTED'},
 pilotLife:{pilotID:'coop-pilot-001',status:'RECOVERING'},...overrides});
test('real native actor is required for initial record',()=>{
 assert.equal(l.begin({...source,trustedActor:{...actor,nativeExists:false}}).reason,
 'PF_LOSS_ACTOR_UNVERIFIED');
});
test('active original ship can be tracked without creating second hull',()=>{
 const r=start();assert.equal(r.phase,'ACTIVE');assert.equal(r.originalShipItemID,500);
});
test('wreck pending needs original native wreck evidence',()=>{
 assert.equal(step(start(),'LOSS_PENDING','ORIGINAL_NATIVE_WRECK_INTENT').reason,
 'PF_LOSS_WRECK_UNVERIFIED');
});
test('confirmed loss requires missing physical hull and committed native ledger',()=>{
 assert.equal(step(pending(),'LOSS_CONFIRMED','ORIGINAL_NATIVE_WRECK_CONFIRMED',{
 wreckID:700,systemID:30000144,originalNativeShipAbsent:true,
 originalHangarShipAbsent:true,wreckItemIdentityVerified:true,
 nativeLossLedgerCommitted:false}).reason,'PF_LOSS_PHYSICAL_CONSERVATION_UNVERIFIED');
});
test('confirmed loss preserves original wreck ID',()=>{
 assert.equal(confirmed().wreckID,700);
});
test('clone recovers pilot, never restores original ship',()=>{
 const r=life();assert.equal(r.phase,'CLONE_RECOVERING');
 assert.equal(r.originalShipItemID,500);
});
test('clone cannot become available early',()=>{
 const r=life();
 assert.equal(l.advance(r,{to:'PILOT_AVAILABLE',expectedRevision:r.revision,
 now:40000,proof:proof(r,'ORIGINAL_CLONE_RECOVERY_CONFIRMED',{
 originalCloneReady:true,originalShipNotRestored:true,
 pilotStillUnassigned:true,wreckID:700})}).reason,'PF_CLONE_RECOVERY_UNVERIFIED');
});
test('clone ready still requires independent native receipt',()=>{
 const r=life();
 assert.equal(l.advance(r,{to:'PILOT_AVAILABLE',expectedRevision:r.revision,
 now:60000,proof:proof(r,'ORIGINAL_CLONE_RECOVERY_CONFIRMED',{
 originalCloneReady:true,originalShipNotRestored:false,
 pilotStillUnassigned:true,wreckID:700})}).reason,'PF_CLONE_RECOVERY_UNVERIFIED');
});
test('verified pilot recovery cannot regenerate ship',()=>{
 const r=life(),result=l.advance(r,{to:'PILOT_AVAILABLE',
 expectedRevision:r.revision,now:60000,
 proof:proof(r,'ORIGINAL_CLONE_RECOVERY_CONFIRMED',{
 originalCloneReady:true,originalShipNotRestored:true,
 pilotStillUnassigned:true,wreckID:700})});
 assert.equal(result.status,'APPLIED');assert.equal(result.record.originalShipItemID,500);
 assert.equal(result.record.wreckID,700);
});
test('loss cannot jump directly to available pilot',()=>{
 assert.equal(step(start(),'PILOT_AVAILABLE','ORIGINAL_CLONE_RECOVERY_CONFIRMED').reason,
 'PF_LOSS_ILLEGAL_TRANSITION');
});
test('replayed loss cannot update ledger or spawn',()=>{
 assert.deepEqual(l.replay(confirmed(),{operationID:'pf-loss-001',generation:7}),{
 status:'DUPLICATE',phase:'LOSS_CONFIRMED',spawnAllowed:false,
 ledgerMutationAllowed:false});
});
test('replayed loss with stale generation blocked',()=>{
 assert.equal(l.replay(confirmed(),{operationID:'pf-loss-001',generation:6}).reason,
 'PF_LOSS_REPLAY_CONFLICT');
});
test('ambiguous native observation never proves destruction',()=>{
 assert.equal(l.assessRestart(start(),{}).status,'NEEDS_RECONCILIATION');
});
test('missing ship with no wreck does not respawn',()=>{
 const r=l.assessRestart(start(),observation({wreck:null}));
 assert.equal(r.status,'NEEDS_RECONCILIATION');
 assert.equal(r.reason,'PF_ORIGINAL_SHIP_UNLOCATED');
});
test('native ship and wreck together need operator repair',()=>{
 const r=l.assessRestart(confirmed(),observation({nativeShip:{
 entityID:500,originalShipItemID:500,systemID:30000144,
 pilotID:'coop-pilot-001',controllerVerified:true}}));
 assert.equal(r.reason,'PF_SHIP_AND_WRECK_BOTH_PRESENT');
});
test('hangar and wreck together need operator repair',()=>{
 assert.equal(l.assessRestart(confirmed(),observation({hangarItem:{
 itemID:500,ownerCharacterID:90}})).reason,'PF_HANGAR_AND_WRECK_BOTH_PRESENT');
});
test('recovered pilot has no original ship reconstitution',()=>{
 const r=l.assessRestart(life(),observation());
 assert.equal(r.status,'ORIGINAL_SHIP_CONFIRMED_LOST');
 assert.equal(r.spawnAllowed,false);
 assert.equal(r.originalShipRestored,false);
});
test('wrong wreck original item is not valid loss proof',()=>{
 const r=l.assessRestart(confirmed(),observation({
 wreck:{wreckID:700,originalShipItemID:501,systemID:30000144}}));
 assert.equal(r.reason,'PF_WRECK_LEDGER_DISAGREES');
});
test('pending native loss ledger does not prove committed loss',()=>{
 assert.equal(l.assessRestart(confirmed(),observation({lossLedger:{
 wreckID:700,shipItemID:500,status:'PENDING'}})).reason,
 'PF_WRECK_LEDGER_DISAGREES');
});
test('original ship reappearing after confirmed loss is operator blocker',()=>{
 const r=l.assessRestart(confirmed(),observation({
 wreck:null,nativeShip:{entityID:500,originalShipItemID:500,systemID:30000144,
 pilotID:'coop-pilot-001',controllerVerified:true}}));
 assert.equal(r.reason,'PF_LOST_SHIP_REAPPEARED');
});
test('stale revision denies loss confirmation',()=>{
 const r=pending();
 assert.equal(l.advance(r,{to:'LOSS_CONFIRMED',expectedRevision:0,
 now:10002,proof:proof(r,'ORIGINAL_NATIVE_WRECK_CONFIRMED')}).reason,
 'PF_LOSS_REVISION_STALE');
});
test('unknown loss intent cannot be redispatched',()=>{
 const r=step(pending(),'OUTCOME_UNKNOWN','ORIGINAL_NATIVE_LOSS_OUTCOME_UNCERTAIN').record;
 assert.equal(step(r,'LOSS_CONFIRMED','ORIGINAL_NATIVE_WRECK_CONFIRMED').reason,
 'PF_LOSS_ILLEGAL_TRANSITION');
});

test('recovered phase requires available pilot status in native life registry',()=>{
 const active=life();
 const r=l.advance(active,{to:'PILOT_AVAILABLE',expectedRevision:active.revision,
 now:60000,proof:proof(active,'ORIGINAL_CLONE_RECOVERY_CONFIRMED',{
 originalCloneReady:true,originalShipNotRestored:true,
 pilotStillUnassigned:true,wreckID:700})}).record;
 assert.equal(l.assessRestart(r,observation()).reason,'PF_PILOT_LIFE_UNVERIFIED');
 assert.equal(l.assessRestart(r,observation({pilotLife:{
 pilotID:'coop-pilot-001',status:'AVAILABLE'}})).status,
 'ORIGINAL_SHIP_CONFIRMED_LOST');
});


test('PF-14: destroyed hull phase with no original wreck is corrupt',()=>{
 assert.equal(l.assessRestart({...start(),phase:'LOSS_CONFIRMED'},{}).reason,
 'PF_LOSS_RECORD_CORRUPT');
});
test('PF-14: mismatched durable loss revision is corrupt',()=>{
 assert.equal(l.replay({...start(),revision:1},{
 operationID:'pf-loss-001',generation:7}).reason,
 'PF_LOSS_RECORD_CORRUPT');
});
test('PF-14: unknown native receipt type cannot confirm original loss',()=>{
 assert.equal(l.replay({...start(),phase:'LOSS_PENDING',revision:1,
 wreckID:700,proofs:[{id:'fake-01',type:'FAKE_WRECK'}]},{
 operationID:'pf-loss-001',generation:7}).reason,
 'PF_LOSS_RECORD_CORRUPT');
});
