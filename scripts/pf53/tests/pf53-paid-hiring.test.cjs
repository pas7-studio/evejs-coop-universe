'use strict';
const {test}=require('node:test'),assert=require('node:assert/strict');
const F=require('./fixture.cjs');
const {open,tempDb,seed,cmd,OWNER,EMPLOYER,PRICE,P,CONTRACT,OP,pf52}=F;
function withDB(run,options={}){const tmp=tempDb();let f;try{f=open(tmp.file,options);seed(f);return run(f)}finally{f?.close();tmp.cleanup()}}
function balances(f){const c=f.get('characters','characters')[String(OWNER)],e=f.get('corporationRuntime','corporations\u001f'+EMPLOYER);return [c.balance,e.wallet.divisions['1000'].balance]}
test('original wallet transfer, separate debit and credit journals and enrolled PF52 roster one SQLite commit',()=>withDB(f=>{
 const r=f.bridge.hire(cmd());assert.equal(r.status,'APPLIED');assert.equal(r.amountCents,PRICE);
 assert.deepEqual(balances(f),[1050,2250]);
 const c=f.get('characters','characters')[String(OWNER)],corp=f.get('corporationRuntime','corporations\u001f'+EMPLOYER);
 assert.equal(c.walletJournal[0].amount,-1450);
 assert.equal(c.walletJournal[0].transactionID,r.transactionID);
 const w=corp.wallet.divisions['1000'];assert.equal(w.journal.length,1);assert.equal(w.transactions.length,1);
 assert.equal(w.journal[0].amount,1450);
 const ix=f.get('corporationRuntime',pf52.REGISTRY_KEY);
 assert.equal(ix.contracts[CONTRACT],P);
 assert.equal(ix.pilots[P].hireReceiptHash,r.hireReceiptHash);
 assert.equal(f.get('corporationRuntime',pf52.ROSTER_PREFIX+OWNER).pilots[P].status,'CONTRACTED');
 assert.equal(f.get('corporationRuntime',pf52.ROSTER_PREFIX+OWNER).revision,1);
 assert.equal(F.api.verifyPaidReceipt({get:f.get},f.get('corporationRuntime',F.api.paidKey(OP))),true);
}));
test('replay after committed original wallet hire never debits again',()=>withDB(f=>{
 const first=f.bridge.hire(cmd());const again=f.bridge.hire(cmd());
 assert.equal(first.status,'APPLIED');assert.equal(again.status,'DUPLICATE');
 assert.deepEqual(balances(f),[1050,2250]);
 assert.equal(f.get('characters','characters')[String(OWNER)].walletJournal.length,2);
}));
test('price is only trusted server policy; no user-supplied amount can change debit',()=>withDB(f=>{
 const r=f.bridge.hire(cmd({amountCents:1,price:0,employerCorpID:777}));
 assert.equal(r.status,'APPLIED');assert.equal(r.amountCents,PRICE);
 assert.deepEqual(balances(f),[1050,2250]);
}));
test('same operationID different offer or pilot is not a second debit',()=>withDB(f=>{
 assert.equal(f.bridge.hire(cmd()).status,'APPLIED');
 assert.equal(f.bridge.hire(cmd({offerID:'evil-offer'})).status,'BLOCKED');
 assert.equal(f.bridge.hire(cmd({contractID:'evil-contract'})).status,'BLOCKED');
 assert.deepEqual(balances(f),[1050,2250]);
}));
test('a different operation cannot contract same pilot twice',()=>withDB(f=>{
 assert.equal(f.bridge.hire(cmd()).status,'APPLIED');
 const r=f.bridge.hire(cmd({operationID:'pf53-hire-second',expectedRosterRevision:1}));
 assert.equal(r.status,'BLOCKED');assert.deepEqual(balances(f),[1050,2250]);
}));
test('original employer receipt can be independently verified from both ledgers',()=>withDB(f=>{
 assert.equal(f.bridge.hire(cmd()).status,'APPLIED');
 const proof=f.get('corporationRuntime',F.api.paidKey(OP));
 assert.equal(F.api.verifyPaidReceipt({get:f.get},proof),true);
 f.put('corporationRuntime','corporations\u001f'+EMPLOYER,{...f.get('corporationRuntime','corporations\u001f'+EMPLOYER),wallet:{divisions:{1000:{balance:2250,journal:[],transactions:[]}}}});
 assert.equal(F.api.verifyPaidReceipt({get:f.get},proof),false);
 assert.equal(f.bridge.hire(cmd()).reason,'PF53_REPLAY_NATIVE_LEDGER_UNVERIFIED');
}));
test('insufficient original character ISK cannot credit employer',()=>withDB(f=>{
 const current=f.get('characters','characters');current[OWNER].balance=20;f.put('characters','characters',current);
 assert.equal(f.bridge.hire(cmd()).reason,'PF53_INSUFFICIENT_ISK');
 assert.equal(f.get('corporationRuntime',pf52.REGISTRY_KEY),null);
 assert.deepEqual(balances(f),[20,800]);
}));
test('non-native agent offer cannot accept client-controlled fee',()=>withDB(f=>{
 f.shared.offer={...f.shared.offer,amountCents:0};
 assert.equal(f.bridge.hire(cmd()).reason,'PF53_NATIVE_OFFER_UNVERIFIED');
 assert.deepEqual(balances(f),[2500,800]);
}));
test('expired native hire offer is never paid',()=>withDB(f=>{
 f.shared.offer={...f.shared.offer,expiresAtMs:1793883999999};
 assert.equal(f.bridge.hire(cmd()).reason,'PF53_OFFER_EXPIRED');
 assert.deepEqual(balances(f),[2500,800]);
}));
test('wrong authenticated character cannot spend ISK',()=>withDB(f=>{
 assert.equal(f.bridge.hire(cmd({session:{userid:55,characterID:3}})).reason,'PF53_COMMAND_INVALID');
 assert.deepEqual(balances(f),[2500,800]);
}));
test('revoked authentication inside BEGIN IMMEDIATE aborts without debit',()=>withDB(f=>{
 const original=f.gameStore.coopAtomicNativeRows.transact;
 f.gameStore.coopAtomicNativeRows.transact=(tables,fn)=>original(tables,tx=>{
  f.shared.auth=false;return fn(tx);
 });
 assert.equal(f.bridge.hire(cmd()).reason,'PF53_ACCESS_REVOKED');
 assert.deepEqual(balances(f),[2500,800]);
}));
test('revoked original wallet writer fence inside BEGIN IMMEDIATE aborts',()=>withDB(f=>{
 const original=f.gameStore.coopAtomicNativeRows.transact;
 f.gameStore.coopAtomicNativeRows.transact=(tables,fn)=>original(tables,tx=>{
  f.shared.writers=false;return fn(tx);
 });
 assert.equal(f.bridge.hire(cmd()).reason,'PF53_GATE_REVOKED');
 assert.deepEqual(balances(f),[2500,800]);
}));
test('disabled flag cannot authorize a wallet write',()=>withDB(f=>{
 f.shared.enabled=false;assert.equal(f.bridge.hire(cmd()).status,'DISABLED');
 assert.deepEqual(balances(f),[2500,800]);
}));
test('the NPC employer must be verified by original employer authority',()=>withDB(f=>{
 const corp=f.get('corporationRuntime','corporations\u001f'+EMPLOYER);corp.isNPC=false;
 f.put('corporationRuntime','corporations\u001f'+EMPLOYER,corp);
 assert.equal(f.bridge.hire(cmd()).reason,'PF53_NATIVE_EMPLOYER_UNVERIFIED');
 assert.deepEqual(balances(f),[2500,800]);
}));
test('the original named pilot must be available, not an invented profile',()=>withDB(f=>{
 const row=f.get('npcEntities','npcEntities');row.pilots[P].available=false;f.put('npcEntities','npcEntities',row);
 assert.equal(f.bridge.hire(cmd()).reason,'PF53_NATIVE_PILOT_NOT_AVAILABLE');
 assert.deepEqual(balances(f),[2500,800]);
}));
test('unknown native transaction journal identity cannot be used',()=>withDB(f=>{
 f.shared.txid=0;assert.equal(f.bridge.hire(cmd()).reason,'PF53_NATIVE_TRANSACTION_ID_UNVERIFIED');
 assert.deepEqual(balances(f),[2500,800]);
}));
test('a colliding original wallet transaction identity refuses debit',()=>withDB(f=>{
 const root=f.get('characters','characters');root[OWNER].walletJournal.push({transactionID:f.shared.txid});f.put('characters','characters',root);
 assert.equal(f.bridge.hire(cmd()).reason,'PF53_NATIVE_TRANSACTION_ID_UNVERIFIED');
 assert.deepEqual(balances(f),[2500,800]);
}));
test('malformed original wallet cannot silently default to free money',()=>withDB(f=>{
 const root=f.get('characters','characters');delete root[OWNER].balance;f.put('characters','characters',root);
 assert.equal(f.bridge.hire(cmd()).reason,'PF53_CHARACTER_WALLET_UNVERIFIED');
 assert.deepEqual(balances(f).slice(1),[800]);
}));
test('conflicting native WAR pilot assignment blocks paid enrollment',()=>withDB(f=>{
 f.put('corporationRuntime','coop-faction-war\u001ffleet-registry-v1',{
 version:1,ships:{'1111':{entityID:1111,pilotID:P}},processed:{},history:[]});
 assert.equal(f.bridge.hire(cmd()).reason,'PF52_WAR_SHIP_OR_PILOT_RESERVED');
 assert.deepEqual(balances(f),[2500,800]);
}));
test('conflicting native PF actor claim blocks paid enrollment',()=>withDB(f=>{
 f.put('corporationRuntime','coop-personal-fleet\u001factor-claims-v1',{
 version:1,claims:{'1111':{entityID:1111,pilotID:P,ownerCharacterID:OWNER,ownerType:'PERSONAL_FLEET'}},generations:{},processed:{}});
 assert.equal(f.bridge.hire(cmd()).reason,'PF52_ACTIVE_PERSONAL_ACTOR_RESERVED');
 assert.deepEqual(balances(f),[2500,800]);
}));
test('corrupt external WAR registry blocks even unrelated hire',()=>withDB(f=>{
 f.put('corporationRuntime','coop-faction-war\u001ffleet-registry-v1',{version:4,ships:{}});
 assert.equal(f.bridge.hire(cmd()).reason,'PF52_WAR_REGISTRY_INVALID');
 assert.deepEqual(balances(f),[2500,800]);
}));
test('recipient overflow blocks native credit and source debit',()=>withDB(f=>{
 const e=f.get('corporationRuntime','corporations\u001f'+EMPLOYER);e.wallet.divisions['1000'].balance=Number.MAX_SAFE_INTEGER/100;
 f.put('corporationRuntime','corporations\u001f'+EMPLOYER,e);
 assert.equal(f.bridge.hire(cmd()).reason,'PF53_EMPLOYER_WALLET_OVERFLOW');
 assert.equal(f.get('characters','characters')[String(OWNER)].balance,2500);
}));
test('failure in SQLite writer after source debit rolls back whole transaction',()=>withDB(f=>{
 const original=f.gameStore.coopAtomicNativeRows.transact;
 f.gameStore.coopAtomicNativeRows.transact=(tables,fn)=>original(tables,tx=>{
   let putCount=0;return fn({...tx,put(...args){tx.put(...args);if(++putCount===1)throw Error('DISK_IO_FAILURE')}});
 });
 assert.equal(f.bridge.hire(cmd()).status,'BLOCKED');
 assert.deepEqual(balances(f),[2500,800]);
 assert.equal(f.get('corporationRuntime',pf52.REGISTRY_KEY),null);
}));
test('source-poisoned atomic bridge does not begin an original wallet write',()=>withDB(f=>{
 f.gameStore.coopAtomicNativeRows.isPoisoned=()=>true;
 assert.equal(f.bridge.hire(cmd()).reason,'PF53_ATOMIC_STORE_POISONED');
 assert.deepEqual(balances(f),[2500,800]);
}));
test('PF53 actual paid hire flows into PF52 ORIGINAL ItemStore hangar ship reservation without importing paid-hire twice',()=>withDB(f=>{
 const h=f.bridge.hire(cmd());assert.equal(h.status,'APPLIED');
 f.put('items','items',{'2001':{itemID:2001,shipID:2001,shipTypeID:606,typeID:606,
  ownerID:OWNER,locationID:600001,flagID:4,categoryID:6,singleton:1,stacksize:1,quantity:-1,spaceState:null}});
 const command={type:'RESERVE_HANGAR_SHIP',operationID:'pf53-ship-assign',pilotID:P,
 ownerCharacterID:OWNER,session:cmd().session,expectedRosterRevision:1,
 shipItemID:2001,stationID:600001,assignmentID:'pf53-assignment',expectedPilotRevision:0};
 const assigned=f.hangar.execute(command);
 assert.equal(assigned.status,'APPLIED',JSON.stringify(assigned));
 assert.equal(f.get('corporationRuntime',pf52.REGISTRY_KEY).ships['2001'].pilotID,P);
 assert.equal(f.get('items','items')['2001'].ownerID,OWNER);
 assert.equal(f.bridge.hire(cmd()).status,'DUPLICATE');
 assert.deepEqual(balances(f),[1050,2250]);
}));
test('paid-hire original agent offer cannot be transferred to different character',()=>withDB(f=>{
 f.shared.offer.ownerCharacterID=111111;
 assert.equal(f.bridge.hire(cmd()).reason,'PF53_NATIVE_OFFER_UNVERIFIED');
 assert.deepEqual(balances(f),[2500,800]);
}));
test('original native wallet session notification occurs only AFTER a confirmed COMMIT',()=>withDB(f=>{
 let examined=false;f.deps.notifyOriginalWallet=()=>{examined=true;
  assert.equal(f.get('characters','characters')[String(OWNER)].balance,1050);
  assert.equal(f.get('corporationRuntime','corporations\u001f'+EMPLOYER).wallet.divisions['1000'].balance,2250);
  return true;};
 const b=F.api.createPersonalFleetPaidHiring(f.deps);const r=b.hire(cmd());
 assert.equal(r.status,'APPLIED');assert.equal(r.notificationStatus,'DELIVERED');assert.equal(examined,true);
}));
test('notification failure reports PENDING but does not undo or repeat committed original ISK transfer',()=>withDB(f=>{
 f.deps.notifyOriginalWallet=()=>{throw Error('NETWORK_DOWN')};
 const b=F.api.createPersonalFleetPaidHiring(f.deps);const r=b.hire(cmd());
 assert.equal(r.status,'APPLIED');assert.equal(r.notificationStatus,'PENDING');
 assert.deepEqual(balances(f),[1050,2250]);
 const repeated=b.hire(cmd());assert.equal(repeated.status,'DUPLICATE');
 assert.equal(repeated.notificationStatus,'PENDING');assert.deepEqual(balances(f),[1050,2250]);
}));
test('native numeric journal ID is globally claimed atomically, not just unique inside one wallet',()=>withDB(f=>{
 f.put('corporationRuntime',F.api.journalKey(f.shared.txid),{
  version:1,transactionID:f.shared.txid,operationID:'different-hire',ownerCharacterID:999,employerCorpID:777});
 assert.equal(f.bridge.hire(cmd()).reason,'PF53_NATIVE_TRANSACTION_ID_UNVERIFIED');
 assert.deepEqual(balances(f),[2500,800]);
}));
test('successful original paid hire durably journals numeric ID in same SQLite transaction',()=>withDB(f=>{
 const a=f.bridge.hire(cmd());assert.equal(a.status,'APPLIED');
 const journal=f.get('corporationRuntime',F.api.journalKey(f.shared.txid));
 assert.equal(journal.operationID,OP);assert.equal(journal.ownerCharacterID,OWNER);
 assert.equal(journal.employerCorpID,EMPLOYER);
 assert.equal(f.bridge.hire(cmd()).status,'DUPLICATE');
}));