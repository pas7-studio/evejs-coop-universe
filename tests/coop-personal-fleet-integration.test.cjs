'use strict';
// PF-09 integration tests for portable pure modules. This is NOT a native
// GameStore, does not create ships, pay ISK or authorize a live client.
const test=require('node:test'),assert=require('node:assert/strict');
const roster=require('../scripts/lib/personal-fleet-roster.cjs');
const claim=require('../scripts/lib/personal-fleet-claims.cjs');
const loss=require('../scripts/lib/personal-fleet-loss-recovery.cjs');
const payroll=require('../scripts/lib/personal-fleet-payroll.cjs');
const H='a'.repeat(64);
const pilotID='coop-pilot-001',shipItemID=500,systemID=30000144;
function fixture(){
 const rows=new Map();
 const atomic={isPoisoned:()=>false,transact(tables,fn){
  assert.deepEqual(tables,['corporationRuntime']);
  const tx={get(_t,key){return rows.has(key)?structuredClone(rows.get(key)):null;},
   put(_t,key,value){rows.set(key,structuredClone(value));}};
  return fn(tx);
 }};
 const claims=claim.createPersonalFleetClaims({gameStore:{coopAtomicNativeRows:atomic},
  enabled:()=>true,writersIntegrated:()=>true,
  verifyNativeActor:()=>true,verifyMiningFree:()=>true,
  verifyOtherClaimsFree:()=>true,verifyRelease:()=>true});
 let state=roster.empty(90,'pf-fleet-001');
 const command=(type,id,fields={})=>({type,operationID:id,
  expectedRevision:state.revision,payloadHash:H,...fields});
 const apply=(cmd,proofs)=>{const x=roster.apply(state,cmd,proofs);
  if(x.status==='APPLIED')state=x.state;return x;};
 return {claims,rows,command,apply,get state(){return state}};
}
const preparePilot=x=>x.apply(x.command('HIRE','hire-1',{pilotID,
 contractID:'contract-1',hireReceipt:'b'.repeat(64)}),{verifiedHire:true});
const getClaim=x=>x.claims.execute({type:'CLAIM',operationID:'claim-1',
 entityID:shipItemID,pilotID,ownerCharacterID:90,assignmentID:'assignment-1',systemID});
const assign=(x)=>x.apply(x.command('ASSIGN','assign-1',{
 pilotID,shipItemID,expectedPilotRevision:0}),{verifiedCustody:true});
const startLoss=()=>{
 const r=loss.begin({operationID:'loss-1',pilotID,assignmentID:'assignment-1',
 ownerCharacterID:90,originalShipItemID:shipItemID,nativeEntityID:shipItemID,
 systemID,generation:1,fittingHash:H,cargoHash:H,
 trustedActor:{type:'ORIGINAL_NATIVE_SHIP_AND_CONTROLLER',actorID:shipItemID,
 shipItemID,pilotID,systemID,generation:1,nativeExists:true}});
 assert.equal(r.status,'ACTIVE');return r.record;
};
const lossProof=(row,type,extras={})=>({type,id:'proof-'+type,
 operationID:row.operationID,shipItemID,pilotID,generation:1,...extras});
const advance=(row,to,type,extras={},now=10000)=>loss.advance(row,{
 to,expectedRevision:row.revision,now,
 proof:lossProof(row,type,extras)});
const confirmedLoss=()=>{
 let r=startLoss();
 r=advance(r,'LOSS_PENDING','ORIGINAL_NATIVE_WRECK_INTENT',
 {wreckID:700,systemID,originalNativeWreckObserved:true}).record;
 return advance(r,'LOSS_CONFIRMED','ORIGINAL_NATIVE_WRECK_CONFIRMED',
 {wreckID:700,systemID,originalNativeShipAbsent:true,originalHangarShipAbsent:true,
 wreckItemIdentityVerified:true,nativeLossLedgerCommitted:true}).record;
};
test('hire -> exclusive claim -> assign preserves same physical ship',()=>{
 const x=fixture();assert.equal(preparePilot(x).status,'APPLIED');
 assert.equal(getClaim(x).status,'APPLIED');
 assert.equal(assign(x).status,'APPLIED');
 assert.equal(x.state.pilots[pilotID].shipItemID,shipItemID);
 assert.equal(x.rows.get(claim.KEY).claims[String(shipItemID)].generation,1);
});
test('unverified wreck cannot remove original ship from roster',()=>{
 const x=fixture();preparePilot(x);getClaim(x);assign(x);
 const result=x.apply(x.command('RECORD_LOSS','record-loss-1',{
 pilotID,shipItemID,wreckID:700,expectedPilotRevision:1}),{});
 assert.equal(result.reason,'PF_ORIGINAL_SHIP_LOSS_UNVERIFIED');
 assert.equal(x.state.pilots[pilotID].shipItemID,shipItemID);
});
test('native confirmed wreck moves pilot to recovery and never recreates hull',()=>{
 const x=fixture();preparePilot(x);getClaim(x);assign(x);
 const lost=confirmedLoss();
 assert.equal(lost.phase,'LOSS_CONFIRMED');
 const changed=x.apply(x.command('RECORD_LOSS','record-loss-1',{
 pilotID,shipItemID,wreckID:700,expectedPilotRevision:1}),{verifiedLoss:true});
 assert.equal(changed.status,'APPLIED');
 assert.equal(x.state.pilots[pilotID].status,'RECOVERING');
 assert.equal(x.state.pilots[pilotID].shipItemID,null);
 assert.equal(x.apply(x.command('ASSIGN','assign-2',{
 pilotID,shipItemID:999,expectedPilotRevision:2}),{verifiedCustody:true})
 .reason,'PF_SHIP_CUSTODY_OR_PILOT_UNAVAILABLE');
});
test('clone recovery leaves pilot idle and requires new physical claim',()=>{
 const x=fixture();preparePilot(x);getClaim(x);assign(x);
 x.apply(x.command('RECORD_LOSS','record-loss-1',{
 pilotID,shipItemID,wreckID:700,expectedPilotRevision:1}),{verifiedLoss:true});
 assert.equal(x.apply(x.command('RECOVER_PILOT','recover-1',{
 pilotID,expectedPilotRevision:2}),{}).reason,'PF_CLONE_RECOVERY_UNVERIFIED');
 assert.equal(x.apply(x.command('RECOVER_PILOT','recover-1',{
 pilotID,expectedPilotRevision:2}),{verifiedRecovery:true}).status,'APPLIED');
 assert.equal(x.state.pilots[pilotID].status,'CONTRACTED');
 assert.equal(x.state.pilots[pilotID].shipItemID,null);
});
test('lost original ship claim remains reserved until verified native release',()=>{
 const x=fixture();preparePilot(x);getClaim(x);assign(x);
 assert.equal(x.claims.execute({type:'CLAIM',operationID:'claim-2',
 entityID:501,pilotID,ownerCharacterID:90,assignmentID:'assignment-2',
 systemID}).reason,'PF_ACTOR_RESERVED_OR_INVALID');
 assert.equal(x.claims.execute({type:'RELEASE',operationID:'release-1',
 entityID:shipItemID,pilotID,ownerCharacterID:90,assignmentID:'assignment-1',
 expectedGeneration:2}).reason,'STALE_OR_FOREIGN_CLAIM');
 assert.equal(x.claims.execute({type:'RELEASE',operationID:'release-1',
 entityID:shipItemID,pilotID,ownerCharacterID:90,assignmentID:'assignment-1',
 expectedGeneration:1}).status,'APPLIED');
 assert.equal(x.rows.get(claim.KEY).claims[String(shipItemID)],undefined);
});
test('same contracted pilot salary period cannot be billed twice after loss',()=>{
 const input={invoiceID:'invoice-1',contractID:'contract-1',pilotID,
 employerCharacterID:90,payerWalletID:100,payeeWalletID:200,periodStart:1000,
 periodEnd:2000,salaryISK:250,arrearsISK:0,contractRevisionHash:H};
 const authority={authenticatedEmployer:90,periodUnbilled:true,
 activeContract:{contractID:'contract-1',pilotID,employerCharacterID:90,
 payerWalletID:100,payeeWalletID:200,revisionHash:H,
 salaryISK:250,activeThroughoutPeriod:true}};
 const invoice=payroll.accrue(input,authority);assert.equal(invoice.status,'DUE');
 const ledger=payroll.insertInvoice(payroll.emptyLedger(),invoice.invoice,
  {expectedRevision:0});
 assert.equal(ledger.status,'INSERTED');
 const duplicate=payroll.accrue({...input,invoiceID:'invoice-2'},authority);
 assert.equal(payroll.insertInvoice(ledger.ledger,duplicate.invoice,
  {expectedRevision:1}).reason,'PF_PAYROLL_PERIOD_OVERLAP');
});
