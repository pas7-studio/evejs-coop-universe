'use strict';
const {test}=require('node:test'),assert=require('node:assert/strict');
const fs=require('node:fs'),path=require('node:path'),vm=require('node:vm');
const consent=require('../native/coopPersonalFleetOriginalPayrollConsent');
const code=fs.readFileSync(path.join(__dirname,'../native/coopPersonalFleetOriginalPayrollScheduler.js'),'utf8');
const P='coop-personal-fleet\u001f',T='corporationRuntime',
 PILOT='coop-pilot-123456',OWNER=90000001,ACCOUNT=77,CONTRACT='pf-contract-90000001-123456-1',
 START=1700000000000,PERIOD=86400000;
function fixture({now=START+PERIOD}={}){
 let clock=now,enabled=true,fenced=true,poison=false,commitUnknown=false,
  chargeBlocked=false,mutateOnUnknown=false;
 const wage=consent.captureOfferWageConsent({
  salaryConsentRequired:true,salaryCents:2750,periodMs:PERIOD,
  sourceProof:'a'.repeat(64),expiresAtMs:START+900000,
  offerID:'pf-offer-90000001-123456',revision:1,
  contractID:CONTRACT,pilotID:PILOT,ownerCharacterID:OWNER,
  employerCorpID:1002000,amountCents:3500},
  {operationID:'pf-hire-1',offerID:'pf-offer-90000001-123456',offerRevision:1,
   contractID:CONTRACT,pilotID:PILOT,ownerCharacterID:OWNER,
   session:{userid:ACCOUNT,characterID:OWNER,socket:{destroyed:false}},
   recurringSalaryAcknowledged:true},START);
 if(!wage)throw Error('TEST_CONSENT_FAILED');
 const paid={status:'PAID',operationID:'pf-hire-1',offerID:wage.offerID,
  offerRevision:1,amountCents:3500,createdAtMs:START,ownerCharacterID:OWNER,
  pilotID:PILOT,contractID:CONTRACT,employerCorpID:1002000,
  hireReceiptHash:'b'.repeat(64),payrollConsent:wage};
 const index={version:1,pilots:{[PILOT]:{pilotID:PILOT,ownerCharacterID:OWNER,
  contractID:CONTRACT,hireReceiptHash:paid.hireReceiptHash}},
  contracts:{[CONTRACT]:PILOT},processed:{'pf-hire-1':{
   receipt:{type:'HIRED',pilotID:PILOT,contractID:CONTRACT}}}};
 const roster={pilots:{[PILOT]:{pilotID:PILOT,status:'CONTRACTED',
  contractID:CONTRACT,hireReceiptHash:paid.hireReceiptHash}}};
 const ledger={version:1,contracts:{},processed:{},closedContracts:{},losses:{}};
 const values={
  [P+'hangar-reservations-v1']:index,
  [P+'hangar-roster-v1:'+OWNER]:roster,
  [P+'contract-lifecycle-v1']:ledger,
  [P+'paid-hire-v1:pf-hire-1']:paid,
  [consent.consentKey('pf-hire-1')]:wage};
 const characters={[''+OWNER]:{characterID:OWNER,accountId:ACCOUNT}};
 const state={calls:[],poison};
 const atomic={mode:'SERVER_INTERNAL_FLAGGED',
  isPoisoned:()=>poison,transact:(tables,fn)=>{
   assert.deepEqual(Array.from(tables),[T,'characters']);
   return fn({get:(table,key)=>table===T?values[key]??null:characters[key]??null});
  }};
 const pf52={REGISTRY_KEY:P+'hangar-reservations-v1',ROSTER_PREFIX:P+'hangar-roster-v1:',
  validateIndex:x=>x,validateRoster:x=>x};
 const pf53={paidKey:id=>P+'paid-hire-v1:'+id,
  verifyPaidReceipt:(tx,row)=>row===paid&&consent.verifyPaidWageConsent(tx,row)};
 const pf57={LEDGER:P+'contract-lifecycle-v1',empty:()=>({version:1,contracts:{},
  processed:{},closedContracts:{},losses:{}}),validate:x=>x};
 const cap=Symbol('SERVER_ONLY');
 const lifecycle={salaryServer(c,k){
  assert.equal(k,cap);assert.equal(c.session,undefined);
  state.calls.push(c);
  if(commitUnknown){
   if(mutateOnUnknown)ledger.contracts[PILOT]={status:'ACTIVE',lastPeriod:c.periodIndex,
    ownerCharacterID:OWNER,contractID:CONTRACT,hireReceiptHash:paid.hireReceiptHash};
   return {status:'BLOCKED',reason:'PF57_SALARY_COMMIT_OUTCOME_UNKNOWN'};
  }
  if(chargeBlocked)return {status:'BLOCKED',reason:'PF57_INSUFFICIENT_ISK'};
  const last=ledger.contracts[PILOT]?.lastPeriod||0;
  if(c.periodIndex!==last+1)return {status:'BLOCKED',reason:'PF57_PERIOD_OUT_OF_SEQUENCE'};
  ledger.contracts[PILOT]={status:'ACTIVE',lastPeriod:c.periodIndex,
    ownerCharacterID:OWNER,contractID:CONTRACT,hireReceiptHash:paid.hireReceiptHash};
  return {status:'APPLIED',periodIndex:c.periodIndex};
 }};
 const salaryTerms={verifyOriginalNpcService:(c,source,tx)=>
  source===paid&&consent.verifyPaidWageConsent(tx,paid)};
 const original={
  '../gameStore':{coopAtomicNativeRows:atomic},
  './coopPersonalFleetHangarBridge':pf52,
  './coopPersonalFleetPaidHiring':pf53,
  './coopPersonalFleetContractLifecycle':pf57,
  './coopPersonalFleetOriginalPayrollConsent':consent
 };
 const m={exports:{}};
 vm.runInNewContext(code,{require:id=>{
   if(!(id in original))throw Error('UNKNOWN_SOURCE:'+id);
   return original[id];
  },module:m,exports:m.exports,Number,Object,Array,Set,Date,Math},
  {filename:'pf93-payroll.js'});
 const create=()=>m.exports.createOriginalPayrollScheduler({
  lifecycle,salaryTerms,serverPayrollCapability:cap,maxPerTick:2,
  enabled:()=>enabled,allWritersFenced:()=>fenced,clock:()=>clock});
 return {create,values,paid,wage,index,ledger,roster,characters,state,
  advance:v=>clock=v,disable:()=>enabled=false,unfence:()=>fenced=false,
  poison:()=>poison=true,makeUnknown:(committed=false)=>{commitUnknown=true;mutateOnUnknown=committed;},
  blockCharge:()=>chargeBlocked=true};
}
test('PF93 original due period pays exactly once and next tick is not due',()=>{
 const f=fixture(),s=f.create();
 const first=s.tick();
 assert.equal(first.status,'PAYROLL_RECONCILED');
 assert.equal(first.applied,1);assert.equal(first.due,1);
 assert.equal(f.state.calls.length,1);
 assert.equal(f.state.calls[0].periodIndex,1);
 assert.equal(f.state.calls[0].operationID,consent.salaryOperationID(f.state.calls[0]));
 const second=s.tick();
 assert.equal(second.due,0);assert.equal(f.state.calls.length,1);
});
test('PF93 missed periods settle sequentially across a long offline interval',()=>{
 const f=fixture({now:START+5*PERIOD}),s=f.create();
 for(let i=1;i<=5;i++){
  const r=s.tick();
  assert.equal(r.applied,1);
  assert.equal(f.ledger.contracts[PILOT].lastPeriod,i);
 }
 assert.equal(s.tick().due,0);
});
test('PF93 before recurring salary due never debits player wallet',()=>{
 const f=fixture({now:START+PERIOD-1}),s=f.create();
 assert.equal(s.tick().due,0);assert.equal(f.state.calls.length,0);
});
test('PF93 server never invents a logged-in player session',()=>{
 const f=fixture(),s=f.create();s.tick();
 assert.equal(f.state.calls[0].source,'PF93_ORIGINAL_SERVER_PAYROLL_V1');
 assert.equal(f.state.calls[0].accountID,ACCOUNT);
 assert.equal(f.state.calls[0].session,undefined);
});
test('PF93 lost hire consent blocks scheduled payments',()=>{
 const f=fixture();delete f.values[consent.consentKey('pf-hire-1')];
 assert.equal(f.create().tick().reason,'PF93_ORIGINAL_DUE_PAYROLL_SNAPSHOT_UNVERIFIED');
 assert.equal(f.state.calls.length,0);
});
test('PF93 account changed after hire prevents unseen ISK debit',()=>{
 const f=fixture();f.characters[OWNER].accountId=999;
 assert.equal(f.create().tick().status,'BLOCKED');
 assert.equal(f.state.calls.length,0);
});
test('PF93 no second issue on uncertain native wallet COMMIT',()=>{
 const f=fixture(),s=f.create();f.makeUnknown();
 assert.equal(s.tick().blocked,1);
 assert.equal(s.tick().issues[0].reason,'UNKNOWN_OUTCOME_FENCED');
 assert.equal(f.state.calls.length,1);
});
test('PF93 COMMIT that actually applied is not repeated after server restart',()=>{
 const f=fixture();f.makeUnknown(true);
 const first=f.create();first.tick();
 const restarted=f.create();
 assert.equal(restarted.tick().due,0);
 assert.equal(f.state.calls.length,1);
});
test('PF93 insufficient ISK reports blocked but never writes fake cash',()=>{
 const f=fixture(),s=f.create();f.blockCharge();
 assert.equal(s.tick().issues[0].reason,'PF57_INSUFFICIENT_ISK');
 assert.equal(f.ledger.contracts[PILOT],undefined);
});
test('PF93 absent original salary writer fences blocks all payroll',()=>{
 const f=fixture(),s=f.create();f.unfence();
 assert.equal(s.tick().reason,'PF93_PAYROLL_NATIVE_GATE_OFF');
 assert.equal(f.state.calls.length,0);
});
test('PF93 poison in original SQLite prevents money movement',()=>{
 const f=fixture(),s=f.create();f.poison();
 assert.equal(s.tick().reason,'PF93_PAYROLL_NATIVE_GATE_OFF');
});
test('PF93 dismissed pilot cannot receive further salary',()=>{
 const f=fixture();f.ledger.closedContracts[CONTRACT]={operationID:'pf-dismiss-1'};
 assert.equal(f.create().tick().status,'BLOCKED');
 assert.equal(f.state.calls.length,0);
});
test('PF93 native actor unassigned or foreign hire is denied',()=>{
 const f=fixture();f.index.pilots[PILOT].ownerCharacterID=12345;
 assert.equal(f.create().tick().status,'BLOCKED');
 assert.equal(f.state.calls.length,0);
});
