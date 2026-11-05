'use strict';
const test=require('node:test');const assert=require('node:assert/strict');
const fs=require('node:fs'),os=require('node:os'),path=require('node:path');
const cp=require('node:child_process');
const {DatabaseSync}=require('node:sqlite');
const {createStartupFence,CLAIMS,WAR,SHUTDOWN,ADMISSION}=require('../native/coopPersonalFleetMiningStartupFence');
const SYSTEM=30000144,TOKEN='lease-0123456789-abc',KEY='pf44-test\u001flease';
const hash=n=>String(n).repeat(64);
const PROOF={version:1,status:'VERIFIED',systemID:SYSTEM,slots:[{slot:1,miners:[12345],haulers:[12346],originalEntityHash:hash('a'),originalControllerHash:hash('b'),originalCargoHash:hash('c')}]};
function database(filename){
 const db=new DatabaseSync(filename);db.exec('PRAGMA journal_mode = WAL; PRAGMA synchronous = FULL; CREATE TABLE IF NOT EXISTS corporationRuntime (key TEXT PRIMARY KEY, json TEXT NOT NULL)');
 const read=db.prepare('SELECT json FROM corporationRuntime WHERE key=?');
 const write=db.prepare('INSERT INTO corporationRuntime(key,json) VALUES(?,?) ON CONFLICT(key) DO UPDATE SET json=excluded.json');
 const tx={get:(t,k)=>{assert.equal(t,'corporationRuntime');const row=read.get(k);return row?JSON.parse(row.json):null},put:(t,k,v)=>{assert.equal(t,'corporationRuntime');write.run(k,JSON.stringify(v))}};
 function transact(tables,fn){assert.deepEqual(tables,['corporationRuntime']);db.exec('BEGIN IMMEDIATE');try{const v=fn(tx);db.exec('COMMIT');return v;}catch(e){try{db.exec('ROLLBACK')}catch{}throw e}}
 const set=(key,value)=>transact(['corporationRuntime'],t=>t.put('corporationRuntime',key,value));
 return {db,set,get:k=>tx.get('corporationRuntime',k),store:{coopAtomicNativeRows:{transact,isPoisoned:()=>false}}};
}
function seed(file){const c=database(file);c.set(CLAIMS,{version:1,claims:{},generations:{},processed:{}});c.set(WAR,{version:1,ships:{},transfers:{},processed:{},history:[]});c.set(KEY,{version:1,systemID:SYSTEM,state:'STARTING',token:TOKEN});c.set(SHUTDOWN+SYSTEM,{version:1,systemID:SYSTEM,gate:null,permits:{}});c.db.close();}
function fence(c,{preflight=true,proof=PROOF}={}){
 return createStartupFence({gameStore:c.store,readMiningLease:(tx)=>tx.get('corporationRuntime',KEY),verifyOriginalPreflight:()=>preflight,
  verifyNativeStartup:()=>proof,enabled:()=>true,writersIntegrated:()=>true,clock:()=>1700000000000});
}
function runKilled(file,stage){
 const script=`const {DatabaseSync}=require('node:sqlite');const {createStartupFence,CLAIMS,WAR,SHUTDOWN,ADMISSION}=require(${JSON.stringify(path.resolve(__dirname,'../native/coopPersonalFleetMiningStartupFence.js'))});const db=new DatabaseSync(process.argv[1]);db.exec('PRAGMA synchronous=FULL');const g=db.prepare('SELECT json FROM corporationRuntime WHERE key=?');const p=db.prepare('INSERT INTO corporationRuntime(key,json) VALUES(?,?) ON CONFLICT(key) DO UPDATE SET json=excluded.json');const tx={get:(t,k)=>{const v=g.get(k);return v?JSON.parse(v.json):null},put:(t,k,v)=>p.run(k,JSON.stringify(v))};const gameStore={coopAtomicNativeRows:{isPoisoned:()=>false,transact:(tables,fn)=>{db.exec('BEGIN IMMEDIATE');try{const v=fn(tx);db.exec('COMMIT');return v}catch(e){db.exec('ROLLBACK');throw e}}}};const f=createStartupFence({gameStore,readMiningLease:(tx)=>tx.get('corporationRuntime','pf44-test\\u001flease'),verifyOriginalPreflight:()=>true,verifyNativeStartup:()=>true,writersIntegrated:()=>true,enabled:()=>true,clock:()=>1700000000000});const result=f.admit({systemID:30000144,fleetCount:1,operationID:'startup-child-000001'});if(result.status!=='ADMITTED')process.exit(5);if(process.argv[2]==='partial'){db.exec('BEGIN IMMEDIATE');p.run('original-native-ships',JSON.stringify({entityID:12345}));db.exec('COMMIT')}process.kill(process.pid,'SIGKILL');`;
 const out=cp.spawnSync(process.execPath,['--no-warnings','-e',script,file,stage],{timeout:12000,encoding:'utf8'});
 assert.equal(out.signal,'SIGKILL',out.stderr||out.stdout);return out;
}
function inTemp(fn){const dir=fs.mkdtempSync(path.join(os.tmpdir(),'pf51-sqlite-'));try{return fn(path.join(dir,'game.db'));}finally{fs.rmSync(dir,{recursive:true,force:true})}}
test('actual SIGKILL after durable startup reservation refuses every replay',()=>inTemp(file=>{
 seed(file);runKilled(file,'permit');const c=database(file);const saved=c.get(ADMISSION+SYSTEM);assert.equal(saved.state,'IN_FLIGHT');const r=fence(c).admit({systemID:SYSTEM,fleetCount:1,operationID:'startup-child-000002'});assert.equal(r.status,'BLOCKED');assert.match(r.reason,/STARTUP_OUTCOME_UNKNOWN/);c.db.close();
}));
test('SIGKILL after persisted native actor mutation does not allow new spawn',()=>inTemp(file=>{
 seed(file);runKilled(file,'partial');const c=database(file);assert.equal(c.get('original-native-ships').entityID,12345);const before=c.get(ADMISSION+SYSTEM);assert.equal(before.state,'IN_FLIGHT');const r=fence(c).admit({systemID:SYSTEM,fleetCount:1,operationID:'startup-child-000002'});assert.match(r.reason,/STARTUP_OUTCOME_UNKNOWN/);assert.equal(c.get('original-native-ships').entityID,12345);c.db.close();
}));
test('reconcile only with independent original record proof, no new spawn',()=>inTemp(file=>{
 seed(file);runKilled(file,'partial');const c=database(file);
 const verifier=()=>c.get('original-native-ships')?.entityID===12345?PROOF:null;
 const f=fence(c,{proof:verifier()});const result=f.reconcile({systemID:SYSTEM});assert.equal(result.status,'VERIFIED');assert.equal(c.get(ADMISSION+SYSTEM).state,'VERIFIED');const second=f.admit({systemID:SYSTEM,fleetCount:1,operationID:'another-operation-00001'});assert.match(second.reason,/PRIOR_STARTUP_REQUIRES_HANDOVER/);c.db.close();
}));
test('rollback on failed startup preflight never persists a permit',()=>inTemp(file=>{
 seed(file);const c=database(file),f=fence(c,{preflight:false});const r=f.admit({systemID:SYSTEM,fleetCount:1,operationID:'startup-child-000002'});assert.match(r.reason,/PREFLIGHT_NOT_PROVEN/);assert.equal(c.get(ADMISSION+SYSTEM),null);c.db.close();
}));