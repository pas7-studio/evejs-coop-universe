'use strict';
/**
 * PF87 actual Node 22 SQLite/GameStore WORK contract smoke.
 * Run with PF87_NATIVE_WORKTREE=<isolated WORK native root> ONLY.
 * This test READS the staged original source, executes it inside a hermetic
 * VM against a private temporary SQLite file, and NEVER imports a live server.
 */
const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const os=require('node:os');
const path=require('node:path');
const vm=require('node:vm');
const {execFileSync}=require('node:child_process');
const {DatabaseSync}=require('node:sqlite');

const SEP='\u001f',T='corporationRuntime',NE='npcEntities',SCOPE=[T,'items','characters',NE];
const work=process.env.PF87_NATIVE_WORKTREE;
if(!work||!path.isAbsolute(work))
 throw Error('PF87_REQUIRES_ABSOLUTE_ISOLATED_NATIVE_WORKTREE');
const root=fs.realpathSync(work);
if(root.split(path.sep).some(part=>['play','prod','production'].includes(part.toLowerCase())))
 throw Error('PF87_PLAY_OR_PRODUCTION_PATH_FORBIDDEN');
if(!fs.statSync(path.join(root,'.git')).isFile())
 throw Error('PF87_LINKED_WORK_GIT_FILE_REQUIRED');
const branch=execFileSync('git',['-C',root,'branch','--show-current'],
 {encoding:'utf8'}).trim();
if(!branch.startsWith('work/'))throw Error('PF87_WORK_BRANCH_REQUIRED');
const folder=path.join(root,'Code/server/src/space');
const sourceFile=path.join(folder,'coopGameStoreAtomic.js');
const isolateFile=path.join(folder,'coopPersonalFleetNativeEntityIsolation.js');
const originalSource=fs.readFileSync(sourceFile,'utf8');
if(originalSource.split('PF87_ORIGINAL_NPC_ROW_SHAPE_UNAVAILABLE').length!==2)
 throw Error('PF87_PATCHED_ORIGINAL_ATOMIC_SOURCE_REQUIRED');
if(!fs.existsSync(isolateFile))throw Error('PF87_ISOLATION_MODULE_NOT_STAGED');
const flags=Object.freeze({EVEJS_COOP_PERSONAL_FLEET_NATIVE:'1',
 EVEJS_COOP_PERSONAL_FLEET_ENTITY_ISOLATION:'1',EVEJS_COOP_NATIVE_ATOMIC_ROWS:'1'});
// A separate module object rather than requiring the original entrypoint:
// startup, chat, NPC AI, network, Docker and all source-owned services stay OFF.
const moduleContext={exports:{}};
vm.runInNewContext(originalSource,{
 module:moduleContext,exports:moduleContext.exports,
 require:id=>{
  if(id==='./coopPersonalFleetNativeEntityIsolation')return require(isolateFile);
  if(id==='./coopNativeCargoTransientIsolation')return {contractForTables:()=>null};
  throw Error('PF87_UNEXPECTED_ORIGINAL_IMPORT:'+id);
 },process:{env:{...flags}},console,
},{filename:sourceFile,timeout:10000});
const native=moduleContext.exports;
if(typeof native.createSqliteAdapter!=='function'||
 typeof native.createGameStoreAdapter!=='function')
 throw Error('PF87_ORIGINAL_ATOMIC_EXPORTS_MISSING');
const clone=x=>x===undefined?undefined:structuredClone(x);
const ship=()=>({entityID:2301,ownerID:500,systemID:30000142,typeID:606,
 personalFleetOriginal:true,personalFleetAssignmentID:'assignment-123',
 personalFleetPilotID:'coop-pilot-123',personalFleetGeneration:1,
 mode:'STOP',targetEntityID:0,followRange:0,
 position:{x:1,y:2,z:3},velocity:{x:0,y:0,z:0},
 direction:{x:1,y:0,z:0},targetPoint:{x:1,y:2,z:3},speedFraction:0});
const orderReceipt=()=>({version:1,source:'EVEJS_ORIGINAL_NATIVE_ORDER_COMMITTED_V1',
 operationID:'op-123',signature:'a'.repeat(64),assignmentID:'assignment-123',
 ownerCharacterID:500,pilotID:'coop-pilot-123',shipItemID:2301,
 systemID:30000142,committedAtMs:12345});
const options=mode=>({contract:'personal-fleet-entity-receipt-v1',
 shipItemID:2301,operationID:'op-123',assignmentID:'assignment-123',mode});
const EK='entities'+SEP+'2301',RECEIPT='coop-personal-fleet'+SEP+'native-order-receipt-v1:op-123';
function fixture(t,{failBaseline=false}={}){
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'pf87-original-'));
 const file=path.join(dir,'private-work-test.sqlite');
 let db=new DatabaseSync(file);
 db.exec('PRAGMA journal_mode=WAL;PRAGMA synchronous=FULL');
 for(const table of SCOPE)
  db.exec('CREATE TABLE IF NOT EXISTS "'+table+'" (key TEXT PRIMARY KEY,json TEXT NOT NULL)');
 const read=(table,key)=>{
  const row=db.prepare('SELECT json FROM "'+table+'" WHERE key=?').get(key);
  return row?JSON.parse(row.json):null;
 };
 const write=(table,key,value)=>db.prepare('INSERT INTO "'+table+
  '"(key,json) VALUES(?,?) ON CONFLICT(key) DO UPDATE SET json=excluded.json')
  .run(key,JSON.stringify(value));
 write(NE,'entities',{});write(NE,EK,ship());
 write('items','items',{});
 const snapshot=table=>{
  const out={};
  for(const {key,json} of db.prepare('SELECT key,json FROM "'+table+'"').all()){
   const parsed=JSON.parse(json);
   if(table===NE&&key.startsWith('entities'+SEP)){
    (out.entities??={})[key.slice(('entities'+SEP).length)]=parsed;
   }else if(table===NE&&key==='entities'){
    out.entities??={};
   }else out[key]=parsed;
  }
  return out;
 };
 const cache=Object.fromEntries(SCOPE.map(table=>[table,snapshot(table)]));
 // A SECOND in-memory-only native NPC exists, while the target is durable.
 cache[NE].entities['2302']={...ship(),entityID:2302,transient:true,
  personalFleetAssignmentID:'other-assignment'};
 const baseline=[],fatal=[];
 const sqliteStore={
  coopAtomicNativeRows:native.createSqliteAdapter(()=>db),
  loadTableObject:snapshot,
  rowGroupsFor:table=>table===NE?['entities']:[],
  applyRowToObject:(table,current,key,value)=>{
   if(table===NE&&key.startsWith('entities'+SEP)){
    const id=key.slice(('entities'+SEP).length);
    if(value===undefined)delete current.entities[id];
    else current.entities[id]=clone(value);
   }else if(value===undefined)delete current[key];
   else current[key]=clone(value);
  }
 };
 const atomic=native.createGameStoreAdapter({sqliteStore,
  ensureSqliteReady:()=>true,ensureCached:()=>true,
  flushTableSync:()=>({success:true}),cache,dirty:new Set(),
  flushTimers:{},inFlightFlushes:new Map(),
  transientPaths:{[NE]:new Set(['/entities/2302'])},
  dirtyRowKeys:{},fullDirty:new Set(),
  rebuildFlushBaselineFromDisk:()=>true,
  advanceFlushBaseline:(...args)=>{
   baseline.push(args);
   if(failBaseline)throw Error('PF87_TEST_POSTCOMMIT_BASELINE_FAILURE');
  },
  invalidateNativeItems:()=>true,invalidateNativeAccounts:()=>true,
  fatal:error=>fatal.push(error.message)
 });
 const close=()=>{
  if(db){db.close();db=null;}
 };
 t.after(()=>{close();fs.rmSync(dir,{recursive:true,force:true})});
 return {atomic,cache,baseline,fatal,read,write,snapshot,
  reopen(){close();db=new DatabaseSync(file);return db;}};
}
test('PF87 original patched adapter + real SQLite commits one NPC and receipt',t=>{
 const f=fixture(t);
 const output=f.atomic.transact(SCOPE,tx=>{
  const next=tx.get(NE,EK);next.mode='FOLLOW';
  next.targetEntityID=3331;next.followRange=3000;
  tx.put(NE,EK,next);tx.put(T,RECEIPT,orderReceipt());
  return 'APPLIED';
 },options('ORDER'));
 assert.equal(output,'APPLIED');
 assert.equal(f.read(NE,EK).mode,'FOLLOW');
 assert.equal(f.read(T,RECEIPT).shipItemID,2301);
 assert.equal(f.cache[NE].entities['2302'].transient,true);
 assert.equal(f.read(NE,'entities'+SEP+'2302'),null);
 assert.ok(f.baseline.length>0);
 assert.deepEqual(f.fatal,[]);
 f.reopen();
 assert.equal(f.read(NE,EK).mode,'FOLLOW');
 assert.equal(f.read(T,RECEIPT).source,'EVEJS_ORIGINAL_NATIVE_ORDER_COMMITTED_V1');
 assert.equal(f.read(NE,'entities'+SEP+'2302'),null);
});
test('PF87 original SQLite cannot commit a receipt without its entity write',t=>{
 const f=fixture(t);
 assert.throws(()=>f.atomic.transact(SCOPE,tx=>
  tx.put(T,RECEIPT,orderReceipt()),options('ORDER')),/HALF_NATIVE_RECEIPT/);
 assert.equal(f.read(T,RECEIPT),null);
 assert.equal(f.atomic.isPoisoned(),false);
});
test('PF87 original SQLite cannot commit a foreign physical NPC',t=>{
 const f=fixture(t);
 assert.throws(()=>f.atomic.transact(SCOPE,tx=>
  tx.put(NE,'entities'+SEP+'2302',{...ship(),entityID:2302}),
  options('ORDER')),/FOREIGN_NATIVE_ENTITY_WRITE/);
 assert.equal(f.read(NE,'entities'+SEP+'2302'),null);
});
test('PF87 original SQLite rolls back an interrupted two-row receipt',t=>{
 const f=fixture(t);
 assert.throws(()=>f.atomic.transact(SCOPE,tx=>{
  tx.put(NE,EK,{...tx.get(NE,EK),mode:'FOLLOW'});
  throw Error('SIMULATED_PROCESS_EFFECT_INTERRUPTED_BEFORE_COMMIT');
 },options('ORDER')),/SIMULATED_PROCESS_EFFECT_INTERRUPTED/);
 f.reopen();
 assert.equal(f.read(NE,EK).mode,'STOP');
 assert.equal(f.read(T,RECEIPT),null);
});
test('PF87 original GameStore preserves default deny for unsanctioned transactions',t=>{
 const f=fixture(t);
 assert.throws(()=>f.atomic.transact(SCOPE,()=>true),/NATIVE_TRANSIENT_STATE_UNSAFE/);
 assert.equal(f.atomic.isPoisoned(),false);
});
test('PF87 original GameStore rejects transient preimage drift',t=>{
 const f=fixture(t);f.cache[NE].entities['2302'].transient=false;
 assert.throws(()=>f.atomic.transact(SCOPE,()=>true,options('ORDER')),
  /TRANSIENT_ENTITY_NOT_ISOLATED/);
});
test('PF87 original SQLite reconciles exact PF55 ledger and index atomically',t=>{
 const f=fixture(t);
 const key='coop-personal-fleet'+SEP+'manual-order-v1:2301';
 const ix='coop-personal-fleet'+SEP+'manual-order-operations-v1';
 f.write(T,key,{phase:'ISSUING',operationID:'op-123',
  assignmentID:'assignment-123',shipItemID:2301});
 f.write(T,ix,{version:1,operations:{'op-123':{phase:'ISSUING',shipItemID:2301}}});
 f.cache[T]=f.snapshot(T);
 f.atomic.transact(SCOPE,tx=>{
  tx.put(T,key,{...tx.get(T,key),phase:'ACKED',
   proofHash:'b'.repeat(64),ackedAtMs:12345});
  const index=tx.get(T,ix);index.operations['op-123'].phase='ACKED';tx.put(T,ix,index);
 },options('RECONCILE'));
 assert.equal(f.read(T,key).phase,'ACKED');
 assert.equal(f.read(T,ix).operations['op-123'].phase,'ACKED');
 assert.equal(f.read(NE,'entities'+SEP+'2302'),null);
});
test('PF87 original SQLite confirms PF56 durable RETURN without touching NPCs',t=>{
 const f=fixture(t);
 const key='coop-personal-fleet'+SEP+'return-dock-v1:assignment-123';
 f.write(T,key,{phase:'RETURN_ISSUING',operationID:'op-123',
  assignmentID:'assignment-123',shipItemID:2301,ownerCharacterID:500});
 f.cache[T]=f.snapshot(T);
 f.atomic.transact(SCOPE,tx=>
  tx.put(T,key,{...tx.get(T,key),phase:'RETURNING',
   returnProofHash:'b'.repeat(64)}),options('CONFIRM'));
 assert.equal(f.read(T,key).phase,'RETURNING');
 assert.equal(f.read(NE,EK).mode,'STOP');
});
test('PF87 original GameStore poisons after an unknown post-commit cache result',t=>{
 const f=fixture(t,{failBaseline:true});
 assert.throws(()=>f.atomic.transact(SCOPE,tx=>{
  tx.put(NE,EK,{...tx.get(NE,EK),mode:'FOLLOW'});
  tx.put(T,RECEIPT,orderReceipt());
 },options('ORDER')),/NATIVE_GAMESTORE_COMMITTED_BUT_CACHE_UNSAFE/);
 assert.equal(f.atomic.isPoisoned(),true);
 assert.ok(f.fatal.length>0);
 assert.equal(f.read(T,RECEIPT).shipItemID,2301);
 assert.throws(()=>f.atomic.transact(SCOPE,()=>true,options('ORDER')),/POISONED/);
});
