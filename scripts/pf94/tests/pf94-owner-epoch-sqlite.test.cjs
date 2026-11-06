'use strict';
const {test}=require('node:test');
const assert=require('node:assert/strict');
const {DatabaseSync}=require('node:sqlite');
const {createOriginalOwnerMutationEpoch,verifyOriginalSessionWitnessWithOwnerEpoch}=require('../native/coopOriginalOwnerMutationEpoch.cjs');
function withDb(callback){
 const db=new DatabaseSync(':memory:');
 for(const table of ['characters','items','corporationRuntime'])
  db.exec('CREATE TABLE "'+table+'"(key TEXT PRIMARY KEY,json TEXT NOT NULL)');
 db.prepare('INSERT INTO "characters" (key,json) VALUES (?,?)').run('90000001',JSON.stringify({characterID:90000001,shipID:2001,balance:100}));
 db.prepare('INSERT INTO "items" (key,json) VALUES (?,?)').run('items',JSON.stringify({'2001':{itemID:2001,ownerID:90000001}}));
 const get=(table,key)=>{const x=db.prepare('SELECT json FROM "'+table+'" WHERE key=?').get(key);return x?JSON.parse(x.json):null;};
 const scan=table=>db.prepare('SELECT key,json FROM "'+table+'"').all().map(x=>({key:x.key,value:JSON.parse(x.json)}));
 const put=(table,key,value)=>db.prepare('INSERT INTO "'+table+'" (key,json) VALUES (?,?) ON CONFLICT(key) DO UPDATE SET json=excluded.json').run(key,JSON.stringify(value));
 const del=(table,key)=>db.prepare('DELETE FROM "'+table+'" WHERE key=?').run(key);
 db.exec('BEGIN IMMEDIATE');
 const scope=createOriginalOwnerMutationEpoch({get,scan,put,del});
 try{callback({db,tx:scope.tx,get,scan,put,del,verify:(fn)=>verifyOriginalSessionWitnessWithOwnerEpoch(scope.tx,fn,Object.freeze({characterID:90000001}))});}
 finally{scope.close();db.exec('ROLLBACK');db.close()}
}
test('PF94 pure read-only witness original owner wrapper succeeds',()=>withDb(h=>{
 assert.equal(h.verify((req,reader)=>{assert.equal(reader.get('characters','90000001').shipID,2001);assert.equal(reader.put,undefined);return true}),true);
}));
test('PF94 write then restore original character row is still detected',()=>withDb(h=>{
 const first=h.get('characters','90000001');
 assert.throws(()=>h.verify(()=>{h.tx.put('characters','90000001',{...first,balance:999});h.tx.put('characters','90000001',first);return true}),/WRITE_ATTEMPT_ROLLBACK/);
 assert.deepEqual(h.get('characters','90000001'),first);
}));
test('PF94 identical value write cannot evade original owner write counter',()=>withDb(h=>{
 const unchanged=h.get('characters','90000001');
 assert.throws(()=>h.verify(()=>{h.tx.put('characters','90000001',unchanged);return false}),/WRITE_ATTEMPT_ROLLBACK/);
}));
test('PF94 missing row delete still counts as a write attempt',()=>withDb(h=>{
 assert.throws(()=>h.verify(()=>{h.tx.del('items','not-there');return true}),/WRITE_ATTEMPT_ROLLBACK/);
}));
test('PF94 collateral corporation runtime write is caught even when witness says false',()=>withDb(h=>{
 assert.throws(()=>h.verify(()=>{h.tx.put('corporationRuntime','surprise',{x:1});return false}),/WRITE_ATTEMPT_ROLLBACK/);
}));
test('PF94 forged original tx never receives writer authority',()=>withDb(h=>{
 assert.throws(()=>verifyOriginalSessionWitnessWithOwnerEpoch(Object.freeze({get:h.tx.get,scan:h.tx.scan}),()=>true,{}),/AUTHENTIC_NATIVE_OWNER_EPOCH_REQUIRED/);
}));
test('PF94 read-only reader clones do not mutate original store',()=>withDb(h=>{
 assert.equal(h.verify((r,reader)=>{const v=reader.get('characters','90000001');v.balance=0;reader.scan('characters').push({key:'fake'});return true}),true);
 assert.equal(h.get('characters','90000001').balance,100);
}));
test('PF94 async thenable refused',()=>withDb(h=>{
 assert.throws(()=>h.verify(()=>Promise.resolve(true)),/ASYNC_ORIGINAL_WITNESS_FORBIDDEN/);
}));
test('PF94 thrown witness exception propagated when transaction was not mutated',()=>withDb(h=>{
 assert.throws(()=>h.verify(()=>{throw Error('native session gone')}),/native session gone/);
}));
test('PF94 false without a write remains a normal failed witness',()=>withDb(h=>{
 assert.equal(h.verify(()=>false),false);
}));
test('PF94 transaction issued token cannot be reused after close',()=>{
 let tx;withDb(h=>{tx=h.tx;});
 assert.throws(()=>verifyOriginalSessionWitnessWithOwnerEpoch(tx,()=>true,{}),/NATIVE_TRANSACTION_CLOSED/);
});
test('PF94 malformed owner API construction fails closed',()=>{
 assert.throws(()=>createOriginalOwnerMutationEpoch({get:()=>null,put:()=>null}),/NATIVE_GAMESTORE_OWNER_METHODS_REQUIRED/);
});
test('PF94 original SQLite rollback after detected witness write restores physical durable row',()=>{
 const db=new DatabaseSync(':memory:');
 try{
  db.exec('CREATE TABLE "characters"(key TEXT PRIMARY KEY,json TEXT NOT NULL)');
  const key='90000001',row={characterID:90000001,balance:100};
  db.prepare('INSERT INTO "characters"(key,json) VALUES (?,?)').run(key,JSON.stringify(row));
  const get=(t,k)=>{const r=db.prepare('SELECT json FROM "characters" WHERE key=?').get(k);return r?JSON.parse(r.json):null};
  const put=(t,k,v)=>db.prepare('UPDATE "characters" SET json=? WHERE key=?').run(JSON.stringify(v),k);
  db.exec('BEGIN IMMEDIATE');
  const native=createOriginalOwnerMutationEpoch({get,scan:()=>[],put,del:()=>{}});
  assert.throws(()=>verifyOriginalSessionWitnessWithOwnerEpoch(native.tx,()=>{
   native.tx.put('characters',key,{...row,balance:999});
   native.tx.put('characters',key,row);
   return false;
  },{}),/WRITE_ATTEMPT_ROLLBACK/);
  // In EveJS the enclosing GameStore catches the exception, does ROLLBACK.
  native.close();db.exec('ROLLBACK');
  const disk=db.prepare('SELECT json FROM "characters" WHERE key=?').get(key);
  assert.deepEqual(JSON.parse(disk.json),row);
 }finally{db.close()}
});
test('PF94 deliberately does NOT attest raw DB writes bypassing original writer closure',()=>withDb(h=>{
 // This is why source-owned integration of ALL GameStore put/del paths is required.
 const response=h.verify(()=>{h.put('corporationRuntime','bypass',{x:1});return true});
 assert.equal(response,true);
 assert.deepEqual(h.get('corporationRuntime','bypass'),{x:1});
}));
