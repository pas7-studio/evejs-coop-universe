'use strict';
// PF-08 portable payroll contract. NON-DEPLOYED, no wallet mutation.
// Amounts are INTEGER ISK only; external adapter must debit and credit the
// ORIGINAL native wallets in one authoritative SQLite commit.
const TOKEN=/^[A-Za-z0-9][A-Za-z0-9_.:-]{0,127}$/;
const HASH=/^[a-f0-9]{64}$/;
const PILOT=/^coop-pilot-[0-9]{3,}$/;
const token=x=>typeof x==='string'&&TOKEN.test(x);
const positive=x=>Number.isSafeInteger(x)&&x>0;
const nonneg=x=>Number.isSafeInteger(x)&&x>=0;
const obj=x=>!!x&&typeof x==='object'&&!Array.isArray(x);
const deny=reason=>({status:'BLOCKED',reason});
const PHASES=new Set(['DUE','SETTLING','PAID','INSUFFICIENT_FUNDS','OUTCOME_UNKNOWN']);
const finalReceiptValid=row=>{
 const last=row.proofs.at(-1)?.type;
 return ({
  DUE:row.proofs.length===0,
  SETTLING:last==='NATIVE_WALLET_SETTLEMENT_INTENT_DURABLE',
  PAID:['ORIGINAL_NATIVE_WALLET_ATOMIC_RECEIPT',
   'INDEPENDENT_ORIGINAL_WALLET_RECONCILIATION'].includes(last),
  INSUFFICIENT_FUNDS:['NATIVE_WALLET_DEFINITE_NO_DEBIT',
   'INDEPENDENT_ORIGINAL_WALLET_RECONCILIATION'].includes(last),
  OUTCOME_UNKNOWN:last==='NATIVE_WALLET_COMMIT_OUTCOME_UNKNOWN'
 })[row.phase]===true;
};
function valid(row){
 return obj(row)&&row.version===1&&token(row.invoiceID)&&token(row.contractID)&&
 PILOT.test(row.pilotID)&&positive(row.employerCharacterID)&&
 positive(row.payeeWalletID)&&positive(row.payerWalletID)&&
 row.payeeWalletID!==row.payerWalletID&&positive(row.periodStart)&&
 positive(row.periodEnd)&&row.periodEnd>row.periodStart&&
 positive(row.salaryISK)&&nonneg(row.arrearsISK)&&
 Number.isSafeInteger(row.totalISK)&&row.totalISK>0&&
 row.totalISK===row.salaryISK+row.arrearsISK&&
 HASH.test(row.contractRevisionHash)&&PHASES.has(row.phase)&&
 Number.isSafeInteger(row.revision)&&row.revision>=0&&
 (row.settlementID===null||token(row.settlementID))&&
 Array.isArray(row.proofs)&&row.proofs.length<=8&&
 row.proofs.every(p=>obj(p)&&token(p.id)&&token(p.type))&&
 new Set(row.proofs.map(p=>p.id)).size===row.proofs.length&&
 row.proofs.every(x=>[
  'NATIVE_WALLET_SETTLEMENT_INTENT_DURABLE',
  'ORIGINAL_NATIVE_WALLET_ATOMIC_RECEIPT',
  'NATIVE_WALLET_DEFINITE_NO_DEBIT',
  'NATIVE_WALLET_COMMIT_OUTCOME_UNKNOWN',
  'INDEPENDENT_ORIGINAL_WALLET_RECONCILIATION'].includes(x.type))&&
 row.revision===row.proofs.length&&
 (row.phase!=='DUE'||row.revision===0)&&
 (row.phase==='DUE'||row.revision>0)&&
 (row.phase==='PAID' ? token(row.settlementID) : row.settlementID===null)&&
 finalReceiptValid(row);
}
function accrue(input,{authenticatedEmployer,activeContract,periodUnbilled}={}){
 if(!obj(input)||!token(input.invoiceID)||!token(input.contractID)||
 !PILOT.test(input.pilotID)||!positive(input.employerCharacterID)||
 !positive(input.payerWalletID)||!positive(input.payeeWalletID)||
 input.payerWalletID===input.payeeWalletID||
 !positive(input.periodStart)||!positive(input.periodEnd)||
 input.periodEnd<=input.periodStart||!positive(input.salaryISK)||
 !nonneg(input.arrearsISK)||!HASH.test(input.contractRevisionHash)||
 !Number.isSafeInteger(input.salaryISK+input.arrearsISK)||
 input.salaryISK+input.arrearsISK<=0)return deny('PF_PAYROLL_INVOICE_INVALID');
 if(authenticatedEmployer!==input.employerCharacterID||
 activeContract?.contractID!==input.contractID||
 activeContract?.pilotID!==input.pilotID||
 activeContract?.employerCharacterID!==input.employerCharacterID||
 activeContract?.payerWalletID!==input.payerWalletID||
 activeContract?.payeeWalletID!==input.payeeWalletID||
 activeContract?.revisionHash!==input.contractRevisionHash||
 activeContract?.salaryISK!==input.salaryISK||
 activeContract?.verifiedArrearsISK!==input.arrearsISK||
 activeContract?.activeThroughoutPeriod!==true||
 periodUnbilled!==true)return deny('PF_PAYROLL_CONTRACT_OR_PERIOD_UNVERIFIED');
 const row={version:1,invoiceID:input.invoiceID,contractID:input.contractID,
 pilotID:input.pilotID,employerCharacterID:input.employerCharacterID,
 payerWalletID:input.payerWalletID,payeeWalletID:input.payeeWalletID,
 periodStart:input.periodStart,periodEnd:input.periodEnd,
 salaryISK:input.salaryISK,arrearsISK:input.arrearsISK,
 totalISK:input.salaryISK+input.arrearsISK,
 contractRevisionHash:input.contractRevisionHash,
 phase:'DUE',revision:0,settlementID:null,proofs:[]};
 return {status:'DUE',invoice:row};
}
function transition(row,{to,expectedRevision,proof}={}){
 if(!valid(row))return deny('PF_PAYROLL_RECORD_CORRUPT');
 if(row.revision!==expectedRevision)return deny('PF_PAYROLL_REVISION_STALE');
 const expected={DUE:{SETTLING:'NATIVE_WALLET_SETTLEMENT_INTENT_DURABLE'},
 SETTLING:{PAID:'ORIGINAL_NATIVE_WALLET_ATOMIC_RECEIPT',
 INSUFFICIENT_FUNDS:'NATIVE_WALLET_DEFINITE_NO_DEBIT',
 OUTCOME_UNKNOWN:'NATIVE_WALLET_COMMIT_OUTCOME_UNKNOWN'},
 INSUFFICIENT_FUNDS:{SETTLING:'NATIVE_WALLET_SETTLEMENT_INTENT_DURABLE'},
 PAID:{},OUTCOME_UNKNOWN:{}}[row.phase]?.[to];
 if(!expected)return deny('PF_PAYROLL_ILLEGAL_TRANSITION');
 if(!obj(proof)||proof.type!==expected||!token(proof.id)||
 proof.invoiceID!==row.invoiceID||proof.contractID!==row.contractID||
 proof.payerWalletID!==row.payerWalletID||
 proof.payeeWalletID!==row.payeeWalletID||
 proof.amountISK!==row.totalISK||
 row.proofs.some(x=>x.id===proof.id))return deny('PF_PAYROLL_NATIVE_PROOF_REQUIRED');
 if(to==='PAID'&&(!token(proof.settlementID)||
  proof.originalPayerDebited!==true||proof.originalPayeeCredited!==true||
  proof.singleNativeTransaction!==true||proof.nativeDurableCommit===false||
  proof.nativeDurableCommit!==true))
  return deny('PF_PAYROLL_NATIVE_SETTLEMENT_UNVERIFIED');
 if(to==='INSUFFICIENT_FUNDS'&&proof.provenNoDebit!==true)
  return deny('PF_PAYROLL_NO_DEBIT_UNVERIFIED');
 if(row.proofs.length>=8)return deny('PF_PAYROLL_PROOF_CAP_REACHED');
 const next={...row,phase:to,revision:row.revision+1,
 settlementID:to==='PAID'?proof.settlementID:row.settlementID,
 proofs:[...row.proofs,{id:proof.id,type:expected}]};
 return {status:'APPLIED',invoice:next};
}
function replay(row,invoice={}){
 if(!valid(row))return deny('PF_PAYROLL_RECORD_CORRUPT');
 if(!obj(invoice)||invoice.invoiceID!==row.invoiceID||
 invoice.contractID!==row.contractID||
 invoice.pilotID!==row.pilotID||
 invoice.employerCharacterID!==row.employerCharacterID||
 invoice.payerWalletID!==row.payerWalletID||
 invoice.payeeWalletID!==row.payeeWalletID||
 invoice.contractRevisionHash!==row.contractRevisionHash||
 invoice.periodStart!==row.periodStart||invoice.periodEnd!==row.periodEnd||
 invoice.salaryISK!==row.salaryISK||invoice.arrearsISK!==row.arrearsISK||
 invoice.salaryISK+invoice.arrearsISK!==row.totalISK)
  return deny('PF_PAYROLL_ID_REPLAY_CONFLICT');
 return {status:'DUPLICATE',phase:row.phase,settlementID:row.settlementID,
 nativeDebitAllowed:false};
}
function reconcile(row,{proof}={}){
 if(!valid(row))return deny('PF_PAYROLL_RECORD_CORRUPT');
 if(row.phase!=='OUTCOME_UNKNOWN'&&row.phase!=='SETTLING')
  return deny('PF_PAYROLL_NOT_UNCERTAIN');
 if(row.proofs.length>=8)return deny('PF_PAYROLL_PROOF_CAP_REACHED');
 if(proof?.type!=='INDEPENDENT_ORIGINAL_WALLET_RECONCILIATION'||
 !token(proof.id)||proof.invoiceID!==row.invoiceID||
 proof.contractID!==row.contractID||proof.amountISK!==row.totalISK||
 proof.payerWalletID!==row.payerWalletID||
 proof.payeeWalletID!==row.payeeWalletID||
 row.proofs.some(x=>x.id===proof.id))
  return deny('PF_PAYROLL_RECONCILIATION_PROOF_REQUIRED');
 if(proof.debited===true&&proof.credited===true&&
 proof.singleNativeTransaction===true&&proof.nativeDurableCommit===true&&
 token(proof.settlementID))
  return {status:'RECONCILED_PAID',invoice:{...row,phase:'PAID',
   revision:row.revision+1,settlementID:proof.settlementID,
   proofs:[...row.proofs,{id:proof.id,type:proof.type}]}};
 if(proof.definitiveNoDebit===true&&proof.definitiveNoCredit===true)
  return {status:'RECONCILED_UNPAID',invoice:{...row,phase:'INSUFFICIENT_FUNDS',
   revision:row.revision+1,
   proofs:[...row.proofs,{id:proof.id,type:proof.type}]}};
 return deny('PF_PAYROLL_OUTCOME_STILL_UNKNOWN');
}

const LEDGER_KEY='coop-personal-fleet\u001fpayroll-ledger-v1';
const emptyLedger=()=>({version:1,revision:0,invoices:{}});
function validLedger(s){
 if(!obj(s)||s.version!==1||!Number.isSafeInteger(s.revision)||
  s.revision<0||!obj(s.invoices)||Object.keys(s.invoices).length>512)
  return false;
 const all=Object.values(s.invoices);
 if(all.some(x=>!valid(x)))return false;
 for(const [id,x] of Object.entries(s.invoices))
  if(id!==x.invoiceID)return false;
 for(let i=0;i<all.length;i++)for(let j=i+1;j<all.length;j++){
  const x=all[i],y=all[j];
  if(x.contractID===y.contractID&&
    x.periodStart<y.periodEnd&&y.periodStart<x.periodEnd)return false;
  if(x.settlementID&&x.settlementID===y.settlementID)return false;
 }
 return true;
}
function insertInvoice(ledger,invoice,{expectedRevision}={}){
 if(!validLedger(ledger))return deny('PF_PAYROLL_LEDGER_CORRUPT');
 if(!valid(invoice)||invoice.phase!=='DUE'||invoice.revision!==0||
   invoice.proofs.length!==0||invoice.settlementID!==null)
  return deny('PF_PAYROLL_NEW_INVOICE_UNVERIFIED');
 if(ledger.revision!==expectedRevision)return deny('PF_PAYROLL_LEDGER_REVISION_STALE');
 if(Object.prototype.hasOwnProperty.call(ledger.invoices,invoice.invoiceID))
  return deny('PF_PAYROLL_INVOICE_ALREADY_EXISTS');
 if(Object.values(ledger.invoices).some(x=>x.contractID===invoice.contractID&&
  x.periodStart<invoice.periodEnd&&invoice.periodStart<x.periodEnd))
  return deny('PF_PAYROLL_PERIOD_OVERLAP');
 if(Object.keys(ledger.invoices).length>=512||
  ledger.revision===Number.MAX_SAFE_INTEGER)return deny('PF_PAYROLL_LEDGER_CAP_REACHED');
 const next=structuredClone(ledger);next.revision++;
 next.invoices[invoice.invoiceID]=structuredClone(invoice);
 return {status:'INSERTED',ledger:next};
}
function updateInvoice(ledger,{invoiceID,expectedLedgerRevision,to,
 expectedInvoiceRevision,proof}={}){
 if(!validLedger(ledger))return deny('PF_PAYROLL_LEDGER_CORRUPT');
 if(ledger.revision!==expectedLedgerRevision)return deny('PF_PAYROLL_LEDGER_REVISION_STALE');
 const current=ledger.invoices[invoiceID];
 if(!current)return deny('PF_PAYROLL_INVOICE_NOT_FOUND');
 const changed=transition(current,{to,expectedRevision:expectedInvoiceRevision,proof});
 if(changed.status!=='APPLIED')return changed;
 if(changed.invoice.settlementID&&Object.values(ledger.invoices).some(x=>
  x.invoiceID!==invoiceID&&x.settlementID===changed.invoice.settlementID))
  return deny('PF_PAYROLL_SETTLEMENT_ID_ALREADY_USED');
 if(ledger.revision===Number.MAX_SAFE_INTEGER)return deny('PF_PAYROLL_LEDGER_CAP_REACHED');
 const next=structuredClone(ledger);next.revision++;
 next.invoices[invoiceID]=changed.invoice;
 return {status:'UPDATED',ledger:next,receipt:{
  invoiceID,phase:changed.invoice.phase,settlementID:changed.invoice.settlementID}};
}

function reconcileLedgerInvoice(ledger,{invoiceID,expectedLedgerRevision,
 expectedInvoiceRevision,proof}={}){
 if(!validLedger(ledger))return deny('PF_PAYROLL_LEDGER_CORRUPT');
 if(ledger.revision!==expectedLedgerRevision)return deny('PF_PAYROLL_LEDGER_REVISION_STALE');
 const current=ledger.invoices[invoiceID];
 if(!current)return deny('PF_PAYROLL_INVOICE_NOT_FOUND');
 if(current.revision!==expectedInvoiceRevision)return deny('PF_PAYROLL_REVISION_STALE');
 const changed=reconcile(current,{proof});
 if(!changed.status?.startsWith('RECONCILED_'))return changed;
 if(changed.invoice.settlementID&&Object.values(ledger.invoices).some(x=>
  x.invoiceID!==invoiceID&&x.settlementID===changed.invoice.settlementID))
  return deny('PF_PAYROLL_SETTLEMENT_ID_ALREADY_USED');
 if(ledger.revision===Number.MAX_SAFE_INTEGER)return deny('PF_PAYROLL_LEDGER_CAP_REACHED');
 const next=structuredClone(ledger);next.revision++;
 next.invoices[invoiceID]=changed.invoice;
 return {status:changed.status,ledger:next,receipt:{
  invoiceID,phase:changed.invoice.phase,settlementID:changed.invoice.settlementID}};
}
module.exports={PHASES,valid,accrue,transition,replay,reconcile,
 LEDGER_KEY,emptyLedger,validLedger,insertInvoice,updateInvoice,reconcileLedgerInvoice};
