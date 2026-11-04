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
 revisionHash:H,salaryISK:1500,verifiedArrearsISK:0,activeThroughoutPeriod:true},...x});
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

const makeInvoice=(changes={})=>{
 const result=p.accrue(input(changes),authority({
  activeContract:{...authority().activeContract,
   salaryISK:changes.salaryISK??1500,
   revisionHash:changes.contractRevisionHash??H}
 }));
 assert.equal(result.status,'DUE');
 return result.invoice;
};
test('canonical payroll ledger permits first invoice and increments revision',()=>{
 const r=p.insertInvoice(p.emptyLedger(),makeInvoice(),{expectedRevision:0});
 assert.equal(r.status,'INSERTED');assert.equal(r.ledger.revision,1);
 assert.equal(r.ledger.invoices['pf-pay-001'].phase,'DUE');
});
test('second invoice ID cannot pay overlapping period in same contract',()=>{
 const a=p.insertInvoice(p.emptyLedger(),makeInvoice(),{expectedRevision:0}).ledger;
 const b=p.insertInvoice(a,makeInvoice({invoiceID:'pf-pay-002',
  periodStart:1500,periodEnd:2500}),{expectedRevision:1});
 assert.equal(b.reason,'PF_PAYROLL_PERIOD_OVERLAP');
});
test('period boundary adjacency is allowed, not overlap',()=>{
 const a=p.insertInvoice(p.emptyLedger(),makeInvoice(),{expectedRevision:0}).ledger;
 const b=p.insertInvoice(a,makeInvoice({invoiceID:'pf-pay-002',
  periodStart:2000,periodEnd:3000}),{expectedRevision:1});
 assert.equal(b.status,'INSERTED');
});
test('same invoice ID cannot be inserted twice even after restart',()=>{
 const a=p.insertInvoice(p.emptyLedger(),makeInvoice(),{expectedRevision:0}).ledger;
 assert.equal(p.insertInvoice(structuredClone(a),makeInvoice(),
  {expectedRevision:1}).reason,'PF_PAYROLL_INVOICE_ALREADY_EXISTS');
});
test('different pilot contracts can use same payroll period',()=>{
 const first=p.insertInvoice(p.emptyLedger(),makeInvoice(),{expectedRevision:0}).ledger;
 const second=p.accrue(input({invoiceID:'pf-pay-002',contractID:'pf-contract-002',
  pilotID:'coop-pilot-002'}),authority({activeContract:{...authority().activeContract,
  contractID:'pf-contract-002',pilotID:'coop-pilot-002'}})).invoice;
 assert.equal(p.insertInvoice(first,second,{expectedRevision:1}).status,'INSERTED');
});
test('stale ledger revision cannot create a new salary period',()=>{
 const r=p.insertInvoice(p.emptyLedger(),makeInvoice(),{expectedRevision:0}).ledger;
 assert.equal(p.insertInvoice(r,makeInvoice({invoiceID:'pf-pay-002',
  periodStart:2000,periodEnd:3000}),{expectedRevision:0}).reason,
  'PF_PAYROLL_LEDGER_REVISION_STALE');
});
test('settlement transitions inside canonical ledger require original receipt',()=>{
 const r=p.insertInvoice(p.emptyLedger(),makeInvoice(),{expectedRevision:0}).ledger;
 const a=p.updateInvoice(r,{invoiceID:'pf-pay-001',expectedLedgerRevision:1,
  to:'SETTLING',expectedInvoiceRevision:0,
  proof:proof(r.invoices['pf-pay-001'],'NATIVE_WALLET_SETTLEMENT_INTENT_DURABLE')});
 assert.equal(a.status,'UPDATED');
 const b=p.updateInvoice(a.ledger,{invoiceID:'pf-pay-001',expectedLedgerRevision:2,
  to:'PAID',expectedInvoiceRevision:1,
  proof:proof(a.ledger.invoices['pf-pay-001'],
   'ORIGINAL_NATIVE_WALLET_ATOMIC_RECEIPT',receipt)});
 assert.equal(b.status,'UPDATED');
 assert.equal(b.ledger.invoices['pf-pay-001'].settlementID,'native-transaction-001');
});
test('same native settlement ID cannot pay two independent invoices',()=>{
 let r=p.emptyLedger();
 r=p.insertInvoice(r,makeInvoice(),{expectedRevision:0}).ledger;
 r=p.insertInvoice(r,makeInvoice({invoiceID:'pf-pay-002',
  periodStart:2000,periodEnd:3000}),{expectedRevision:1}).ledger;
 for(const id of ['pf-pay-001','pf-pay-002']){
  const next=p.updateInvoice(r,{invoiceID:id,expectedLedgerRevision:r.revision,
   to:'SETTLING',expectedInvoiceRevision:0,
   proof:proof(r.invoices[id],'NATIVE_WALLET_SETTLEMENT_INTENT_DURABLE')});
  assert.equal(next.status,'UPDATED');r=next.ledger;
 }
 const first=p.updateInvoice(r,{invoiceID:'pf-pay-001',
  expectedLedgerRevision:r.revision,to:'PAID',expectedInvoiceRevision:1,
  proof:proof(r.invoices['pf-pay-001'],
   'ORIGINAL_NATIVE_WALLET_ATOMIC_RECEIPT',receipt)});
 assert.equal(first.status,'UPDATED');
 const second=p.updateInvoice(first.ledger,{invoiceID:'pf-pay-002',
  expectedLedgerRevision:first.ledger.revision,to:'PAID',expectedInvoiceRevision:1,
  proof:proof(first.ledger.invoices['pf-pay-002'],
   'ORIGINAL_NATIVE_WALLET_ATOMIC_RECEIPT',receipt)});
 assert.equal(second.reason,'PF_PAYROLL_SETTLEMENT_ID_ALREADY_USED');
});
test('corrupt ledger with overlapping contracts cannot pass validation',()=>{
 const x=p.emptyLedger();x.invoices['pf-pay-001']=makeInvoice();
 x.invoices['pf-pay-002']=makeInvoice({invoiceID:'pf-pay-002',
  periodStart:1500,periodEnd:2500});
 assert.equal(p.validLedger(x),false);
});
test('ambiguous invoice cannot be marked paid without original reconciliation',()=>{
 let r=p.insertInvoice(p.emptyLedger(),makeInvoice(),{expectedRevision:0}).ledger;
 r=p.updateInvoice(r,{invoiceID:'pf-pay-001',expectedLedgerRevision:1,
  to:'SETTLING',expectedInvoiceRevision:0,
  proof:proof(r.invoices['pf-pay-001'],
   'NATIVE_WALLET_SETTLEMENT_INTENT_DURABLE')}).ledger;
 r=p.updateInvoice(r,{invoiceID:'pf-pay-001',expectedLedgerRevision:2,
  to:'OUTCOME_UNKNOWN',expectedInvoiceRevision:1,
  proof:proof(r.invoices['pf-pay-001'],
   'NATIVE_WALLET_COMMIT_OUTCOME_UNKNOWN')}).ledger;
 const x=p.reconcileLedgerInvoice(r,{invoiceID:'pf-pay-001',
  expectedLedgerRevision:3,expectedInvoiceRevision:2,
  proof:proof(r.invoices['pf-pay-001'],
   'INDEPENDENT_ORIGINAL_WALLET_RECONCILIATION',{
    id:'independent-receipt-001',debited:true,credited:true,
    singleNativeTransaction:true,nativeDurableCommit:true,
    settlementID:'native-transaction-001'})});
 assert.equal(x.status,'RECONCILED_PAID');
 assert.equal(x.ledger.invoices['pf-pay-001'].phase,'PAID');
});

test('PF-11: unverified arrears cannot inflate native salary',()=>{
 const r=p.accrue(input({arrearsISK:900}),authority());
 assert.equal(r.reason,'PF_PAYROLL_CONTRACT_OR_PERIOD_UNVERIFIED');
});
test('PF-11: verified arrears must match the native contract exactly',()=>{
 const a=authority();
 const x=p.accrue(input({arrearsISK:200}),{
  ...a,activeContract:{...a.activeContract,verifiedArrearsISK:200}
 });
 assert.equal(x.status,'DUE');assert.equal(x.invoice.totalISK,1700);
});


test('PF-13: identical invoice ID with changed salary cannot receive previous receipt',()=>{
 assert.equal(p.replay(start(),input({salaryISK:9999})).reason,
 'PF_PAYROLL_ID_REPLAY_CONFLICT');
});
test('PF-13: identical invoice ID with changed arrears cannot replay',()=>{
 assert.equal(p.replay(start(),input({arrearsISK:100})).reason,
 'PF_PAYROLL_ID_REPLAY_CONFLICT');
});
test('PF-13: identical invoice ID cannot replace payee wallet or pilot',()=>{
 assert.equal(p.replay(start(),input({payeeWalletID:777})).reason,
 'PF_PAYROLL_ID_REPLAY_CONFLICT');
 assert.equal(p.replay(start(),input({pilotID:'coop-pilot-002'})).reason,
 'PF_PAYROLL_ID_REPLAY_CONFLICT');
});
