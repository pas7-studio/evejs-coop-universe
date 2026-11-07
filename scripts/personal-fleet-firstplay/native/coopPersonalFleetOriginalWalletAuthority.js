'use strict';
/**
 * Exact original EveJS wallet ID + notification bridge (NO wallet writes).
 * PF53/PF57 retain exclusive responsibility for ORIGINAL SQLite wallet
 * debits/credits under the GameStore BEGIN IMMEDIATE. This module cannot
 * credit, debit, synthesize journal entries or silently reuse a guessed ID.
 */
const gameStore=require('../gameStore');
const plexVault=require('../services/account/plexVaultLogState');
const wallet=require('../services/account/walletState');
const corpWallet=require('../services/corporation/corpWalletState');
const TOKEN=/^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/;
const SEP='\u001f',TABLE='corporationRuntime';
const paidKey=id=>'coop-personal-fleet'+SEP+'paid-hire-v1:'+id;
const journalKey=id=>'coop-personal-fleet'+SEP+'journal-id-v1:'+id;
const corporateKey=id=>'corporations'+SEP+id;
const obj=x=>x!==null&&typeof x==='object'&&!Array.isArray(x);
const pos=x=>Number.isSafeInteger(x)&&x>0;
function createOriginalWalletAuthority(){
 if(gameStore.coopAtomicNativeRows?.mode!=='SERVER_INTERNAL_FLAGGED'||
    typeof gameStore.coopAtomicNativeRows.transact!=='function'||
    typeof plexVault.getTransactionID!=='function'||
    typeof wallet.getCharacterWallet!=='function'||
    typeof wallet.notifyCharacterWalletChange!=='function'||
    typeof corpWallet.getCorporationWalletDivision!=='function'||
    typeof corpWallet.notifyCorporationWalletChange!=='function')
  throw Error('PF_FIRSTPLAY_ORIGINAL_WALLET_SOURCE_MISSING');
 const pending=new WeakMap();
 const published=new Set();
 function originalTransactionID({command,offer,quote,tx}={}){
  const input=offer??quote;
  if(!obj(command)||!pos(command.ownerCharacterID)||!obj(input)||
     !pos(input.employerCorpID)||!obj(tx)||
     typeof tx.get!=='function'||pending.has(tx))
   return null;
  // The ORIGINAL EveJS wallet source owns the transaction number. No
  // timestamp/sequence generator lives inside Personal Fleet.
  const id=plexVault.getTransactionID();
  if(!pos(id))return null;
  pending.set(tx,Object.freeze({id,owner:command.ownerCharacterID,
    employer:input.employerCorpID}));
  return id;
 }
 function verifyJournalID({transactionID,command,offer,quote}={},tx){
  if(!pos(transactionID)||!obj(command)||!obj(tx))return false;
  const entry=pending.get(tx);
  // A given tx can consume the original ID once only, even if the validation
  // later fails: no manufactured replacement ID in the same SQLite mutation.
  pending.delete(tx);
  const input=offer??quote;
  if(!entry||entry.id!==transactionID||entry.owner!==command.ownerCharacterID||
     entry.employer!==input?.employerCorpID)return false;
  try{
   const owner=tx.get('characters',String(entry.owner));
   const employer=tx.get(TABLE,corporateKey(entry.employer));
   const global=tx.get(TABLE,journalKey(transactionID));
   const division=employer?.wallet?.divisions?.['1000'];
   return obj(owner)&&owner.characterID===entry.owner&&
      Array.isArray(owner.walletJournal)&&
      obj(employer)&&employer.corporationID===entry.employer&&
      Array.isArray(division?.journal)&&Array.isArray(division?.transactions)&&
      global===null&&!owner.walletJournal.some(e=>e?.transactionID===transactionID)&&
      !division.journal.some(e=>e?.transactionID===transactionID)&&
      !division.transactions.some(e=>e?.transactionID===transactionID);
  }catch{return false;}
 }
 function notifyOriginalWallet({command,receipt}={},originalStore=gameStore){
  if(originalStore!==gameStore||!obj(command)||!TOKEN.test(command.operationID)||
     !pos(command.ownerCharacterID)||!obj(receipt)||
     !['APPLIED','DUPLICATE'].includes(receipt.status))return false;
  // PF57 salary currently does not have an independently verified notification
  // bridge here. Never claim it was delivered merely because PF53's bridge
  // exists. A separate original salary source adapter will be required.
  if(receipt.receipt?.type!=='HIRED')return false;
  if(gameStore.coopAtomicNativeRows.isPoisoned()===true)return false;
  let paid;
  try{paid=gameStore.coopAtomicNativeRows.transact([TABLE,'characters'],tx=>{
    const r=tx.get(TABLE,paidKey(command.operationID));
    const own=tx.get('characters',String(command.ownerCharacterID));
    const corp=tx.get(TABLE,corporateKey(r?.employerCorpID));
    if(!obj(r)||r.status!=='PAID'||r.ownerCharacterID!==command.ownerCharacterID||
       r.operationID!==command.operationID||!pos(r.employerCorpID)||
       !pos(r.transactionID)||!obj(own)||own.characterID!==command.ownerCharacterID||
       !obj(corp)||corp.corporationID!==r.employerCorpID||
       r.transactionID!==receipt.transactionID||
       (receipt.status==='APPLIED'&&r.hireReceiptHash!==receipt.hireReceiptHash)||
       !Array.isArray(own.walletJournal)||
       !own.walletJournal.some(x=>x?.transactionID===r.transactionID&&
         x.amount===-r.amountCents/100&&x.balance===r.characterAfterCents/100)||
       !Array.isArray(corp.wallet?.divisions?.['1000']?.journal)||
       !corp.wallet.divisions['1000'].journal.some(x=>x?.transactionID===r.transactionID&&
         x.amount===r.amountCents/100&&x.balance===r.corporationAfterCents/100)||
       !Array.isArray(corp.wallet.divisions['1000'].transactions)||
       !corp.wallet.divisions['1000'].transactions.some(x=>x?.transactionID===r.transactionID&&
         x.amount===r.amountCents/100&&x.balance===r.corporationAfterCents/100)||
       Math.abs(own.balance-r.characterAfterCents/100)>1e-6||
       Math.abs(corp.wallet.divisions['1000'].balance-r.corporationAfterCents/100)>1e-6)
     return null;
    return {transactionID:r.transactionID,employerCorpID:r.employerCorpID,
      ownerBalance:own.balance,employerBalance:corp.wallet.divisions['1000'].balance};
   });}catch{return false;}
  if(!paid)return false;
  const key=command.operationID+':'+paid.transactionID;
  if(published.has(key))return true;
  try{
   const originalWallet=wallet.getCharacterWallet(command.ownerCharacterID);
   const originalDivision=corpWallet.getCorporationWalletDivision(paid.employerCorpID,1000);
   if(!obj(originalWallet)||!obj(originalDivision)||
      Math.abs(originalWallet.balance-paid.ownerBalance)>1e-6||
      Math.abs(originalDivision.balance-paid.employerBalance)>1e-6)return false;
   wallet.notifyCharacterWalletChange(command.ownerCharacterID,originalWallet,
      {accountKey:'cash',balance:paid.ownerBalance});
   corpWallet.notifyCorporationWalletChange(paid.employerCorpID,1000,paid.employerBalance);
   // An uncertain exception means we do not claim delivery; wallet funds are
   // already committed independently, so never retry the charge.
   if(published.size>=8192)published.clear();
   published.add(key);
   return true;
  }catch{return false;}
 }
 return Object.freeze({originalTransactionID,verifyJournalID,notifyOriginalWallet});
}
module.exports=Object.freeze({createOriginalWalletAuthority});
