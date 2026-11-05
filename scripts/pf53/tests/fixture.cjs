'use strict';
const {DatabaseSync}=require('node:sqlite');
const os=require('node:os'),fs=require('node:fs'),path=require('node:path');
const pf52=require('../deps/pf52-reference-hangar.cjs');
const api=require('../native/coopPersonalFleetPaidHiring.cjs');
const OWNER=90000001, EMPLOYER=1000110, AGENT=300001, PRICE=145000;
const P='coop-pilot-123';
const OP='pf53-hire-001',CONTRACT='pf53-contract-001';
const OFFER={offerID:'pf53-offer-001',revision:4,contractID:CONTRACT,pilotID:P,
 agentID:AGENT,ownerCharacterID:OWNER,employerCorpID:EMPLOYER,amountCents:PRICE,expiresAtMs:2000000000000};
function cmd(extra={}){return {operationID:OP,offerID:OFFER.offerID,offerRevision:OFFER.revision,
 contractID:CONTRACT,pilotID:P,agentID:AGENT,ownerCharacterID:OWNER,expectedRosterRevision:0,
 session:{characterID:OWNER,userid:55,socket:{destroyed:false}},...extra};}
function tempDb(){const dir=fs.mkdtempSync(path.join(os.tmpdir(),'pf53-'));
return {dir,file:path.join(dir,'native.db'),cleanup(){fs.rmSync(dir,{recursive:true,force:true})}};}
function open(file,overrides={}){
 const db=new DatabaseSync(file);
 db.exec('PRAGMA journal_mode=WAL; PRAGMA synchronous=FULL;');
 for(const t of ['characters','corporationRuntime','npcEntities','items'])
 db.exec(`CREATE TABLE IF NOT EXISTS "${t}" (key TEXT PRIMARY KEY,json TEXT NOT NULL)`);
 const tables=new Set(['characters','corporationRuntime','npcEntities','items']);
 const valid=t=>{if(!tables.has(t))throw Error('UNDECLARED_TABLE');return '"'+t+'"'};
 const rawGet=(t,k)=>{const r=db.prepare(`SELECT json FROM ${valid(t)} WHERE key=?`).get(k);return r?JSON.parse(r.json):null};
 const put=(t,k,v)=>db.prepare(`INSERT INTO ${valid(t)}(key,json) VALUES(?,?) ON CONFLICT(key) DO UPDATE SET json=excluded.json`).run(k,JSON.stringify(v));
 const shared={enabled:true,writers:true,auth:true,native:true,offer:{...OFFER},txid:1793884000000,notifications:[]};
 const gameStore={coopAtomicNativeRows:{mode:'SERVER_INTERNAL_FLAGGED',isPoisoned:()=>false,transact(ts,fn){
   if(ts.length!==new Set(ts).size||!ts.every(t=>tables.has(t)))throw Error('UNSAFE_TABLE');
   db.exec('BEGIN IMMEDIATE');try{
    const tx={get:rawGet,put,scan(t){return db.prepare(`SELECT key,json FROM ${valid(t)}`).all().map(x=>({key:x.key,value:JSON.parse(x.json)}));}};
    const result=fn(tx);if(result?.then)throw Error('ASYNC_UNSAFE');db.exec('COMMIT');return result;
   }catch(e){try{db.exec('ROLLBACK')}catch{}throw e;}
  }}};
 const deps={gameStore,pf52,
 access:{isOwner(s,o){return shared.auth&&s?.userid===55&&s.characterID===o}},
 resolveNativeOffer(c){return shared.offer},
 verifyOriginalNpcPilot(c,offer,tx){return shared.native&&tx.get('npcEntities','npcEntities')?.pilots?.[c.pilotID]?.available===true},
 verifyNativeEmployer(c,offer,corp){return shared.native&&corp.isNPC===true&&corp.corporationID===offer.employerCorpID},
 verifyJournalID({transactionID}){return Number.isSafeInteger(transactionID)&&transactionID===shared.txid},
 originalTransactionID(){return shared.txid},
 notifyOriginalWallet({receipt}){shared.notifications.push(receipt.transactionID);return true},
 allWalletWritersFenced(){return shared.writers},enabled(){return shared.enabled},clock:()=>1793884000000};
 Object.assign(deps,overrides);
 const bridge=api.createPersonalFleetPaidHiring(deps);
 const hangar=pf52.createPersonalFleetHangarBridge({gameStore,
 access:deps.access, enabled:()=>shared.enabled,allWritersFenced:()=>shared.writers,
 verifyPaidHire:()=>false,verifyShipAvailable:()=>true,verifyRelease:()=>true});
 return {db,gameStore,put,get:rawGet,shared,deps,bridge,hangar,close(){db.close()}};
}
function seed(f,{balance=2500,employerBalance=800}={}){
 f.put('characters','characters',{[OWNER]:{characterID:OWNER,balance,walletJournal:[{
  transactionID:99,accountKey:1000,amount:0,balance}]}});
 f.put('corporationRuntime','corporations\u001f'+EMPLOYER,{corporationID:EMPLOYER,isNPC:true,
  wallet:{divisions:{'1000':{balance:employerBalance,journal:[],transactions:[]}}}});
 f.put('npcEntities','npcEntities',{pilots:{[P]:{available:true,pilotID:P,agentID:AGENT}}});
}
module.exports={open,tempDb,seed,cmd,OWNER,EMPLOYER,AGENT,PRICE,P,OP,CONTRACT,OFFER,pf52,api};