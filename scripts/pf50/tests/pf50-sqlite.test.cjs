'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const {DatabaseSync}=require('node:sqlite'),fs=require('node:fs'),os=require('node:os'),path=require('node:path');
const {createHash}=require('node:crypto');
const {assertHaulWriteAuthorized,CLAIMS,WAR,SHUTDOWN,PERMIT}=require('../native/coopPersonalFleetHaulTxnGuard');
const systemID=30000144,minerID=66001,haulerID=66002,token='lease-token-pf50-native-1';
const opKey='pf-haul:'+createHash('sha256').update('physically-existing-original-cargo').digest('hex');
const receiptKey='coopNativeHaulTransfer:7001';
function start(file){const db=new DatabaseSync(file);db.exec('PRAGMA journal_mode=WAL;PRAGMA synchronous=FULL');
 assert.equal(db.prepare('PRAGMA synchronous').get().synchronous,2);
 for(const t of ['corporationRuntime','npcCargo'])db.exec(`CREATE TABLE IF NOT EXISTS ${t}(key TEXT PRIMARY KEY,json TEXT NOT NULL)`);
 return db;}
function tx(db){return {get(t,k){const r=db.prepare(`SELECT json FROM ${t} WHERE key=?`).get(k);return r?JSON.parse(r.json):null;},
 put(t,k,v){db.prepare(`INSERT INTO ${t}(key,json) VALUES(?,?) ON CONFLICT(key) DO UPDATE SET json=excluded.json`).run(k,JSON.stringify(v));}}}
function atomic(db,fn){db.exec('BEGIN IMMEDIATE');try{const v=fn(tx(db));db.exec('COMMIT');return v;}catch(e){db.exec('ROLLBACK');throw e;}}
function seed(db){const permit={systemID,leaseToken:token,operationID:opKey,writer:'haul_transfer',state:'PENDING',attemptID:null};
 atomic(db,t=>{
 t.put('corporationRuntime',CLAIMS,{version:1,claims:{},generations:{},processed:{}});
 t.put('corporationRuntime',WAR,{version:1,ships:{}});
 t.put('corporationRuntime',SHUTDOWN+systemID,{version:1,systemID,
  gate:{systemID,leaseToken:token,state:'ACTIVE',stopPhase:'NONE',writerNames:['haul_transfer','shutdown_cleanup']},
  permits:{[opKey]:permit}});
 t.put('corporationRuntime',PERMIT+opKey,permit);
 t.put('corporationRuntime','fixture-pf44',{systemID,state:'ACTIVE',token});
 t.put('npcCargo','cargo',{'7001':{cargoID:7001,entityID:minerID,quantity:12,ownerID:10}});
 });}
const readLease=t=>t.get('corporationRuntime','fixture-pf44');
const params={systemID,minerID,haulerID,opKey};
function move(t){assertHaulWriteAuthorized(t,params,readLease);
 const cargo=t.get('npcCargo','cargo'),original=cargo['7001'];
 if(original.entityID!==minerID||original.quantity!==12)throw Error('ORIGINAL_CUSTODY_CHANGED');
 t.put('npcCargo','cargo',{...cargo,'7001':{...original,entityID:haulerID}});
 t.put('npcCargo',receiptKey,{version:1,status:'COMMITTED',cargoID:7001,minerID,haulerID});}
function temp(cb){const dir=fs.mkdtempSync(path.join(os.tmpdir(),'pf50-sqlite-'));
 try{return cb(path.join(dir,'db.sqlite'));}finally{fs.rmSync(dir,{recursive:true,force:true});}}
test('atomic cargo title + receipt commit and PF permit survive restart',()=>temp(file=>{
 let db=start(file);seed(db);atomic(db,move);db.close();db=start(file);
 assert.equal(tx(db).get('npcCargo','cargo')['7001'].entityID,haulerID);
 assert.equal(tx(db).get('npcCargo',receiptKey).status,'COMMITTED');
 assert.equal(tx(db).get('corporationRuntime',PERMIT+opKey).state,'PENDING');
 assert.throws(()=>atomic(db,move),/ORIGINAL_CUSTODY_CHANGED/);
 assert.equal(tx(db).get('npcCargo','cargo')['7001'].quantity,12);
 db.close();
}));
test('rollback denies speculative native cargo/receipt on DRAINING',()=>temp(file=>{
 const db=start(file);seed(db);
 assert.throws(()=>atomic(db,t=>{
 const gate=t.get('corporationRuntime',SHUTDOWN+systemID);
 t.put('corporationRuntime',SHUTDOWN+systemID,{...gate,gate:{...gate.gate,state:'DRAINING'}});
 t.put('npcCargo','cargo',{'7001':{cargoID:7001,entityID:haulerID,quantity:12,ownerID:10}});
 move(t);
 }),/PF50_HAUL_GATE_NOT_ACTIVE/);
 assert.equal(tx(db).get('npcCargo','cargo')['7001'].entityID,minerID);
 assert.equal(tx(db).get('corporationRuntime',SHUTDOWN+systemID).gate.state,'ACTIVE');
 assert.equal(tx(db).get('npcCargo',receiptKey),null);db.close();
}));
test('released lease refuses cargo title changes inside same transaction',()=>temp(file=>{
 const db=start(file);seed(db);
 atomic(db,t=>t.put('corporationRuntime','fixture-pf44',{systemID,state:'RELEASED',token}));
 assert.throws(()=>atomic(db,move),/PF50_PF44_LEASE_UNPROVEN/);
 assert.equal(tx(db).get('npcCargo','cargo')['7001'].entityID,minerID);
 db.close();
}));
test('invalid pending permit fails while durable source unchanged',()=>temp(file=>{
 const db=start(file);seed(db);
 atomic(db,t=>t.put('corporationRuntime',PERMIT+opKey,{...t.get('corporationRuntime',PERMIT+opKey),state:'ACKED'}));
 assert.throws(()=>atomic(db,move),/PF50_HAUL_PERMIT_UNPROVEN/);
 assert.equal(tx(db).get('npcCargo','cargo')['7001'].entityID,minerID);
 db.close();
}));