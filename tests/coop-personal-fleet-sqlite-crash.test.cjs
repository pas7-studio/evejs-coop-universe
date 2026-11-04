'use strict';
// PF-15: disposable SQLite crash drill; NOT production EveJS wallet semantics.
// Runs real native Node SQLite file with independent SIGKILL child process.
const {DatabaseSync}=require('node:sqlite');
const fs=require('node:fs');
const os=require('node:os');
const path=require('node:path');
const {spawnSync}=require('node:child_process');
const test=require('node:test');
const assert=require('node:assert/strict');
const CONTRACT_KEY='coop-personal-fleet\u001fpayroll-ledger-v1';
const PAYER='100',PAYEE='200',AMOUNT=200;
const clone=x=>JSON.parse(JSON.stringify(x));
const read=(db,table,key)=>{
 const row=db.prepare(`SELECT json FROM "${table}" WHERE key=?`).get(key);
 return row?JSON.parse(row.json):null;
};
const write=(db,table,key,value)=>db.prepare(
 `INSERT INTO "${table}" (key,json) VALUES (?,?) ON CONFLICT(key) DO UPDATE SET json=excluded.json`
).run(key,JSON.stringify(value));
function open(file){
 const db=new DatabaseSync(file);
 db.exec('PRAGMA synchronous=FULL');
 assert.equal(db.prepare('PRAGMA synchronous').get().synchronous,2);
 return db;
}
function initialize(file){
 const db=open(file);
 db.exec('CREATE TABLE characters (key TEXT PRIMARY KEY, json TEXT NOT NULL)');
 db.exec('CREATE TABLE corporationRuntime (key TEXT PRIMARY KEY, json TEXT NOT NULL)');
 write(db,'characters',PAYER,{balanceISK:1000});
 write(db,'characters',PAYEE,{balanceISK:0});
 write(db,'corporationRuntime',CONTRACT_KEY,{version:1,invoiceID:'invoice-1',phase:'DUE',amountISK:AMOUNT,settlementID:null});
 db.close();
}
function worker(file,point){
 const db=open(file);
 // Intent must be durable BEFORE attempting a real-world side effect.
 db.exec('BEGIN IMMEDIATE');
 const intent=read(db,'corporationRuntime',CONTRACT_KEY);
 assert.equal(intent.phase,'DUE');
 intent.phase='SETTLING';
 write(db,'corporationRuntime',CONTRACT_KEY,intent);
 db.exec('COMMIT');
 if(point==='after_intent')process.kill(process.pid,'SIGKILL');
 db.exec('BEGIN IMMEDIATE');
 const invoice=read(db,'corporationRuntime',CONTRACT_KEY);
 assert.equal(invoice.phase,'SETTLING');
 const payer=read(db,'characters',PAYER);
 payer.balanceISK-=AMOUNT;
 write(db,'characters',PAYER,payer);
 if(point==='after_debit')process.kill(process.pid,'SIGKILL');
 const payee=read(db,'characters',PAYEE);
 payee.balanceISK+=AMOUNT;
 write(db,'characters',PAYEE,payee);
 if(point==='before_commit')process.kill(process.pid,'SIGKILL');
 invoice.phase='PAID';
 invoice.settlementID='native-settlement-1';
 write(db,'corporationRuntime',CONTRACT_KEY,invoice);
 db.exec('COMMIT');
 if(point==='after_commit')process.kill(process.pid,'SIGKILL');
 db.close();
}
if(process.argv[2]==='--worker'){
 worker(process.argv[3],process.argv[4]);
}else{
 for(const point of ['after_intent','after_debit','before_commit','after_commit']){
  test('SQLite SIGKILL '+point+': no double ISK and no partial wallet commit',()=>{
   const dir=fs.mkdtempSync(path.join(os.tmpdir(),'evejs-pf15-'));
   const file=path.join(dir,'disposable-wallet.sqlite');
   try{
    initialize(file);
    const child=spawnSync(process.execPath,[__filename,'--worker',file,point],{
     timeout:10000,encoding:'utf8',env:{...process.env,NODE_NO_WARNINGS:'1'}
    });
    assert.equal(child.signal,'SIGKILL',child.stderr||'worker should die by SIGKILL');
    const db=open(file);
    try{
     assert.equal(db.prepare('PRAGMA integrity_check').get().integrity_check,'ok');
     const payer=read(db,'characters',PAYER),payee=read(db,'characters',PAYEE);
     const invoice=read(db,'corporationRuntime',CONTRACT_KEY);
     assert.equal(payer.balanceISK+payee.balanceISK,1000);
     if(point==='after_commit'){
      assert.deepEqual([payer.balanceISK,payee.balanceISK],[800,200]);
      assert.equal(invoice.phase,'PAID');
      assert.equal(invoice.settlementID,'native-settlement-1');
     }else{
      assert.deepEqual([payer.balanceISK,payee.balanceISK],[1000,0]);
      assert.equal(invoice.phase,'SETTLING');
      assert.equal(invoice.settlementID,null);
     }
     // Restart/replay must never issue a second wallet transfer. An ambiguous
     // pre-commit outcome remains SETTLING pending independent reconciliation.
     const before=clone([payer,payee,invoice]);
     const retry=read(db,'corporationRuntime',CONTRACT_KEY);
     assert.ok(['SETTLING','PAID'].includes(retry.phase));
     assert.equal(retry.phase==='DUE',false);
     assert.deepEqual([read(db,'characters',PAYER),read(db,'characters',PAYEE),
      read(db,'corporationRuntime',CONTRACT_KEY)],before);
    }finally{db.close()}
   }finally{fs.rmSync(dir,{recursive:true,force:true})}
  });
 }
}
