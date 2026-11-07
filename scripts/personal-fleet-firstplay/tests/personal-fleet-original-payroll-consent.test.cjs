'use strict';
const {test}=require('node:test');
const assert=require('node:assert/strict');
const c=require('../native/coopPersonalFleetOriginalPayrollConsent');
const key='coop-personal-fleet\u001fpayroll-consent-v1:op-123';
const now=1700000000000;
function quote(){return {salaryConsentRequired:true,salaryCents:2250,periodMs:86400000,
 sourceProof:'a'.repeat(64),expiresAtMs:now+360000,
 ownerCharacterID:500,offerID:'pf-offer-500-123456',revision:2,
 contractID:'pf-contract-500-123456-2',pilotID:'coop-pilot-123456',
 employerCorpID:1000012,amountCents:9900};}
function cmd(){return {operationID:'op-123',offerID:'pf-offer-500-123456',
 offerRevision:2,contractID:'pf-contract-500-123456-2',pilotID:'coop-pilot-123456',
 ownerCharacterID:500,recurringSalaryAcknowledged:true,
 session:{userid:900,characterID:500,socket:{destroyed:false}}};}
function fixture(){
 const offer=quote(),command=cmd(),consent=c.captureOfferWageConsent(offer,command,now);
 assert.ok(consent);
 const paid={operationID:command.operationID,ownerCharacterID:500,employerCorpID:1000012,
  pilotID:command.pilotID,contractID:command.contractID,
  offerID:command.offerID,offerRevision:command.offerRevision,
  amountCents:offer.amountCents,createdAtMs:now,payrollConsent:consent};
 const db=new Map([[key,consent]]);
 const tx={get:(t,k)=>t==='corporationRuntime'?db.get(k)??null:null};
 const policy={npcCharacterID:123456,employerCorpID:1000012,
  salaryCents:2250,periodMs:86400000};
 return {offer,command,consent,paid,tx,policy,db};
}
test('PF92 original hire persists a sealed wage agreement and one immutable key',()=>{
 const x=fixture();
 assert.equal(x.consent.source,'ORIGINAL_EVEJS_NPC_PAYROLL_CONSENT_V1');
 assert.equal(x.consent.salaryCents,2250);
 assert.equal(x.consent.periodMs,86400000);
 assert.equal(c.consentKey('op-123'),key);
 assert.equal(c.verifyObject(x.consent),true);
 assert.equal(c.verifyPaidWageConsent(x.tx,x.paid),true);
 assert.equal(c.boundWagePolicy(x.paid,x.policy,x.tx),true);
});
test('PF92 does not infer salary consent for historical hire receipts',()=>{
 const x=fixture();delete x.paid.payrollConsent;
 assert.equal(c.verifyPaidWageConsent(x.tx,x.paid),false);
});
test('PF92 caller cannot change salary amount',()=>{
 const x=fixture();x.offer.salaryCents=0;
 assert.equal(c.captureOfferWageConsent(x.offer,x.command,now),null);
 x.offer.salaryCents=2250;x.offer.periodMs=123;
 assert.equal(c.captureOfferWageConsent(x.offer,x.command,now),null);
});
test('PF92 quote with wages not explicitly displayed has no consent',()=>{
 const x=fixture();delete x.offer.salaryConsentRequired;
 assert.equal(c.captureOfferWageConsent(x.offer,x.command,now),null);
});
test('PF92 expired quote cannot sign an unattended payment authorization',()=>{
 const x=fixture();
 assert.equal(c.captureOfferWageConsent(x.offer,x.command,x.offer.expiresAtMs),null);
});
test('PF92 unsigned account or disconnected session cannot authorize future debits',()=>{
 const x=fixture();x.command.session.userid=0;
 assert.equal(c.captureOfferWageConsent(x.offer,x.command,now),null);
 x.command.session.userid=900;x.command.session.socket.destroyed=true;
 assert.equal(c.captureOfferWageConsent(x.offer,x.command,now),null);
});
test('PF92 mismatched owner, pilot or revision never issues wage consent',()=>{
 const x=fixture();x.command.ownerCharacterID=501;
 assert.equal(c.captureOfferWageConsent(x.offer,x.command,now),null);
 x.command.ownerCharacterID=500;x.command.offerRevision=3;
 assert.equal(c.captureOfferWageConsent(x.offer,x.command,now),null);
 x.command.offerRevision=2;x.command.pilotID='coop-pilot-987654';
 assert.equal(c.captureOfferWageConsent(x.offer,x.command,now),null);
});
test('PF92 atomic consent row missing blocks any new salary',()=>{
 const x=fixture();x.db.delete(key);
 assert.equal(c.verifyPaidWageConsent(x.tx,x.paid),false);
});
test('PF92 persisted consent tampering invalidates salary',()=>{
 const x=fixture();
 x.db.set(key,{...x.consent,salaryCents:3000});
 assert.equal(c.verifyPaidWageConsent(x.tx,x.paid),false);
});
test('PF92 paid receipt alteration invalidates consent',()=>{
 const x=fixture();
 assert.equal(c.verifyPaidWageConsent(x.tx,{...x.paid,amountCents:1000}),false);
 assert.equal(c.verifyPaidWageConsent(x.tx,{...x.paid,createdAtMs:now+1000}),false);
 assert.equal(c.verifyPaidWageConsent(x.tx,{...x.paid,contractID:'fake'}),false);
});
test('PF92 an updated policy cannot retroactively alter already agreed wages',()=>{
 const x=fixture();
 assert.equal(c.boundWagePolicy(x.paid,{...x.policy,salaryCents:3000},x.tx),false);
 assert.equal(c.boundWagePolicy(x.paid,{...x.policy,periodMs:43200000},x.tx),false);
});
test('PF92 fixed digest cannot be repurposed to authorize another player',()=>{
 const x=fixture();const altered={...x.consent,ownerCharacterID:600};
 assert.equal(c.verifyObject(altered),false);
});
test('PF92 receipt with extra hidden wage authorization is rejected',()=>{
 const x=fixture();
 assert.equal(c.verifyObject({...x.consent,autoWithdrawUnlimited:true}),false);
});
test('PF92 invalid native operation cannot create consent row',()=>{
 assert.equal(c.consentKey('../wrong'),null);
 assert.equal(c.consentKey(''),null);
});
test('PF94 PF53 direct native hire requires acknowledged wage recurrence',()=>{
 const x=fixture();
 x.command.recurringSalaryAcknowledged=false;
 assert.equal(c.captureOfferWageConsent(x.offer,x.command,now),null);
 x.command.recurringSalaryAcknowledged=undefined;
 assert.equal(c.captureOfferWageConsent(x.offer,x.command,now),null);
});
