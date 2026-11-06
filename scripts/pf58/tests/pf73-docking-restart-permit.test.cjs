'use strict';
/** PF73: test the actual PF58 GameStore verifier on real SQLite WAL/FULL.
 * No native engine boot, no server, and no physical ItemStore writer here.
 */
const test=require('node:test');
const assert=require('node:assert/strict');
const {DatabaseSync}=require('node:sqlite');
const fs=require('node:fs'),os=require('node:os'),path=require('node:path');
const crypto=require('node:crypto');
const {createPermitVerifier}=require('../native/coopPersonalFleetOriginalNativePermit.cjs');
const P='coop-personal-fleet\u001f';
const T='corporationRuntime';
const e={personalFleetOriginal:true,entityID:2001,systemID:30000142,
 ownerID:90000001,typeID:606,personalFleetGeneration:2,
 personalFleetAssignmentID:'pf73-assignment-1',personalFleetPilotID:'coop-pilot-123'};
const claim={entityID:e.entityID,ownerCharacterID:e.ownerID,systemID:e.systemID,
 pilotID:e.personalFleetPilotID,assignmentID:e.personalFleetAssignmentID,
 generation:3,ownerType:'PERSONAL_FLEET'};
const active={phase:'ACTIVE',assignmentID:e.personalFleetAssignmentID,
 shipItemID:e.entityID,ownerCharacterID:e.ownerID,pilotID:e.personalFleetPilotID,
 systemID:e.systemID,typeID:e.typeID,generation:e.personalFleetGeneration,actorGeneration:3};
const key=s=>P+s+':'+e.personalFleetAssignmentID;
function store(file){
 const db=new DatabaseSync(file);
 db.exec('PRAGMA journal_mode=WAL;PRAGMA synchronous=FULL;');
 for(const t of [T,'items'])db.exec('CREATE TABLE IF NOT EXISTS "'+t+'" (key TEXT PRIMARY KEY, json TEXT NOT NULL)');
 const get=(table,k)=>{const v=db.prepare('SELECT json FROM "'+table+'" WHERE key=?').get(k);return v?JSON.parse(v.json):null;};
 const put=(table,k,val)=>db.prepare('INSERT INTO "'+table+'"(key,json) VALUES(?,?) ON CONFLICT(key) DO UPDATE SET json=excluded.json').run(k,JSON.stringify(val));
 const gameStore={coopAtomicNativeRows:{mode:'SERVER_INTERNAL_FLAGGED',isPoisoned:()=>false,
  transact(tables,fn){assert.deepEqual(tables,[T,'items']);db.exec('BEGIN IMMEDIATE');
    try{const r=fn({get,put});db.exec('COMMIT');return r;}
    catch(err){db.exec('ROLLBACK');throw err;}}}};
 return {db,get,put,gameStore,verifier:createPermitVerifier({gameStore,enabled:()=>true,allWritersFenced:()=>true})};
}
function seed(s){
 s.put(T,key('deploy-v1'),active);
 s.put(T,key('handoff-v1'),{version:1,status:'CONSUMED',assignmentID:e.personalFleetAssignmentID,
 shipItemID:e.entityID,ownerCharacterID:e.ownerID,pilotID:e.personalFleetPilotID,
 generation:e.personalFleetGeneration,sourcePF54Hash:'signed-original'});
 s.put(T,P+'handoff-ship-v1:'+e.entityID,{assignmentID:e.personalFleetAssignmentID,sourcePF54Hash:'signed-original'});
 s.put(T,P+'actor-claims-v1',{version:1,claims:{[e.entityID]:claim},generations:{[e.entityID]:3},processed:{}});
 s.put('items','items',{[e.entityID]:{itemID:e.entityID,ownerID:e.ownerID,
  typeID:e.typeID,categoryID:6,flagID:0,locationID:e.systemID,
  spaceState:{systemID:e.systemID}}});
}
const returnRow=(phase,extra={})=>{
 const row={version:1,phase,operationID:'pf73-return-operation-1',
  assignmentID:e.personalFleetAssignmentID,shipItemID:e.entityID,
  ownerCharacterID:e.ownerID,pilotID:e.personalFleetPilotID,
  systemID:e.systemID,typeID:e.typeID,
  reservationGeneration:e.personalFleetGeneration,
  actorGeneration:3,stationID:600001,
  dockDispatchCount:phase==='DOCK_ISSUING'||phase==='DOCKED'?1:0};
 row.signature=crypto.createHash('sha256').update(JSON.stringify([
  'PF56_RETURN',row.operationID,row.assignmentID,row.ownerCharacterID,
  row.pilotID,row.shipItemID,row.stationID,row.systemID,
  row.reservationGeneration,row.actorGeneration])).digest('hex');
 return {...row,...extra};
};
function withDb(run){const dir=fs.mkdtempSync(path.join(os.tmpdir(),'pf73-original-'));
 const file=path.join(dir,'native.sqlite');let s=store(file);
 try{seed(s);return run(s,()=>{s.db.close();s=store(file);return s;});}
 finally{try{s.db.close()}catch{}fs.rmSync(dir,{recursive:true,force:true});}}
const allowed=s=>s.verifier.verify({entityRecord:e});
const block=(state,reason,extra={})=>test(reason,()=>withDb(s=>{
  s.put(T,key('return-dock-v1'),returnRow(state,extra));
  assert.equal(allowed(s),false,'must deny while real stock ItemStore hull remains in SPACE');
}));
test('clean ACTIVE original deployment admits restart',()=>withDb(s=>assert.equal(allowed(s),true)));
test('early return intents may restore their ship only with unchanged identity',()=>withDb(s=>{
 for(const phase of ['RETURN_ISSUING','RETURNING','ARRIVAL_OBSERVED']){
  s.put(T,key('return-dock-v1'),returnRow(phase));assert.equal(allowed(s),true,phase);
 }
}));
block('DOCK_ISSUING','DOCK_ISSUING blocks materialization before ItemStore dock');
block('DOCKED','DOCKED cannot resurrect old native controller');
block('UNKNOWN','unknown return state refuses');
block('RETURNING','foreign assignment blocks', {assignmentID:'other-assignment'});
block('RETURNING','other ship identity blocks', {shipItemID:3002});
block('RETURNING','wrong pilot blocks', {pilotID:'coop-pilot-999'});
block('RETURNING','old reservation generation blocks', {reservationGeneration:1});
block('RETURNING','wrong actor generation blocks', {actorGeneration:4});
block('RETURNING','partial dockDispatchCount blocks', {dockDispatchCount:1});
block('RETURNING','malformed station blocks', {stationID:0});
block('RETURNING','changed hull type blocks', {typeID:607});
block('RETURNING','forged signature blocks', {signature:'0'.repeat(64)});
block('RETURNING','foreign operation ID blocks', {operationID:'foreign-operation'});
block('RETURNING','numeric operation ID blocks', {operationID:123});
block('RETURNING','changed owner blocks', {ownerCharacterID:99});
test('original PF66 first dock attempt blocks even without return row',()=>withDb(s=>{
 s.put(T,key('dock-native-attempt-v1'),{version:1,status:'CONSUMED'});
 assert.equal(allowed(s),false);
}));
test('PF67 scene detach attempt blocks even if only that durable token remains',()=>withDb(s=>{
 s.put(T,key('dock-scene-attempt-v1'),{version:1,status:'CONSUMED'});
 assert.equal(allowed(s),false);
}));
test('PF60 PREPARED terminal blocks before native cleanup',()=>withDb(s=>{
 s.put(T,key('terminal-v1'),{phase:'PREPARED'});
 assert.equal(allowed(s),false);
}));
test('unknown durable token must never count as clean',()=>withDb(s=>{
 s.put(T,key('terminal-v1'),{corrupt:true});assert.equal(allowed(s),false);
}));
test('SQLite WAL/FULL restart preserves DOCK_ISSUING denial',()=>{
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'pf73-restart-'));const file=path.join(dir,'game.sqlite');
 let s=store(file);try{
  seed(s);assert.equal(allowed(s),true);
  s.put(T,key('return-dock-v1'),returnRow('DOCK_ISSUING'));
  s.db.close();s=store(file);assert.equal(allowed(s),false);
  assert.equal(s.get('items','items')[e.entityID].flagID,0,'original ItemStore not yet docked');
 }finally{try{s.db.close()}catch{}fs.rmSync(dir,{recursive:true,force:true});}
});
test('ISSUING allows only explicit PF58 one-shot handoff before any return intent',()=>withDb(s=>{
 s.put(T,key('deploy-v1'),{...active,phase:'ISSUING',dispatchCount:1});
 s.put(T,P+'actor-claims-v1',{version:1,claims:{},generations:{},processed:{}});
 assert.equal(s.verifier.verify({entityRecord:e}),false);
 assert.equal(s.verifier.verify({entityRecord:e,allowIssuing:true}),true);
 s.put(T,key('return-dock-v1'),returnRow('RETURNING'));
 assert.equal(s.verifier.verify({entityRecord:e,allowIssuing:true}),false);
}));
test('no writes occur during native resume authorization',()=>withDb(s=>{
 const before=JSON.stringify([s.get(T,key('deploy-v1')),s.get(T,key('return-dock-v1')),s.get('items','items')]);
 assert.equal(allowed(s),true);
 const after=JSON.stringify([s.get(T,key('deploy-v1')),s.get(T,key('return-dock-v1')),s.get('items','items')]);
 assert.equal(after,before);
}));
test('real SIGKILL immediately after SQLite DOCK_ISSUING commit cannot resurrect ship',
 {skip:process.platform!=='linux'},async()=>{
 const {spawn}=require('node:child_process');
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'pf73-sigkill-')),
   file=path.join(dir,'game.sqlite');
 let parent=store(file);
 try{
  seed(parent);assert.equal(allowed(parent),true);
  parent.db.close();
  const js=`const {DatabaseSync}=require('node:sqlite');
   const db=new DatabaseSync(process.argv[1]);
   db.exec('PRAGMA journal_mode=WAL;PRAGMA synchronous=FULL;BEGIN IMMEDIATE;');
   const row=JSON.parse(process.argv[3]);
   db.prepare('INSERT INTO corporationRuntime(key,json) VALUES(?,?) ON CONFLICT(key) DO UPDATE SET json=excluded.json').run(process.argv[2],JSON.stringify(row));
   db.exec('COMMIT');
   process.stdout.write('PF73_DOCK_INTENT_COMMITTED\\n');
   setInterval(()=>{},1000);`;
  const child=spawn(process.execPath,['-e',js,file,key('return-dock-v1'),
    JSON.stringify(returnRow('DOCK_ISSUING'))],{stdio:['ignore','pipe','pipe']});
  let stdout='',stderr='';
  child.stderr.on('data',v=>{stderr+=v.toString();});
  const result=await new Promise((resolve,reject)=>{
   let signaled=false;
   child.stdout.on('data',chunk=>{
    stdout+=chunk.toString();
    if(!signaled&&stdout.includes('PF73_DOCK_INTENT_COMMITTED')){
     signaled=true;child.kill('SIGKILL');
    }
   });
   child.once('error',reject);
   child.once('close',(code,signal)=>resolve({code,signal,signaled}));
  });
  assert.equal(result.signaled,true,stderr);
  assert.equal(result.signal,'SIGKILL');
  parent=store(file);
  assert.equal(parent.get(T,key('return-dock-v1')).phase,'DOCK_ISSUING');
  assert.equal(parent.get('items','items')[e.entityID].flagID,0);
  assert.equal(allowed(parent),false,'restart must not restore original NPC ship');
 }finally{try{parent.db.close()}catch{}fs.rmSync(dir,{recursive:true,force:true});}
});
