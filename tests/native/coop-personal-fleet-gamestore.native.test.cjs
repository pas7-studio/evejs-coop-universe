'use strict';
// PF-16 native-gated acceptance test, intentionally excluded from generic
// reference-only Personal Fleet CI. Never imports a copied EveJS engine.
// Usage: EVEJS_NATIVE_FORK_ROOT=/abs/path/to/EveJS node --test tests/native/coop-personal-fleet-gamestore.native.test.cjs
// The test MUST fail without an actual engine fork checkout.
const fs=require('node:fs');
const path=require('node:path');
const os=require('node:os');
const {spawnSync}=require('node:child_process');
const {DatabaseSync}=require('node:sqlite');
const test=require('node:test');
const assert=require('node:assert/strict');
const root=process.env.EVEJS_NATIVE_FORK_ROOT;
if(!root||!path.isAbsolute(root)){
 throw Error('PF16_NATIVE_FORK_ROOT_REQUIRED: set EVEJS_NATIVE_FORK_ROOT to the genuine EveJS checkout');
}
const native=path.join(root,'Code','server','src','space','coopGameStoreAtomic.js');
if(!fs.existsSync(native)||!fs.statSync(native).isFile()){
 throw Error('PF16_NATIVE_GAMESTORE_SOURCE_MISSING:'+native);
}
const {createSqliteAdapter}=require(native);
assert.equal(typeof createSqliteAdapter,'function');
const PAYER='100',PAYEE='200',KEY='coop-personal-fleet\u001fpf16-native-test-only';
const sum=300;
function dbOpen(file){
 const db=new DatabaseSync(file);
 db.exec('PRAGMA synchronous=FULL');
 return db;
}
function load(db,table,key){
 const hit=db.prepare('SELECT json FROM "'+table+'" WHERE key=?').get(key);
 return hit?JSON.parse(hit.json):null;
}
function put(db,table,key,v){
 db.prepare('INSERT INTO "'+table+'"(key,json) VALUES (?,?) ON CONFLICT(key) DO UPDATE SET json=excluded.json')
 .run(key,JSON.stringify(v));
}
function seed(file){
 const db=dbOpen(file);
 db.exec('CREATE TABLE characters (key TEXT PRIMARY KEY,json TEXT NOT NULL)');
 db.exec('CREATE TABLE corporationRuntime (key TEXT PRIMARY KEY,json TEXT NOT NULL)');
 put(db,'characters',PAYER,{balanceISK:1000});
 put(db,'characters',PAYEE,{balanceISK:0});
 put(db,'corporationRuntime',KEY,{phase:'DUE',settlementID:null,amountISK:sum});
 db.close();
}
function doTransaction(file,point){
 const db=dbOpen(file),atomic=createSqliteAdapter(()=>db).claimTransactor();
 const originally=process.env.EVEJS_COOP_NATIVE_ATOMIC_ROWS;
 process.env.EVEJS_COOP_NATIVE_ATOMIC_ROWS='1';
 try{
  atomic.transact(['characters','corporationRuntime'],tx=>{
   const i=tx.get('corporationRuntime',KEY);
   assert.equal(i.phase,'DUE');
   tx.put('corporationRuntime',KEY,{...i,phase:'SETTLING'});
  });
  if(point==='after_intent')process.kill(process.pid,'SIGKILL');
  atomic.transact(['characters','corporationRuntime'],tx=>{
   const i=tx.get('corporationRuntime',KEY);
   assert.equal(i.phase,'SETTLING');
   const payer=tx.get('characters',PAYER);
   tx.put('characters',PAYER,{balanceISK:payer.balanceISK-sum});
   if(point==='after_debit')process.kill(process.pid,'SIGKILL');
   const payee=tx.get('characters',PAYEE);
   tx.put('characters',PAYEE,{balanceISK:payee.balanceISK+sum});
   if(point==='before_commit')process.kill(process.pid,'SIGKILL');
   tx.put('corporationRuntime',KEY,{...i,phase:'PAID',
    settlementID:'native-pf16-transaction-1'});
  });
  if(point==='after_commit')process.kill(process.pid,'SIGKILL');
 }finally{
  if(originally===undefined)delete process.env.EVEJS_COOP_NATIVE_ATOMIC_ROWS;
  else process.env.EVEJS_COOP_NATIVE_ATOMIC_ROWS=originally;
  db.close();
 }
}
if(process.argv[2]==='--worker'){
 doTransaction(process.argv[3],process.argv[4]);
}else{
 for(const point of ['after_intent','after_debit','before_commit','after_commit']){
  test('real EveJS createSqliteAdapter SIGKILL '+point,()=>{
   const dir=fs.mkdtempSync(path.join(os.tmpdir(),'pf16-engine-'));
   const file=path.join(dir,'disposable.sqlite');
   try{
    seed(file);
    const child=spawnSync(process.execPath,[__filename,'--worker',file,point],{
     timeout:15000,encoding:'utf8',env:{...process.env,
      EVEJS_COOP_NATIVE_ATOMIC_ROWS:'1',NODE_NO_WARNINGS:'1'}
    });
    assert.equal(child.signal,'SIGKILL',child.stderr||String(child.status));
    const db=dbOpen(file);
    try{
     assert.equal(db.prepare('PRAGMA integrity_check').get().integrity_check,'ok');
     const a=load(db,'characters',PAYER);
     const b=load(db,'characters',PAYEE);
     const i=load(db,'corporationRuntime',KEY);
     assert.equal(a.balanceISK+b.balanceISK,1000);
     assert.equal(i.phase,point==='after_commit'?'PAID':'SETTLING');
     if(point==='after_commit'){
      assert.deepEqual([a.balanceISK,b.balanceISK],[700,300]);
      assert.equal(i.settlementID,'native-pf16-transaction-1');
     }else{
      assert.deepEqual([a.balanceISK,b.balanceISK],[1000,0]);
      assert.equal(i.settlementID,null);
     }
     // No implicit second transaction on a restart/read.
     assert.equal(load(db,'characters',PAYER).balanceISK,a.balanceISK);
    }finally{db.close()}
   }finally{fs.rmSync(dir,{recursive:true,force:true})}
  });
 }
 test('real EveJS adapter marks uncertain COMMIT without blind replay',()=>{
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),'pf16-commit-'));
  const file=path.join(dir,'disposable.sqlite');
  try{
   seed(file);
   const db=dbOpen(file);
   const proxy={prepare:(...a)=>db.prepare(...a),exec(sql){
    if(sql==='COMMIT')throw Error('INJECTED_COMMIT_OUTCOME_UNKNOWN');
    return db.exec(sql);
   }};
   const previous=process.env.EVEJS_COOP_NATIVE_ATOMIC_ROWS;
   process.env.EVEJS_COOP_NATIVE_ATOMIC_ROWS='1';
   try{
    const atomic=createSqliteAdapter(()=>proxy).claimTransactor();
    assert.throws(()=>atomic.transact(['corporationRuntime'],tx=>{
     tx.put('corporationRuntime',KEY,{phase:'SETTLING',amountISK:sum,settlementID:null});
    }),e=>e?.coopCommitOutcomeUnknown===true);
    // The test fixture may roll back deterministically; production caller
    // nevertheless MUST treat the COMMIT error as uncertain.
    assert.equal(load(db,'corporationRuntime',KEY).phase,'DUE');
   }finally{
    if(previous===undefined)delete process.env.EVEJS_COOP_NATIVE_ATOMIC_ROWS;
    else process.env.EVEJS_COOP_NATIVE_ATOMIC_ROWS=previous;
    db.close();
   }
  }finally{fs.rmSync(dir,{recursive:true,force:true})}
 });
}
