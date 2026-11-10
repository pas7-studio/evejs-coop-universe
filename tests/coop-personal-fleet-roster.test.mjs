import test from 'node:test';
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
const require=createRequire(import.meta.url);
const {empty,validate,apply}=require('../scripts/lib/personal-fleet-roster.cjs');
const HASH='a'.repeat(64);
const create=()=>empty(90,'fleet-001');
const command=(type,operationID,overrides={})=>({
 type,operationID,payloadHash:HASH,expectedRevision:0,...overrides
});
const hire=(s=create(),overrides={})=>apply(s,command('HIRE','hire-001',{
 pilotID:'coop-pilot-001',contractID:'contract-001',hireReceipt:'b'.repeat(64),
 ...overrides}),{verifiedHire:true});
const assigned=()=>{
 const h=hire();
 const a=apply(h.state,command('ASSIGN','assign-001',{
  expectedRevision:1,pilotID:'coop-pilot-001',expectedPilotRevision:0,shipItemID:500
 }),{verifiedCustody:true});
 assert.equal(a.status,'APPLIED');
 return a.state;
};
test('empty roster is valid and default defensive',()=>{
 const x=create();assert.equal(validate(x),x);
 assert.equal(x.doctrine,'DEFENSIVE');assert.equal(x.revision,0);
});
test('verified hire creates persistent contract identity',()=>{
 const x=hire();assert.equal(x.status,'APPLIED');
 assert.equal(x.state.pilots['coop-pilot-001'].status,'CONTRACTED');
 assert.equal(x.state.revision,1);
});
test('hire requires server-verified payment/contract',()=>{
 const x=apply(create(),command('HIRE','hire-001',{
  pilotID:'coop-pilot-001',contractID:'contract-001',hireReceipt:'b'.repeat(64)
 }));
 assert.equal(x.reason,'PF_HIRE_AUTHORITY_OR_CAP');
});
test('duplicate hire cannot create two contracts for one pilot',()=>{
 const h=hire();
 const duplicate=apply(h.state,command('HIRE','hire-002',{
  expectedRevision:1,pilotID:'coop-pilot-001',
  contractID:'contract-002',hireReceipt:'c'.repeat(64)
 }),{verifiedHire:true});
 assert.equal(duplicate.reason,'PF_HIRE_AUTHORITY_OR_CAP');
});
test('duplicate contract receipt for different pilot is rejected',()=>{
 const h=hire();
 const x=apply(h.state,command('HIRE','hire-002',{
  expectedRevision:1,pilotID:'coop-pilot-002',contractID:'contract-001',
  hireReceipt:'c'.repeat(64)
 }),{verifiedHire:true});
 assert.equal(x.reason,'PF_HIRE_DUPLICATE_CONTRACT');
});
test('assignment requires authoritative original ship custody',()=>{
 const h=hire();
 const input=command('ASSIGN','assign-001',{
  expectedRevision:1,pilotID:'coop-pilot-001',expectedPilotRevision:0,shipItemID:500
 });
 assert.equal(apply(h.state,input).reason,'PF_SHIP_CUSTODY_OR_PILOT_UNAVAILABLE');
 assert.equal(apply(h.state,input,{verifiedCustody:true}).status,'APPLIED');
});
test('assignment keeps original roster immutable',()=>{
 const h=hire(),prev=structuredClone(h.state);
 const x=apply(h.state,command('ASSIGN','assign-001',{
  expectedRevision:1,pilotID:'coop-pilot-001',expectedPilotRevision:0,shipItemID:500
 }),{verifiedCustody:true});
 assert.equal(x.status,'APPLIED');assert.deepEqual(h.state,prev);
 assert.equal(x.state.pilots['coop-pilot-001'].shipItemID,500);
});
test('stale roster revision rejects command',()=>{
 const h=hire();
 assert.equal(apply(h.state,command('SET_DOCTRINE','doc-001',{
  expectedRevision:0,doctrine:'FOLLOW'
 })).reason,'PF_ROSTER_REVISION_STALE');
});
test('stale pilot revision rejects delayed command',()=>{
 const x=assigned();
 assert.equal(apply(x,command('UNASSIGN','unassign-001',{
  expectedRevision:2,pilotID:'coop-pilot-001',expectedPilotRevision:0
 }),{verifiedRelease:true}).reason,'PF_PILOT_NOT_OWNED_OR_STALE');
});
test('unassign requires proven physical release',()=>{
 const x=assigned();
 const cmd=command('UNASSIGN','unassign-001',{
  expectedRevision:2,pilotID:'coop-pilot-001',expectedPilotRevision:1
 });
 assert.equal(apply(x,cmd).reason,'PF_RELEASE_NOT_VERIFIED');
 const done=apply(x,cmd,{verifiedRelease:true});
 assert.equal(done.status,'APPLIED');
 assert.equal(done.state.pilots['coop-pilot-001'].shipItemID,null);
});
test('cannot dismiss a pilot with an assigned ship',()=>{
 const x=assigned();
 assert.equal(apply(x,command('DISMISS','dismiss-001',{
  expectedRevision:2,pilotID:'coop-pilot-001',expectedPilotRevision:1
 }),{verifiedTermination:true}).reason,'PF_DISMISS_REQUIRES_RELEASED_CONTRACT');
});
test('dismiss requires independently verified contract termination',()=>{
 const h=hire();
 const cmd=command('DISMISS','dismiss-001',{
  expectedRevision:1,pilotID:'coop-pilot-001',expectedPilotRevision:0
 });
 assert.equal(apply(h.state,cmd).reason,'PF_DISMISS_REQUIRES_RELEASED_CONTRACT');
 const done=apply(h.state,cmd,{verifiedTermination:true,
  liabilityEvidence:{source:'ORIGINAL_NATIVE_CONTRACT_AND_PAYROLL',
    pilotID:'coop-pilot-001',contractID:'contract-001',
    employerCharacterID:90,ledgerRevision:1,outstandingISK:0,
    pendingInvoices:0,uncertainSettlements:0,nativeTerminationVerified:true}});
 assert.equal(done.status,'APPLIED');
 assert.equal(Object.keys(done.state.pilots).length,0);
});
test('doctrine changes never issue native NPC command directly',()=>{
 const x=apply(create(),command('SET_DOCTRINE','doctrine-001',{
  doctrine:'FOLLOW'
 }));
 assert.equal(x.status,'APPLIED');assert.equal(x.state.doctrine,'FOLLOW');
});
test('unsupported doctrine rejected',()=>{
 const x=apply(create(),command('SET_DOCTRINE','doctrine-001',{doctrine:'AGGRESSIVE_ALL'}));
 assert.equal(x.reason,'PF_DOCTRINE_INVALID');
});
test('same operation id and payload returns original receipt',()=>{
 const h=hire();
 const x=apply(h.state,command('HIRE','hire-001',{
  pilotID:'coop-pilot-001',contractID:'contract-001',
  hireReceipt:'b'.repeat(64)
 }));
 assert.equal(x.status,'DUPLICATE');
 assert.deepEqual(x.receipt,h.receipt);
});
test('operation id reused with different hash is blocked',()=>{
 const h=hire();
 assert.equal(apply(h.state,command('HIRE','hire-001',{
  payloadHash:'c'.repeat(64)
 })).reason,'PF_OPERATION_REPLAY_CONFLICT');
});
test('invalid hash or operation id is blocked',()=>{
 assert.equal(apply(create(),command('SET_DOCTRINE','!',{doctrine:'FOLLOW'})).reason,
  'PF_COMMAND_INVALID');
 assert.equal(apply(create(),command('SET_DOCTRINE','doc-001',{
  doctrine:'FOLLOW',payloadHash:'bad'})).reason,'PF_COMMAND_INVALID');
});
test('suspend requires idle contracted pilot',()=>{
 const x=assigned();
 const cmd=command('SUSPEND','suspend-001',{
  expectedRevision:2,pilotID:'coop-pilot-001',expectedPilotRevision:1
 });
 assert.equal(apply(x,cmd).reason,'PF_SUSPEND_REQUIRES_IDLE_PILOT');
});
test('verified contract can be suspended when unassigned',()=>{
 const h=hire();
 const x=apply(h.state,command('SUSPEND','suspend-001',{
  expectedRevision:1,pilotID:'coop-pilot-001',expectedPilotRevision:0
 }));
 assert.equal(x.status,'APPLIED');
 assert.equal(x.state.pilots['coop-pilot-001'].status,'SUSPENDED');
});
test('corrupt roster blocks all changes',()=>{
 const broken=create();broken.pilots['coop-pilot-001']={pilotID:'coop-pilot-001',status:'ASSIGNED'};
 assert.equal(apply(broken,command('SET_DOCTRINE','doc-001',{
  doctrine:'FOLLOW'
 })).reason,'PF_ROSTER_CORRUPT');
});
test('duplicate ship across two pilots is corrupt',()=>{
 const h=hire(),s=structuredClone(h.state),p=s.pilots['coop-pilot-001'];
 p.status='ASSIGNED';p.shipItemID=500;
 s.pilots['coop-pilot-002']={...p,pilotID:'coop-pilot-002',contractID:'contract-002',
  hireReceipt:'c'.repeat(64)};
 assert.throws(()=>validate(s),/PF_PILOT_CORRUPT/);
});

test('PF-11: zero-payroll witness required, not just termination callback',()=>{
 const h=hire(),cmd=command('DISMISS','dismiss-002',{
  expectedRevision:1,pilotID:'coop-pilot-001',expectedPilotRevision:0
 });
 assert.equal(apply(h.state,cmd,{verifiedTermination:true}).reason,
  'PF_DISMISS_LIABILITIES_UNVERIFIED');
});
test('PF-11: outstanding ISK prevents dropping hired pilot',()=>{
 const h=hire(),cmd=command('DISMISS','dismiss-002',{
  expectedRevision:1,pilotID:'coop-pilot-001',expectedPilotRevision:0
 });
 const valid={source:'ORIGINAL_NATIVE_CONTRACT_AND_PAYROLL',pilotID:'coop-pilot-001',
  contractID:'contract-001',employerCharacterID:90,ledgerRevision:1,
  outstandingISK:0,pendingInvoices:0,uncertainSettlements:0,
  nativeTerminationVerified:true};
 assert.equal(apply(h.state,cmd,{verifiedTermination:true,
  liabilityEvidence:{...valid,outstandingISK:700}}).reason,
  'PF_DISMISS_LIABILITIES_UNVERIFIED');
 assert.equal(apply(h.state,cmd,{verifiedTermination:true,
  liabilityEvidence:{...valid,uncertainSettlements:1}}).reason,
  'PF_DISMISS_LIABILITIES_UNVERIFIED');
 assert.equal(apply(h.state,cmd,{verifiedTermination:true,
  liabilityEvidence:{...valid,pendingInvoices:1}}).reason,
  'PF_DISMISS_LIABILITIES_UNVERIFIED');
});
test('PF-11: payroll witness must match original pilot and contract',()=>{
 const h=hire(),cmd=command('DISMISS','dismiss-002',{
  expectedRevision:1,pilotID:'coop-pilot-001',expectedPilotRevision:0
 });
 const evidence={source:'ORIGINAL_NATIVE_CONTRACT_AND_PAYROLL',
  pilotID:'coop-pilot-002',contractID:'contract-001',
  employerCharacterID:90,ledgerRevision:1,outstandingISK:0,
  pendingInvoices:0,uncertainSettlements:0,nativeTerminationVerified:true};
 assert.equal(apply(h.state,cmd,{verifiedTermination:true,
  liabilityEvidence:evidence}).reason,'PF_DISMISS_LIABILITIES_UNVERIFIED');
});

test('PF-12: same operation ID and same hash cannot hijack different ship',()=>{
 const state=assigned();
 const forged=command('ASSIGN','assign-001',{
  expectedRevision:1,pilotID:'coop-pilot-001',
  expectedPilotRevision:0,shipItemID:999
 });
 assert.equal(apply(state,forged,{verifiedCustody:true}).reason,
  'PF_OPERATION_REPLAY_CONFLICT');
});
test('PF-12: same operation ID and same hash cannot switch action type',()=>{
 const h=hire();
 assert.equal(apply(h.state,command('DISMISS','hire-001',{
  pilotID:'coop-pilot-001',expectedRevision:0,
  expectedPilotRevision:0
 }),{verifiedTermination:true}).reason,'PF_OPERATION_REPLAY_CONFLICT');
});
test('PF-12: same operation ID and same hash cannot change hire receipt',()=>{
 const h=hire();
 assert.equal(apply(h.state,command('HIRE','hire-001',{
  pilotID:'coop-pilot-001',contractID:'contract-001',
  hireReceipt:'c'.repeat(64)
 }),{verifiedHire:true}).reason,'PF_OPERATION_REPLAY_CONFLICT');
});
