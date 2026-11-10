'use strict';
/** PF-53: atomically charge the ORIGINAL player ISK wallet, credit the ORIGINAL
 * NPC-employer corporation wallet and enroll an existing named NPC pilot in the
 * PF-52 roster. No NPC entity, ship item, wallet, policy price or cash is minted.
 * REVIEW CANDIDATE ONLY. All stock wallet writers must participate in the same
 * authoritative GameStore boundary before enabling this in WORK.
 */
const crypto = require('node:crypto');
const TABLE = 'corporationRuntime', CHARACTERS = 'characters';
const SEP = '\u001f';
const PAID_PREFIX = 'coop-personal-fleet'+SEP+'paid-hire-v1:';
const JOURNAL_PREFIX = 'coop-personal-fleet'+SEP+'journal-id-v1:';
const CORP_KEY = id => 'corporations'+SEP+id;
const ID = x => Number.isSafeInteger(x)&&x>0;
const TOKEN = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/;
const PILOT = /^coop-pilot-[0-9]{3,}$/;
const HASH = /^[a-f0-9]{64}$/;
const obj = x => x!==null&&typeof x==='object'&&!Array.isArray(x);
const own=(o,k)=>Object.prototype.hasOwnProperty.call(o,k);
const fail=(reason)=>({status:'BLOCKED',reason});
const hash=x=>crypto.createHash('sha256').update(JSON.stringify(x)).digest('hex');
const isk=x=>x/100;
const cents=x=>{
 if(typeof x!=='number'||!Number.isFinite(x)||x<0)return null;
 const scaled=x*100,rounded=Math.round(scaled);
 return Number.isSafeInteger(rounded)&&Math.abs(rounded-scaled)<=1e-6?rounded:null;
};
const filetime=ms=>String(BigInt(ms)*10000n+116444736000000000n);
const paidKey=op=>PAID_PREFIX+op;
const journalKey=id=>JOURNAL_PREFIX+id;
const moneyEntry=(owner,other,amountCents,balanceCents,txID,operationID,at)=>({
 transactionID:txID,transactionDate:filetime(at),referenceID:other,
 ownerID1:owner,ownerID2:other,accountKey:1000,entryTypeID:10,
 amount:isk(amountCents),balance:isk(balanceCents),currency:1,sortValue:1,
 description:'Personal NPC hire '+operationID
});
function hasEntry(entries,operationID,txID,owner,other,amount,after){
 return Array.isArray(entries)&&entries.filter(e=>e?.transactionID===txID).length===1&&
  entries.some(e=>e?.transactionID===txID&&e.referenceID===other&&
   e.ownerID1===owner&&e.ownerID2===other&&
   e.accountKey===1000&&e.currency===1&&e.description==='Personal NPC hire '+operationID&&
   cents(e.amount===undefined?NaN:Math.abs(e.amount))===Math.abs(amount)&&
   (amount<0?e.amount<0:e.amount>0)&&cents(e.balance)===after);
}
function verifyPaidReceipt(tx,receipt){
 if(!obj(receipt)||receipt.version!==1||receipt.status!=='PAID'||
   !TOKEN.test(receipt.operationID)||!PILOT.test(receipt.pilotID)||
   !TOKEN.test(receipt.contractID)||!HASH.test(receipt.hireReceiptHash)||
   !ID(receipt.ownerCharacterID)||!ID(receipt.employerCorpID)||
   !ID(receipt.transactionID)||!ID(receipt.amountCents)||
   !Number.isSafeInteger(receipt.characterAfterCents)||receipt.characterAfterCents<0||
   !Number.isSafeInteger(receipt.corporationAfterCents)||receipt.corporationAfterCents<0)
  return false;
 const globalJournal=tx.get(TABLE,journalKey(receipt.transactionID));
 if(!globalJournal||globalJournal.operationID!==receipt.operationID||
    globalJournal.transactionID!==receipt.transactionID||
    globalJournal.ownerCharacterID!==receipt.ownerCharacterID||
    globalJournal.employerCorpID!==receipt.employerCorpID)return false;
 // Original characters are stored as one row per characterID.
 const c=tx.get(CHARACTERS,String(receipt.ownerCharacterID));
 const employer=tx.get(TABLE,CORP_KEY(receipt.employerCorpID));
 const division=employer?.wallet?.divisions?.['1000'];
 // Historical receipt remains valid only while both original wallet journals
 // still independently preserve the matching original debit and credit.
 return obj(c)&&employer?.corporationID===receipt.employerCorpID&&
  hasEntry(c.walletJournal,receipt.operationID,receipt.transactionID,
   receipt.ownerCharacterID,receipt.employerCorpID,-receipt.amountCents,receipt.characterAfterCents)&&
  hasEntry(division?.journal,receipt.operationID,receipt.transactionID,
   receipt.employerCorpID,receipt.ownerCharacterID,receipt.amountCents,receipt.corporationAfterCents)&&
  hasEntry(division?.transactions,receipt.operationID,receipt.transactionID,
   receipt.employerCorpID,receipt.ownerCharacterID,receipt.amountCents,receipt.corporationAfterCents);
}
function createPersonalFleetPaidHiring({gameStore,pf52,access,resolveNativeOffer,
 verifyOriginalNpcPilot,verifyNativeEmployer,verifyJournalID,originalTransactionID,
 notifyOriginalWallet,allWalletWritersFenced=()=>false,enabled=()=>false,clock=()=>Date.now()}={}){
 const atomic=gameStore?.coopAtomicNativeRows;
 if(atomic?.mode!=='SERVER_INTERNAL_FLAGGED'||typeof atomic?.transact!=='function'||
   typeof atomic?.isPoisoned!=='function'||
   !pf52||typeof pf52.newIndex!=='function'||typeof pf52.newRoster!=='function'||
   typeof pf52.validateIndex!=='function'||typeof pf52.validateRoster!=='function'||
   typeof pf52.checkCompetingClaims!=='function'||
   typeof pf52.REGISTRY_KEY!=='string'||typeof pf52.ROSTER_PREFIX!=='string'||
   [access?.isOwner,resolveNativeOffer,verifyOriginalNpcPilot,
    verifyNativeEmployer,verifyJournalID,originalTransactionID,notifyOriginalWallet,
    allWalletWritersFenced,enabled,clock].some(f=>typeof f!=='function'))
  throw Error('PF53_ORIGINAL_NATIVE_AUTHORITIES_REQUIRED');
 const rosterKey=owner=>pf52.ROSTER_PREFIX+owner;
 function hire(command){
  if(enabled()!==true)return {status:'DISABLED'};
  if(allWalletWritersFenced()!==true)return fail('PF53_ORIGINAL_WALLET_WRITERS_NOT_FENCED');
  if(atomic.isPoisoned())return fail('PF53_ATOMIC_STORE_POISONED');
  if(!obj(command)||!TOKEN.test(command.operationID)||
     !TOKEN.test(command.offerID)||!TOKEN.test(command.contractID)||
     !ID(command.agentID)||!PILOT.test(command.pilotID)||
     !ID(command.ownerCharacterID)||
     !Number.isSafeInteger(command.offerRevision)||command.offerRevision<1||
     !Number.isSafeInteger(command.expectedRosterRevision)||command.expectedRosterRevision<0||
     !obj(command.session)||command.session.characterID!==command.ownerCharacterID||
     !ID(command.session.userid)||command.session.socket?.destroyed===true)
   return fail('PF53_COMMAND_INVALID');
  if(access.isOwner(command.session,command.ownerCharacterID)!==true)
   return fail('PF53_AUTH_DENIED');
  const operationSignature=hash([command.operationID,command.offerID,command.offerRevision,
   command.contractID,command.pilotID,command.ownerCharacterID,
   command.agentID,command.expectedRosterRevision]);
  try{
   const result=atomic.transact([CHARACTERS,TABLE,'npcEntities'],tx=>{
    if(enabled()!==true||allWalletWritersFenced()!==true)return fail('PF53_GATE_REVOKED');
    if(access.isOwner(command.session,command.ownerCharacterID,tx)!==true)
      return fail('PF53_ACCESS_REVOKED');
    const existingRaw=tx.get(TABLE,pf52.REGISTRY_KEY),
      rosterRaw=tx.get(TABLE,rosterKey(command.ownerCharacterID));
    if(existingRaw===undefined||rosterRaw===undefined)return fail('PF53_ROSTER_READ_UNCERTAIN');
    const index=pf52.validateIndex(existingRaw===null?pf52.newIndex():existingRaw);
    const roster=pf52.validateRoster(rosterRaw===null?pf52.newRoster(command.ownerCharacterID):rosterRaw,command.ownerCharacterID);
    const past=index.processed[command.operationID];
    if(past){
      if(past.signature!==operationSignature||past.receipt?.type!=='HIRED')
        return fail('PF53_OPERATION_REPLAY_CONFLICT');
      const paid=tx.get(TABLE,paidKey(command.operationID));
      if(!paid||paid.commandSignature!==operationSignature||
         paid.ownerCharacterID!==command.ownerCharacterID||
         paid.pilotID!==command.pilotID||
         paid.contractID!==command.contractID||
         paid.hireReceiptHash!==index.pilots[command.pilotID]?.hireReceiptHash||
         roster.pilots[command.pilotID]?.contractID!==command.contractID||
         verifyPaidReceipt(tx,paid)!==true)
        return fail('PF53_REPLAY_NATIVE_LEDGER_UNVERIFIED');
      return {status:'DUPLICATE',receipt:structuredClone(past.receipt),transactionID:paid.transactionID};
    }
    if(roster.revision!==command.expectedRosterRevision)return fail('PF53_ROSTER_CAS_STALE');
    if(roster.revision>=Number.MAX_SAFE_INTEGER-1||
       Object.keys(roster.pilots).length>=24||Object.keys(index.pilots).length>=256||
       Object.keys(index.processed).length>=2048)return fail('PF53_CAP_EXHAUSTED');
    if(index.pilots[command.pilotID]||roster.pilots[command.pilotID]||
       index.contracts[command.contractID])return fail('PF53_PILOT_OR_CONTRACT_ALREADY_HIRED');
    if(tx.get(TABLE,paidKey(command.operationID))!==null)return fail('PF53_PAID_RECEIPT_KEY_COLLISION');
    const conflict=pf52.checkCompetingClaims(tx,{pilotID:command.pilotID,shipItemID:0});
    if(conflict)return fail(conflict);
    // Offers come ONLY from a trusted original agent/employer source, not the
    // client request. Re-read policy and identity under BEGIN IMMEDIATE.
    const offer=resolveNativeOffer(command,tx);
    if(!obj(offer)||offer.offerID!==command.offerID||
       offer.revision!==command.offerRevision||
       offer.contractID!==command.contractID||
       offer.ownerCharacterID!==command.ownerCharacterID||
       offer.pilotID!==command.pilotID||offer.agentID!==command.agentID||
       !ID(offer.employerCorpID)||!ID(offer.amountCents)||
       offer.amountCents>1000000000000||
       !ID(offer.expiresAtMs))return fail('PF53_NATIVE_OFFER_UNVERIFIED');
    const now=clock();if(!ID(now)||now>=offer.expiresAtMs)return fail('PF53_OFFER_EXPIRED');
    if(verifyOriginalNpcPilot(command,offer,tx)!==true)
      return fail('PF53_NATIVE_PILOT_NOT_AVAILABLE');
    const employer=tx.get(TABLE,CORP_KEY(offer.employerCorpID));
    if(!obj(employer)||employer.corporationID!==offer.employerCorpID||
       verifyNativeEmployer(command,offer,employer,tx)!==true)
      return fail('PF53_NATIVE_EMPLOYER_UNVERIFIED');
    const division=employer.wallet?.divisions?.['1000'];
    const employerBefore=cents(division?.balance);
    if(employerBefore===null||!Array.isArray(division?.journal)||
       !Array.isArray(division?.transactions))return fail('PF53_EMPLOYER_WALLET_UNVERIFIED');
    const owner=tx.get(CHARACTERS,String(command.ownerCharacterID));
    if(!obj(owner)||owner.characterID!==command.ownerCharacterID||
       !Array.isArray(owner.walletJournal))return fail('PF53_CHARACTER_WALLET_UNVERIFIED');
    const before=cents(owner.balance);
    if(before===null)return fail('PF53_CHARACTER_WALLET_UNVERIFIED');
    if(before<offer.amountCents)return fail('PF53_INSUFFICIENT_ISK');
    const employerAfter=employerBefore+offer.amountCents;
    if(!Number.isSafeInteger(employerAfter))return fail('PF53_EMPLOYER_WALLET_OVERFLOW');
    // The native wallet transaction ID source is caller-injected; gaps on
    // rollback are harmless, but a manufactured non-native ID is forbidden.
    const transactionID=originalTransactionID({command,offer,tx});
    if(!ID(transactionID)||verifyJournalID({transactionID,command,offer},tx)!==true||
       tx.get(TABLE,journalKey(transactionID))!==null||
       owner.walletJournal.some(e=>e?.transactionID===transactionID)||
       division.journal.some(e=>e?.transactionID===transactionID)||
       division.transactions.some(e=>e?.transactionID===transactionID))
      return fail('PF53_NATIVE_TRANSACTION_ID_UNVERIFIED');
    const debit=moneyEntry(command.ownerCharacterID,offer.employerCorpID,
       -offer.amountCents,before-offer.amountCents,transactionID,command.operationID,now);
    const credit=moneyEntry(offer.employerCorpID,command.ownerCharacterID,
       offer.amountCents,employerAfter,transactionID,command.operationID,now);
    // Emit no notification and issue no native NPC order before the COMMIT.
    const updatedOwner={...owner,balance:isk(before-offer.amountCents),
      balanceChange:isk(-offer.amountCents),
      walletJournal:[debit,...owner.walletJournal].slice(0,100)};
    const updatedEmployer={...employer,wallet:{...employer.wallet,divisions:{
      ...employer.wallet.divisions,'1000':{...division,balance:isk(employerAfter),
        journal:[...division.journal,credit].slice(-100),
        transactions:[...division.transactions,credit].slice(-2000)}}}};
    const hashReceipt=hash(['PERSONAL_PAID_HIRE_V1',command.operationID,
      command.pilotID,command.contractID,command.ownerCharacterID,
      offer.employerCorpID,offer.amountCents,transactionID,before-offer.amountCents,employerAfter]);
    const hired={pilotID:command.pilotID,contractID:command.contractID,
      hireReceiptHash:hashReceipt,status:'CONTRACTED',shipItemID:null,revision:0};
    roster.pilots[command.pilotID]=hired;
    index.pilots[command.pilotID]={pilotID:command.pilotID,
      ownerCharacterID:command.ownerCharacterID,contractID:command.contractID,
      hireReceiptHash:hashReceipt};
    index.contracts[command.contractID]=command.pilotID;
    const receipt={type:'HIRED',pilotID:command.pilotID,contractID:command.contractID};
    index.processed[command.operationID]={signature:operationSignature,receipt};
    roster.revision++;
    pf52.validateRoster(roster,command.ownerCharacterID);pf52.validateIndex(index);
    const paid={version:1,status:'PAID',operationID:command.operationID,
      commandSignature:operationSignature,offerID:offer.offerID,offerRevision:offer.revision,
      pilotID:command.pilotID,contractID:command.contractID,
      ownerCharacterID:command.ownerCharacterID,employerCorpID:offer.employerCorpID,
      amountCents:offer.amountCents,transactionID,
      characterAfterCents:before-offer.amountCents,corporationAfterCents:employerAfter,
      hireReceiptHash:hashReceipt,createdAtMs:now};
    // Single source-owned original SQLite wallet row in the same hire transaction.
     tx.put(CHARACTERS,String(command.ownerCharacterID),updatedOwner);
    tx.put(TABLE,CORP_KEY(offer.employerCorpID),updatedEmployer);
    tx.put(TABLE,pf52.REGISTRY_KEY,index);
    tx.put(TABLE,rosterKey(command.ownerCharacterID),roster);
    tx.put(TABLE,paidKey(command.operationID),paid);
    tx.put(TABLE,journalKey(transactionID),{version:1,operationID:command.operationID,
      transactionID,ownerCharacterID:command.ownerCharacterID,
      employerCorpID:offer.employerCorpID});
    return {status:'APPLIED',receipt,transactionID,
      amountCents:offer.amountCents,hireReceiptHash:hashReceipt};
   });
   // A callback must publish through the ORIGINAL wallet/session authority,
   // never mutate money here. Notification failure cannot roll back an already
   // committed debit. A retry still replays the same wallet receipt.
   if(result?.status==='APPLIED'||result?.status==='DUPLICATE'){
    let notified=false;
    try{notified=notifyOriginalWallet({command,receipt:result},gameStore)===true;}catch{}
    return {...result,notificationStatus:notified?'DELIVERED':'PENDING'};
   }
   return result;
  }catch(error){
    return fail(error?.coopCommitOutcomeUnknown===true?
      'PF53_COMMIT_OUTCOME_UNKNOWN':'PF53_ORIGINAL_ATOMIC_STORE_REJECTED');
  }
 }
 return Object.freeze({hire});
}
module.exports={createPersonalFleetPaidHiring,paidKey,journalKey,verifyPaidReceipt,cents,hash};