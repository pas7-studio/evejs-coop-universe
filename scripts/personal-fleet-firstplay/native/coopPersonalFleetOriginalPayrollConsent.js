'use strict';
/**
 * PF92: immutable recurrent-wage consent embedded in the ORIGINAL PF53
 * hire SQLite COMMIT. This module never charges money, mints pilots or
 * accepts user supplied rates. A single truthful hiring quote is the source.
 * Never rewrite a paid period or infer consent from an old PF53 transaction.
 */
const {createHash}=require('node:crypto');
const {isDeepStrictEqual}=require('node:util');
const T='corporationRuntime',K='coop-personal-fleet\u001fpayroll-consent-v1:';
const pos=x=>Number.isSafeInteger(x)&&x>0;
const obj=x=>x!==null&&typeof x==='object'&&!Array.isArray(x);
const token=x=>typeof x==='string'&&/^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/.test(x);
const hex=x=>typeof x==='string'&&/^[a-f0-9]{64}$/.test(x);
const pilot=x=>typeof x==='string'&&/^coop-pilot-[0-9]{3,}$/.test(x);
const validOfferWage=q=>obj(q)&&q.salaryConsentRequired===true&&
 pos(q.salaryCents)&&q.salaryCents<=1000000000000&&
 Number.isSafeInteger(q.periodMs)&&q.periodMs>=3600000&&q.periodMs<=604800000&&
 hex(q.sourceProof)&&pos(q.expiresAtMs);
const sig=x=>createHash('sha256').update(JSON.stringify(x)).digest('hex');
const originalFields=c=>[
 c.version,c.source,c.operationID,c.offerID,c.offerRevision,c.contractID,
 c.pilotID,c.ownerCharacterID,c.accountID,c.employerCorpID,
 c.hireAmountCents,c.salaryCents,c.periodMs,c.sourceProof,c.startsAtMs
];
function verifyObject(c){
 if(!obj(c)||c.version!==1||c.source!=='ORIGINAL_EVEJS_NPC_PAYROLL_CONSENT_V1'||
   !token(c.operationID)||!token(c.offerID)||!pos(c.offerRevision)||
   !token(c.contractID)||!pilot(c.pilotID)||
   !pos(c.ownerCharacterID)||!pos(c.accountID)||!pos(c.employerCorpID)||
   !pos(c.hireAmountCents)||!pos(c.salaryCents)||c.salaryCents>1000000000000||
   !Number.isSafeInteger(c.periodMs)||c.periodMs<3600000||c.periodMs>604800000||
   !hex(c.sourceProof)||!pos(c.startsAtMs)||!hex(c.consentHash)||
   Object.keys(c).sort().join('|')!==[
    'accountID','consentHash','contractID','employerCorpID','hireAmountCents',
    'offerID','offerRevision','operationID','ownerCharacterID','periodMs',
    'pilotID','salaryCents','source','sourceProof','startsAtMs','version'
   ].sort().join('|'))return false;
 return sig(['PF92_ORIGINAL_NPC_SALARY_ACCEPTED_V1',...originalFields(c)])===c.consentHash;
}
function captureOfferWageConsent(offer,command,at){
 if(!validOfferWage(offer)||!obj(command)||!obj(command.session)||
   !pos(at)||at>=offer.expiresAtMs||
   command.recurringSalaryAcknowledged!==true||
   !token(command.operationID)||!token(command.offerID)||
   !pos(command.offerRevision)||!token(command.contractID)||
   !pilot(command.pilotID)||!pos(command.ownerCharacterID)||
   !pos(command.session.userid)||command.session.characterID!==command.ownerCharacterID||
   command.session.socket?.destroyed!==false||
   offer.ownerCharacterID!==command.ownerCharacterID||
   offer.offerID!==command.offerID||offer.revision!==command.offerRevision||
   offer.contractID!==command.contractID||offer.pilotID!==command.pilotID||
   !pos(offer.employerCorpID)||!pos(offer.amountCents))return null;
 const c={version:1,source:'ORIGINAL_EVEJS_NPC_PAYROLL_CONSENT_V1',
  operationID:command.operationID,offerID:offer.offerID,offerRevision:offer.revision,
  contractID:offer.contractID,pilotID:offer.pilotID,
  ownerCharacterID:offer.ownerCharacterID,accountID:command.session.userid,
  employerCorpID:offer.employerCorpID,hireAmountCents:offer.amountCents,
  salaryCents:offer.salaryCents,periodMs:offer.periodMs,
  sourceProof:offer.sourceProof,startsAtMs:at};
 const sealed={...c,consentHash:sig(['PF92_ORIGINAL_NPC_SALARY_ACCEPTED_V1',...originalFields(c)])};
 return verifyObject(sealed)?Object.freeze(sealed):null;
}
function consentKey(operationID){
 return token(operationID)?K+operationID:null;
}
function verifyPaidWageConsent(tx,paid){
 if(typeof tx?.get!=='function'||!obj(paid)||!verifyObject(paid.payrollConsent)||
   paid.operationID!==paid.payrollConsent.operationID||
   paid.ownerCharacterID!==paid.payrollConsent.ownerCharacterID||
   paid.employerCorpID!==paid.payrollConsent.employerCorpID||
   paid.pilotID!==paid.payrollConsent.pilotID||
   paid.contractID!==paid.payrollConsent.contractID||
   paid.offerID!==paid.payrollConsent.offerID||
   paid.offerRevision!==paid.payrollConsent.offerRevision||
   paid.amountCents!==paid.payrollConsent.hireAmountCents||
   paid.createdAtMs!==paid.payrollConsent.startsAtMs)return false;
 const key=consentKey(paid.operationID);
 if(!key)return false;
 const sealed=tx.get(T,key);
 return verifyObject(sealed)&&isDeepStrictEqual(sealed,paid.payrollConsent);
}
function boundWagePolicy(paid,policy,tx){
 if(!verifyPaidWageConsent(tx,paid)||!obj(policy)||
   policy.npcCharacterID!==Number(paid.pilotID.slice('coop-pilot-'.length))||
   policy.employerCorpID!==paid.employerCorpID||
   policy.salaryCents!==paid.payrollConsent.salaryCents||
   policy.periodMs!==paid.payrollConsent.periodMs)return false;
 return true;
}
/**
 * Deterministic server-only salary idempotency key. The secret is NOT an ID:
 * true authorization is the persisted PF53 consent + original wallet/actor
 * state checked inside the same native GameStore transaction. This key
 * ensures crash/restart never invents a second charge for the same period.
 */
function salaryOperationID(c){
 if(!obj(c)||!pos(c.ownerCharacterID)||!pilot(c.pilotID)||
    !token(c.contractID)||!Number.isSafeInteger(c.periodIndex)||
    c.periodIndex<1||c.periodIndex>1000000)return null;
 return 'pf-pay-'+sig(['PF93_SERVER_PAYROLL_PERIOD_V1',
  c.ownerCharacterID,c.pilotID,c.contractID,c.periodIndex]);
}
module.exports=Object.freeze({validOfferWage,captureOfferWageConsent,
 consentKey,verifyPaidWageConsent,boundWagePolicy,verifyObject,salaryOperationID});
