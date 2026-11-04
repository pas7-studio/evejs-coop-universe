'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const p=require('../scripts/lib/personal-fleet-payroll.cjs');
const H='a'.repeat(64);
const input=(x={})=>({invoiceID:'pf-pay-001',contractID:'pf-contract-001',
 pilotID:'coop-pilot-001',employerCharacterID:90,payerWalletID:100,
 payeeWalletID:200,periodStart:1000,periodEnd:2000,salaryISK:1500,
 arrearsISK:0,contractRevisionHash:H,...x});
const authority=(x={})=>({authenticatedEmployer:90,periodUnbilled:true,
 activeContract:{contractID:'pf-contract-001',pilotID:'coop-pilot-001',
 employerCharacterID:90,payerWalletID:100,payeeWalletID:200,
 revisionHash:H,salaryISK:1500,activeThroughoutPeriod:true},...x});
const start=()=>{const r=p.accrue(input(),authority());assert.equal(r.status,'DUE');return r.invoice};
const proof=(r,type,extra={})=>({type,id:'proof-'+type,invoiceID:r.invoiceID,
 contractID:r.contractID,payerWalletID:r.payerWalletID,
 payeeWalletID:r.payeeWalletID,amountISK:r.totalISK,...extra});
const move=(r,to,type,extra={})=>p.transition(r,{to,
 expectedRevision:r.revision,proof:proof(r,type,extra)});
const settling=()=>move(start(),'SETTLING','NATIVE_WALLET_SETTLEMENT_INTENT_DURABLE').invoice;
const receipt={settlementID:'native-transaction-001',
 originalPayerDebited:true,originalPayeeCredited:true,
 singleNativeTransaction:true,nativeDurableCommit:true};
const unknown=()=>move(settling(),'OUTCOME_UNKNOWN','NATIVE_WALLET_COMMIT_OUTCOME_UNKNOWN').invoice;
test('verified native contract accrues integer ISK salary',()=>{
 const r=start();assert.equal(r.salaryISK,1500);assert.equal(r.totalISK,1500);
 assert.equal(r.phase,'DUE');
});
test('rejects untrusted employer',()=>assert.equal(
 p.accrue(input(),authority({authenticatedEmployer:91})).reason,
 'PF_PAYROLL_CONTRACT_OR_PERIOD_UNVERIFIED'));
test('rejects unverified active contract',()=>assert.equal(
 p.accrue(input(),authority({activeContract:null})).reason,
 'PF_PAYROLL_CONTRACT_OR_PERIOD_UNVERIFIED'));
test('rejects already billed salary period',()=>assert.equal(
 p.accrue(input(),authority({periodUnbilled:false})).reason,
 'PF_PAYROLL_CONTRACT_OR_PERIOD_UNVERIFIED'));
test('rejects overlapping wallet identity',()=>assert.equal(
 p.accrue(input({payeeWalletID:100}),authority()).reason,'PF_PAYROLL_INVOICE_INVALID'));
test('rejects fractional ISK amount',()=>assert.equal(
 p.accrue(input({salaryISK:0.25}),authority()).reason,'PF_PAYROLL_INVOICE_INVALID'));
test('rejects negative arrears',()=>assert.equal(
 p.accrue(input({arrearsISK:-1}),authority()).reason,'PF_PAYROLL_INVOICE_INVALID'));
test('rejects arithmetic overflow',()=>assert.equal(
 p.accrue(input({salaryISK:Number.MAX_SAFE_INTEGER,arrearsISK:1}),authority()).reason,
 'PF_PAYROLL_INVOICE_INVALID'));
test('verifies salary amount against contracted wage',()=>assert.equal(
 p.accrue(input({salaryISK:999}),authority()).reason,'PF_PAYROLL_CONTRACT_OR_PERIOD_UNVERIFIED'));
test('salary accrual does not move original ISK',()=>{const x=start();assert.equal(x.settlementID,null);assert.equal(x.phase,'DUE')});
test('requires durable intent before native debit',()=>{
 const x=start();
 assert.equal(move(x,'PAID','ORIGINAL_NATIVE_WALLET_ATOMIC_RECEIPT',receipt).reason,
 'PF_PAYROLL_ILLEGAL_TRANSITION');
 assert.equal(move(x,'SETTLING','NATIVE_WALLET_SETTLEMENT_INTENT_DURABLE').status,'APPLIED');
});
test('wallet callback ACK alone cannot mark paid',()=>assert.equal(
 move(settling(),'PAID','ORIGINAL_NATIVE_WALLET_ATOMIC_RECEIPT').reason,
 'PF_PAYROLL_NATIVE_SETTLEMENT_UNVERIFIED'));
test('native atomic debit and credit receipt marks paid',()=>{
 const x=move(settling(),'PAID','ORIGINAL_NATIVE_WALLET_ATOMIC_RECEIPT',receipt);
 assert.equal(x.status,'APPLIED');assert.equal(x.invoice.phase,'PAID');
 assert.equal(x.invoice.settlementID,'native-transaction-001');
});
test('one-sided original native debit cannot mark paid',()=>assert.equal(
 move(settling(),'PAID','ORIGINAL_NATIVE_WALLET_ATOMIC_RECEIPT',{
 ...receipt,originalPayeeCredited:false}).reason,'PF_PAYROLL_NATIVE_SETTLEMENT_UNVERIFIED'));
test('non-durable native commit cannot mark paid',()=>assert.equal(
 move(settling(),'PAID','ORIGINAL_NATIVE_WALLET_ATOMIC_RECEIPT',{
 ...receipt,nativeDurableCommit:false}).reason,'PF_PAYROLL_NATIVE_SETTLEMENT_UNVERIFIED'));
test('definite insufficient funds needs proven no debit',()=>assert.equal(
 move(settling(),'INSUFFICIENT_FUNDS','NATIVE_WALLET_DEFINITE_NO_DEBIT').reason,
 'PF_PAYROLL_NO_DEBIT_UNVERIFIED'));
test('insufficient funds can create a new fenced settlement attempt',()=>{
 const x=move(settling(),'INSUFFICIENT_FUNDS','NATIVE_WALLET_DEFINITE_NO_DEBIT',{
 provenNoDebit:true}).invoice;
 assert.equal(move(x,'SETTLING','NATIVE_WALLET_SETTLEMENT_INTENT_DURABLE',{
 id:'retry-intent-001'}).status,'APPLIED');
});
test('commit ambiguity is permanently fenced from direct retry',()=>{
 const x=unknown();
 assert.equal(move(x,'SETTLING','NATIVE_WALLET_SETTLEMENT_INTENT_DURABLE').reason,
 'PF_PAYROLL_ILLEGAL_TRANSITION');
});
test('replay never allows native debit again',()=>{
 const x=move(settling(),'PAID','ORIGINAL_NATIVE_WALLET_ATOMIC_RECEIPT',receipt).invoice;
 assert.deepEqual(p.replay(x,input()),{status:'DUPLICATE',
 phase:'PAID',settlementID:'native-transaction-001',nativeDebitAllowed:false});
});
test('changing invoice identity cannot replay',()=>assert.equal(
 p.replay(start(),input({periodEnd:2500})).reason,'PF_PAYROLL_ID_REPLAY_CONFLICT'));
test('independent reconciliation can prove an already-paid original wallet transfer',()=>{
 const x=unknown(),r=p.reconcile(x,{proof:proof(x,
  'INDEPENDENT_ORIGINAL_WALLET_RECONCILIATION',{
  id:'native-reconciliation-001',debited:true,credited:true,
  singleNativeTransaction:true,nativeDurableCommit:true,
  settlementID:'native-transaction-001'})});
 assert.equal(r.status,'RECONCILED_PAID');assert.equal(r.invoice.phase,'PAID');
});
test('one-sided debit remains UNKNOWN and cannot be retried',()=>{
 const x=unknown(),r=p.reconcile(x,{proof:proof(x,
  'INDEPENDENT_ORIGINAL_WALLET_RECONCILIATION',{
  id:'native-reconciliation-001',debited:true,credited:false})});
 assert.equal(r.reason,'PF_PAYROLL_OUTCOME_STILL_UNKNOWN');
});
test('proven no debit and no credit unlocks only explicitly unfunded state',()=>{
 const x=unknown(),r=p.reconcile(x,{proof:proof(x,
  'INDEPENDENT_ORIGINAL_WALLET_RECONCILIATION',{
  id:'native-reconciliation-001',definitiveNoDebit:true,definitiveNoCredit:true})});
 assert.equal(r.status,'RECONCILED_UNPAID');
 assert.equal(r.invoice.phase,'INSUFFICIENT_FUNDS');
});
test('no payout can be forged by a mismatched wallet identity',()=>assert.equal(
 move(settling(),'PAID','ORIGINAL_NATIVE_WALLET_ATOMIC_RECEIPT',{
 ...receipt,payeeWalletID:999}).reason,'PF_PAYROLL_NATIVE_PROOF_REQUIRED'));
test('stale version denies wallet settlement',()=>assert.equal(
 p.transition(settling(),{to:'PAID',expectedRevision:0,
 proof:proof(settling(),'ORIGINAL_NATIVE_WALLET_ATOMIC_RECEIPT',receipt)}).reason,
 'PF_PAYROLL_REVISION_STALE'));
test('reusing original proof ID denies second settlement transition',()=>{
 const x=settling();
 assert.equal(move(x,'PAID','ORIGINAL_NATIVE_WALLET_ATOMIC_RECEIPT',{
 ...receipt,id:'proof-NATIVE_WALLET_SETTLEMENT_INTENT_DURABLE'}).reason,
 'PF_PAYROLL_NATIVE_PROOF_REQUIRED');
});
