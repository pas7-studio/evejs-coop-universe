'use strict';
const {test}=require('node:test'),assert=require('node:assert/strict');
const {DatabaseSync}=require('node:sqlite');
const fs=require('node:fs'),vm=require('node:vm'),path=require('node:path');
const code=fs.readFileSync(path.join(__dirname,'../native/coopPersonalFleetOriginalWalletAuthority.js'),'utf8');
const SEP='\u001f';
function fixture(fn){
 const db=new DatabaseSync(':memory:');for(const table of ['characters','corporationRuntime'])
  db.exec('CREATE TABLE "'+table+'" (key TEXT PRIMARY KEY,json TEXT NOT NULL)');
 const atom={mode:'SERVER_INTERNAL_FLAGGED',isPoisoned:()=>false,transact(tables,callback){
  db.exec('BEGIN IMMEDIATE');const scope=new Set(tables);const tx={get(t,k){
   if(!scope.has(t))throw Error('UNDECLARED_TABLE');
   const o=db.prepare('SELECT json FROM "'+t+'" WHERE key=?').get(k);return o?JSON.parse(o.json):null;
  },put(t,k,v){if(!scope.has(t))throw Error('UNDECLARED_TABLE');
   db.prepare('INSERT INTO "'+t+'" (key,json) VALUES(?,?) ON CONFLICT(key) DO UPDATE SET json=excluded.json').run(k,JSON.stringify(v));}};
  try{const result=callback(tx);db.exec('COMMIT');return result;}catch(e){db.exec('ROLLBACK');throw e;}
 }};
 const writes=[];const state={character:{characterID:90000001,balance:4,walletJournal:[]},
  corp:{corporationID:100005,balance:500,journal:[],transactions:[]}};
 const put=(t,k,v)=>db.prepare('INSERT INTO "'+t+'" (key,json) VALUES(?,?) ON CONFLICT(key) DO UPDATE SET json=excluded.json').run(k,JSON.stringify(v));
 const rows=()=>{put('characters','90000001',state.character);
  put('corporationRuntime','corporations'+SEP+'100005',{
   corporationID:100005,wallet:{divisions:{'1000':{
    balance:state.corp.balance,journal:state.corp.journal,transactions:state.corp.transactions}}}});};rows();
 let nextId=150000001;const originals={
 '../gameStore':{coopAtomicNativeRows:atom},
 '../services/account/plexVaultLogState':{getTransactionID(){return nextId++;}},
 '../services/account/walletState':{
  getCharacterWallet:()=>({balance:state.character.balance}),
  notifyCharacterWalletChange:(id,w,opts)=>{writes.push(['playerNotice',id,w,opts]);}},
 '../services/corporation/corpWalletState':{
  getCorporationWalletDivision:()=>({balance:state.corp.balance}),
  notifyCorporationWalletChange:(id,key,balance)=>{writes.push(['corpNotice',id,key,balance]);}},
 };
 const sandbox={module:{exports:{}},require:name=>{if(!(name in originals))throw Error('UNEXPECTED_IMPORT '+name);return originals[name];},Object,Array,String,Number,Set,WeakMap,Math,process};
 vm.runInNewContext(code,sandbox);let a=sandbox.module.exports.createOriginalWalletAuthority();
 const cmd={operationID:'pf-hire-1',ownerCharacterID:90000001};const offer={employerCorpID:100005};
 const doId=(opts={})=>atom.transact(['characters','corporationRuntime'],tx=>{
  const transactionID=a.originalTransactionID({command:cmd,offer,tx});
  const valid=a.verifyJournalID({transactionID,command:cmd,offer},tx);
  return {transactionID,valid};});
 function paid(){const txID=150000001;state.character.balance=3;state.corp.balance=501;
  state.character.walletJournal=[{transactionID:txID,amount:-1,balance:3}];state.corp.journal=[{transactionID:txID,amount:1,balance:501}];state.corp.transactions=[{transactionID:txID,amount:1,balance:501}];rows();
  put('corporationRuntime','coop-personal-fleet'+SEP+'paid-hire-v1:pf-hire-1',{
   operationID:'pf-hire-1',ownerCharacterID:90000001,employerCorpID:100005,transactionID:txID,
   characterAfterCents:300,corporationAfterCents:50100,amountCents:100,hireReceiptHash:'f'.repeat(64),status:'PAID'});
  return {command:cmd,receipt:{status:'APPLIED',receipt:{type:'HIRED'},
   hireReceiptHash:'f'.repeat(64),transactionID:txID}};
 }
 try{fn({a,atom,db,cmd,offer,doId,pay:paid,rows,writes,state,originals,create:sandbox.module.exports.createOriginalWalletAuthority});}
 finally{db.close();}
}
test('real stock wallet ID accepted exactly once under same SQLite tx',()=>fixture(f=>{
 const r=f.doId();assert.equal(r.valid,true);assert.equal(r.transactionID,150000001);
}));
test('cannot forge transaction ID before original wallet generator',()=>fixture(f=>{
 const r=f.atom.transact(['characters','corporationRuntime'],tx=>f.a.verifyJournalID({transactionID:150000001,command:f.cmd,offer:f.offer},tx));
 assert.equal(r,false);
}));
test('changing native wallet transaction number is refused',()=>fixture(f=>{
 const r=f.atom.transact(['characters','corporationRuntime'],tx=>{
  f.a.originalTransactionID({command:f.cmd,offer:f.offer,tx});
  return f.a.verifyJournalID({transactionID:150000099,command:f.cmd,offer:f.offer},tx);
 });assert.equal(r,false);
}));
test('one original ID cannot be verified twice in transaction',()=>fixture(f=>{
 const r=f.atom.transact(['characters','corporationRuntime'],tx=>{
  const transactionID=f.a.originalTransactionID({command:f.cmd,offer:f.offer,tx});
  return [f.a.verifyJournalID({transactionID,command:f.cmd,offer:f.offer},tx),
   f.a.verifyJournalID({transactionID,command:f.cmd,offer:f.offer},tx)];});
 assert.deepEqual(r,[true,false]);
}));
test('repeated native id allocation in one transaction rejected',()=>fixture(f=>{
 const r=f.atom.transact(['characters','corporationRuntime'],tx=>{
  const a=f.a.originalTransactionID({command:f.cmd,offer:f.offer,tx});
  const b=f.a.originalTransactionID({command:f.cmd,offer:f.offer,tx});
  return [a,b];});assert.equal(r[0],150000001);assert.equal(r[1],null);
}));
test('other player cannot reuse original ID',()=>fixture(f=>{
 const r=f.atom.transact(['characters','corporationRuntime'],tx=>{
  const transactionID=f.a.originalTransactionID({command:f.cmd,offer:f.offer,tx});
  return f.a.verifyJournalID({transactionID,command:{...f.cmd,ownerCharacterID:90000002},offer:f.offer},tx);
 });assert.equal(r,false);
}));
test('other employer cannot reuse original ID',()=>fixture(f=>{
 const r=f.atom.transact(['characters','corporationRuntime'],tx=>{
  const transactionID=f.a.originalTransactionID({command:f.cmd,offer:f.offer,tx});
  return f.a.verifyJournalID({transactionID,command:f.cmd,offer:{employerCorpID:100006}},tx);
 });assert.equal(r,false);
}));
test('prior original player journal collision blocks ID',()=>fixture(f=>{
 f.state.character.walletJournal=[{transactionID:150000001}];f.rows();assert.equal(f.doId().valid,false);
}));
test('prior original corp journal collision blocks ID',()=>fixture(f=>{
 f.state.corp.journal=[{transactionID:150000001}];f.rows();assert.equal(f.doId().valid,false);
}));
test('prior original corp market transaction collision blocks ID',()=>fixture(f=>{
 f.state.corp.transactions=[{transactionID:150000001}];f.rows();assert.equal(f.doId().valid,false);
}));
test('personal fleet global journal collision blocks ID',()=>fixture(f=>{
 f.atom.transact(['corporationRuntime'],tx=>tx.put('corporationRuntime','coop-personal-fleet'+SEP+'journal-id-v1:150000001',{source:'prior'}));
 assert.equal(f.doId().valid,false);
}));
test('wrong original corporation source fails closed',()=>fixture(f=>{
 f.state.corp.journal='invalid';f.rows();assert.equal(f.doId().valid,false);
}));
test('after COMMIT original wallet and corp notifications use stock services',()=>fixture(f=>{
 const payment=f.pay();assert.equal(f.a.notifyOriginalWallet(payment),true);
 assert.equal(f.writes.length,2);assert.equal(f.writes[0][0],'playerNotice');assert.equal(f.writes[1][0],'corpNotice');
}));
test('repeated notify does not re-send or double debit',()=>fixture(f=>{
 const payment=f.pay();assert.equal(f.a.notifyOriginalWallet(payment),true);
 assert.equal(f.a.notifyOriginalWallet(payment),true);assert.equal(f.writes.length,2);
 assert.equal(f.state.character.balance,3);
}));
test('wrong transaction receipt cannot claim notification',()=>fixture(f=>{
 const payment=f.pay();payment.receipt.transactionID=123;
 assert.equal(f.a.notifyOriginalWallet(payment),false);
}));
test('pending salary notification is never reported delivered by hiring bridge',()=>fixture(f=>{
 const payment=f.pay();payment.receipt.receipt.type='PAID';assert.equal(f.a.notifyOriginalWallet(payment),false);
}));
test('nonoriginal GameStore cannot be provided to notification',()=>fixture(f=>{
 const payment=f.pay();assert.equal(f.a.notifyOriginalWallet(payment,{}),false);
}));
test('notification cannot mask original wallet readback mismatch',()=>fixture(f=>{
 const payment=f.pay();f.state.character.balance=999;
 assert.equal(f.a.notifyOriginalWallet(payment),false);assert.equal(f.writes.length,0);
}));
test('invalid original wallet source dependencies reject at install',()=>fixture(f=>{
 delete f.originals['../services/account/plexVaultLogState'].getTransactionID;
 assert.throws(()=>f.create(),/ORIGINAL_WALLET_SOURCE_MISSING/);
}));
