'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const {DatabaseSync}=require('node:sqlite');
const fs=require('node:fs'),os=require('node:os'),path=require('node:path');
const {assertMiningWriteAuthorized,CLAIMS,SHUTDOWN,PERMIT,WAR}=
 require('../native/coopPersonalFleetMiningTxnGuard');
const systemID=30000144,shipID=511010,opKey='coopMiningCycle:'+'a'.repeat(64),leaseToken='lease-token-pf44-001';
function startDb(file){
 const db=new DatabaseSync(file);
 db.exec('PRAGMA journal_mode=WAL;PRAGMA synchronous=FULL');
 assert.equal(db.prepare('PRAGMA synchronous').get().synchronous,2);
 for(const table of ['corporationRuntime','miningRuntimeState','npcCargo'])
  db.exec(`CREATE TABLE IF NOT EXISTS ${table} (key TEXT PRIMARY KEY, json TEXT NOT NULL)`);
 return db;
}
function txOf(db){
 return {
  get(table,key){assert.ok(['corporationRuntime','miningRuntimeState','npcCargo'].includes(table));
   const row=db.prepare(`SELECT json FROM ${table} WHERE key=?`).get(key);return row?JSON.parse(row.json):null;},
  put(table,key,val){assert.ok(['corporationRuntime','miningRuntimeState','npcCargo'].includes(table));
   db.prepare(`INSERT INTO ${table}(key,json) VALUES(?,?) ON CONFLICT(key) DO UPDATE SET json=excluded.json`).run(key,JSON.stringify(val));},
 };
}
function atomic(db,callback){
 db.exec('BEGIN IMMEDIATE');
 try{const out=callback(txOf(db));db.exec('COMMIT');return out;}
 catch(error){db.exec('ROLLBACK');throw error;}
}
function seed(db){
 const permit={systemID,operationID:opKey,leaseToken,writer:'mining_cycle',state:'PENDING',attemptID:null};
 atomic(db,tx=>{
  tx.put('corporationRuntime',CLAIMS,{version:1,claims:{},generations:{},processed:{}});
  tx.put('corporationRuntime',WAR,{version:1,ships:{}});
  tx.put('corporationRuntime','stub-pf44-native-lease',{systemID,state:'ACTIVE',token:leaseToken});
  tx.put('corporationRuntime',SHUTDOWN+systemID,{version:1,systemID,
   gate:{systemID,state:'ACTIVE',stopPhase:'NONE',leaseToken,writerNames:['mining_cycle']},
   permits:{[opKey]:permit}});
  tx.put('corporationRuntime',PERMIT+opKey,permit);
  tx.put('miningRuntimeState','rock',{remainingQuantity:10});
  tx.put('npcCargo','cargo',{[shipID]:{quantity:0,entityID:shipID}});
 });
}
const leaseReader=(tx)=>tx.get('corporationRuntime','stub-pf44-native-lease');
function commitCycle(tx){
 assertMiningWriteAuthorized(tx,{systemID,shipID,opKey},leaseReader);
 const rock=tx.get('miningRuntimeState','rock');
 const cargo=tx.get('npcCargo','cargo');
 rock.remainingQuantity-=2;cargo[shipID].quantity+=2;
 tx.put('miningRuntimeState','rock',rock);
 tx.put('npcCargo','cargo',cargo);
}
test('BEGIN IMMEDIATE: one atomic guarded commit persists source/cargo and pending permit across restart',()=>{
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'pf49-sqlite-'));
 const file=path.join(dir,'native-fixture.sqlite');
 try {
  let db=startDb(file);seed(db);
  atomic(db,commitCycle);
  db.close();
  db=startDb(file);
  const tx=txOf(db);
  assert.equal(tx.get('miningRuntimeState','rock').remainingQuantity,8);
  assert.equal(tx.get('npcCargo','cargo')[shipID].quantity,2);
  // A crash before the PF46 ACK MUST retain the pending write fence.
  assert.equal(tx.get('corporationRuntime',PERMIT+opKey).state,'PENDING');
  assert.throws(()=>atomic(db,t=>{t.put('corporationRuntime',PERMIT+opKey,{...t.get('corporationRuntime',PERMIT+opKey),state:'ACKED'});commitCycle(t)}),
   /PF49_MINING_WRITE_PERMIT_UNPROVEN/);
  assert.equal(tx.get('corporationRuntime',PERMIT+opKey).state,'PENDING');
  // Once the original lease is not ACTIVE, no further source mutation.
  atomic(db,t=>t.put('corporationRuntime','stub-pf44-native-lease',{systemID,state:'RELEASED',token:leaseToken}));
  assert.throws(()=>atomic(db,commitCycle),/PF49_PF44_ACTIVE_LEASE_UNPROVEN/);
  assert.equal(tx.get('miningRuntimeState','rock').remainingQuantity,8);
  assert.equal(tx.get('npcCargo','cargo')[shipID].quantity,2);
  db.close();
 }finally{fs.rmSync(dir,{recursive:true,force:true});}
});
test('Guard denial rolls back speculative original source/cargo rows in same SQLite transaction',()=>{
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'pf49-rollback-'));
 try{
  const db=startDb(path.join(dir,'db.sqlite'));seed(db);
  assert.throws(()=>atomic(db,t=>{
   t.put('miningRuntimeState','rock',{remainingQuantity:0});
   t.put('npcCargo','cargo',{[shipID]:{quantity:10,entityID:shipID}});
   t.put('corporationRuntime',SHUTDOWN+systemID,{
     ...t.get('corporationRuntime',SHUTDOWN+systemID),
     gate:{...t.get('corporationRuntime',SHUTDOWN+systemID).gate,state:'DRAINING'}});
   commitCycle(t);
  }),/PF49_MINING_GATE_NOT_ACTIVE/);
  assert.equal(txOf(db).get('miningRuntimeState','rock').remainingQuantity,10);
  assert.equal(txOf(db).get('npcCargo','cargo')[shipID].quantity,0);
  assert.equal(txOf(db).get('corporationRuntime',SHUTDOWN+systemID).gate.state,'ACTIVE');
  db.close();
 }finally{fs.rmSync(dir,{recursive:true,force:true});}
});