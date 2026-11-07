import test from 'node:test';
import assert from 'node:assert/strict';
import {DatabaseSync} from 'node:sqlite';
import {createRequire} from 'node:module';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
const require=createRequire(import.meta.url);
const {createNativeMiningGameStoreAdapter,CLAIMS_KEY,SHUTDOWN_KEY,PERMIT_KEY}=require('../scripts/lib/personal-fleet-mining-gamestore.cjs');
const {createMiningShutdownProtocol}=require('../scripts/lib/personal-fleet-mining-shutdown.cjs');
const sys=30000144, token='pf44-token-00000001', attemptID='stop-attempt-000001';
const writeNames=['startup','restore','ore_extract','haul_transfer','shutdown_cleanup'];
const leaseKey=id=>`pf44-lease\u001f${id}`;
function make({file=':memory:',seed=true}={}){
 const db=new DatabaseSync(file);db.exec(`CREATE TABLE IF NOT EXISTS corporationRuntime(key TEXT PRIMARY KEY,json TEXT NOT NULL); PRAGMA busy_timeout=300;`);
 const native=(tables, fn)=>{
  assert.deepEqual(tables,['corporationRuntime']);
  db.exec('BEGIN IMMEDIATE');
  try {
   const tx={
    get(_table,key){const r=db.prepare('SELECT json FROM corporationRuntime WHERE key=?').get(key);return r?JSON.parse(r.json):null},
    put(_table,key,obj){db.prepare('INSERT INTO corporationRuntime VALUES(?,?) ON CONFLICT(key) DO UPDATE SET json=excluded.json').run(key,JSON.stringify(obj))},
   };
   const result=fn(tx);if(result&&typeof result.then==='function')throw Error('ASYNC_DISALLOWED');
   db.exec('COMMIT');return result;
  }catch(e){db.exec('ROLLBACK');throw e;}
 };
 let poisoned=false;
 const gameStore={coopAtomicNativeRows:{transact:native,isPoisoned:()=>poisoned}};
 const leaseAuthority={
  readLease(tx,id){return tx.get('corporationRuntime',leaseKey(id))},
  releaseLease(tx,id,t,witness){
   const row=tx.get('corporationRuntime',leaseKey(id));
   if(!row||row.state!=='ACTIVE'||row.token!==t)return false;
   tx.put('corporationRuntime',leaseKey(id),{...row,state:'RELEASED',witness});return true;
  }
 };
 const insert=(key,record)=>db.prepare('INSERT INTO corporationRuntime VALUES(?,?) ON CONFLICT(key) DO UPDATE SET json=excluded.json').run(key,JSON.stringify(record));
 const lookup=key=>{const r=db.prepare('SELECT json FROM corporationRuntime WHERE key=?').get(key);return r?JSON.parse(r.json):null;};
 if(seed){insert(leaseKey(sys),{systemID:sys,token,state:'ACTIVE'});
 insert(CLAIMS_KEY,{version:1,claims:{},generations:{},processed:{}});}
 const adapter=createNativeMiningGameStoreAdapter({gameStore,leaseAuthority});
 const deps={transact:adapter.transact,nativeStop:async({systemID,attemptID})=>({status:'STOP_CONFIRMED',systemID,attemptID}),
  verifyNativeStop:async()=>true,nativeAudit:async({systemID})=>({status:'OBSERVED_EMPTY_UNPROVEN',systemID,blockers:[]}),
  verifyCoverage:async({writerNames})=>({status:'ALL_WRITERS_FENCED',writerNames,sourceFingerprint:'a'.repeat(64)}),
  verifyReceipt:()=>true,writerNames:writeNames,now:()=>1770000000000};
 let protocol=createMiningShutdownProtocol(deps);
 const act=()=>protocol.activate({systemID:sys,leaseToken:token});
 const begin=(op)=>protocol.beginWrite({systemID:sys,leaseToken:token,writer:'startup',operationID:op});
 const finish=(op)=>protocol.finishWrite({systemID:sys,leaseToken:token,operationID:op,receipt:'ack'});
 const shutdown=()=>protocol.beginShutdown({systemID:sys,leaseToken:token,attemptID});
 const complete=()=>protocol.completeShutdown({systemID:sys,leaseToken:token,attemptID});
 return {db,gameStore,leaseAuthority,adapter,insert,lookup,act,begin,finish,shutdown,complete,get protocol(){return protocol},setProtocol(p){protocol=p},deps,poison:()=>{poisoned=true},close:()=>db.close()};
}
const boom=(code,fn)=>assert.throws(fn,e=>e.code===code,code);
const boomAsync=async(code,fn)=>assert.rejects(fn,e=>e.code===code,code);
test('PF47 single GameStore row protocol releases original PF44 lease atomically',async()=>{
 const f=make();f.act();f.begin('native-write-000001');f.finish('native-write-000001');f.shutdown();
 assert.equal((await f.complete()).status,'RELEASED');
 assert.equal(f.lookup(leaseKey(sys)).state,'RELEASED');
 assert.equal(f.lookup(SHUTDOWN_KEY+sys).gate.state,'RELEASED');
 assert.equal(f.lookup(PERMIT_KEY+'native-write-000001').state,'ACKED');f.close();
});
test('PF47 refuses missing claim row',()=>{const f=make({seed:false});f.insert(leaseKey(sys),{systemID:sys,state:'ACTIVE',token});boom('PF47_PF_CLAIMS_NOT_PROVEN',f.act);f.close()});
test('PF47 refuses missing PF44 lease row',()=>{const f=make({seed:false});f.insert(CLAIMS_KEY,{version:1,claims:{},generations:{},processed:{}});boom('LEASE_NOT_OWNED',f.act);f.close()});
test('PF47 rejects corrupt PF44 lease identity',()=>{const f=make();f.insert(leaseKey(sys),{systemID:1,state:'ACTIVE',token});boom('PF47_PF44_LEASE_ROW_UNVERIFIED',f.act);f.close()});
test('PF47 rejects duplicate operation globally across systems',()=>{
 const f=make();f.act();f.begin('native-write-000002');
 boom('PF47_OPERATION_ID_CROSS_SYSTEM_REUSE',()=>f.adapter.transact(tx=>tx.writePermit({systemID:sys+1,operationID:'native-write-000002',state:'PENDING'})));f.close();
});
test('PF47 rejects divergent operation index rather than releasing',()=>{
 const f=make();f.act();f.begin('native-write-000003');
 f.insert(PERMIT_KEY+'native-write-000003',{systemID:sys,operationID:'native-write-000003',state:'ACKED',writer:'startup'});
 boom('PF47_PERMIT_INDEX_DIVERGED',()=>f.protocol.inspect({systemID:sys}));f.close();
});
test('PF47 poison blocks all native write calls',()=>{const f=make();f.poison();boom('PF47_NATIVE_STORE_POISONED',f.act);f.close()});
test('PF47 scoped API refuses a fake async mutation',()=>{const f=make();assert.throws(()=>f.adapter.transact(async()=>42),/PF47_ASYNC_TRANSACTION_FORBIDDEN/);f.close()});
test('PF47 release CAS mismatch leaves both records ACTIVE',async()=>{
 const f=make();f.act();f.shutdown();
 f.leaseAuthority.releaseLease=()=>false;
 await boomAsync('ATOMIC_LEASE_RELEASE_FAILED',f.complete);
 assert.equal(f.lookup(leaseKey(sys)).state,'ACTIVE');
 assert.equal(f.lookup(SHUTDOWN_KEY+sys).gate.state,'VERIFYING');f.close();
});
test('PF47 adapter factory refuses untrusted lease binding',()=>{
 const f=make();assert.throws(()=>createNativeMiningGameStoreAdapter({gameStore:f.gameStore}),/PF47_PF44_LEASE_AUTHORITY_REQUIRED/);f.close();
});
test('PF47 restart reopens pending operation but never deletes it',()=>{
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'pf47-gs-')),file=path.join(dir,'store.db');
 try {const a=make({file});a.act();a.begin('native-write-000004');a.close();
 const b=make({file});b.shutdown();assert.equal(b.protocol.inspect({systemID:sys}).pending.length,1);b.close();}
 finally {fs.rmSync(dir,{recursive:true,force:true});}
});