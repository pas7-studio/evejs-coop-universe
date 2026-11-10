'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const os=require('node:os'),fs=require('node:fs'),path=require('node:path');
const {DatabaseSync}=require('node:sqlite');
const {createPermitVerifier}=require('../../pf58/native/coopPersonalFleetOriginalNativePermit.cjs');
const T='corporationRuntime',S='coop-personal-fleet\u001f';
const entity={personalFleetOriginal:true,entityID:4101,systemID:30000142,ownerID:901,
 typeID:606,personalFleetGeneration:2,personalFleetAssignmentID:'assignment-pf65',
 personalFleetPilotID:'coop-pilot-123'};
const state=()=>({
  [S+'deploy-v1:'+entity.personalFleetAssignmentID]:{
    phase:'ISSUING',assignmentID:entity.personalFleetAssignmentID,
    shipItemID:entity.entityID,ownerCharacterID:entity.ownerID,
    systemID:entity.systemID,typeID:entity.typeID,pilotID:entity.personalFleetPilotID,
    generation:entity.personalFleetGeneration,dispatchCount:1,actorGeneration:4},
  [S+'handoff-v1:'+entity.personalFleetAssignmentID]:{
    status:'CONSUMED',version:1,assignmentID:entity.personalFleetAssignmentID,
    shipItemID:entity.entityID,ownerCharacterID:entity.ownerID,
    pilotID:entity.personalFleetPilotID,generation:entity.personalFleetGeneration,
    sourcePF54Hash:'opaque-original-hash'},
  [S+'handoff-ship-v1:'+entity.entityID]:{
    assignmentID:entity.personalFleetAssignmentID,sourcePF54Hash:'opaque-original-hash'},
  [S+'actor-claims-v1']:{version:1,claims:{},generations:{},processed:{}}
});
function openDb(filepath){
 const db=new DatabaseSync(filepath);db.exec('PRAGMA journal_mode=WAL;PRAGMA synchronous=FULL;');
 for(const t of [T,'items'])db.exec('CREATE TABLE IF NOT EXISTS "'+t+'" (key TEXT PRIMARY KEY,json TEXT NOT NULL)');
 const put=(t,k,v)=>db.prepare('INSERT INTO "'+t+'" (key,json) VALUES (?,?) ON CONFLICT(key) DO UPDATE SET json=excluded.json').run(k,JSON.stringify(v));
 const get=(t,k)=>{const r=db.prepare('SELECT json FROM "'+t+'" WHERE key=?').get(k);return r?JSON.parse(r.json):null};
 const seed=()=>{for(const [k,v] of Object.entries(state()))put(T,k,v);
  put('items','items',{[entity.entityID]:{itemID:entity.entityID,ownerID:entity.ownerID,
    typeID:entity.typeID,categoryID:6,flagID:0,locationID:entity.systemID,
    spaceState:{systemID:entity.systemID}}});};
 const gameStore={coopAtomicNativeRows:{mode:'SERVER_INTERNAL_FLAGGED',isPoisoned:()=>false,
  transact(tables,fn){assert.deepEqual(tables,[T,'items']);db.exec('BEGIN IMMEDIATE');
   try{const r=fn({get});db.exec('COMMIT');return r;}
   catch(e){db.exec('ROLLBACK');throw e;}}}};
 const verifier=createPermitVerifier({gameStore,enabled:()=>true,allWritersFenced:()=>true});
 return {db,seed,put,get,verifier,close:()=>db.close()};
}
function withDb(fn){const dir=fs.mkdtempSync(path.join(os.tmpdir(),'pf65-claims-'));
 try{return fn(path.join(dir,'original.sqlite'));}finally{fs.rmSync(dir,{recursive:true,force:true});}}
test('PF65 SQLite WAL/FULL persistent competing pilot claim denies ISSUING across process-shaped reopen',()=>withDb(file=>{
 let d=openDb(file);d.seed();
 assert.equal(d.verifier.verify({entityRecord:entity,allowIssuing:true}),true);
 const claims=d.get(T,S+'actor-claims-v1');claims.claims['4401']={entityID:4401,
  pilotID:entity.personalFleetPilotID,ownerCharacterID:entity.ownerID,systemID:entity.systemID,
  assignmentID:'competing-assignment',generation:1,ownerType:'PERSONAL_FLEET'};
 claims.generations['4401']=1;d.put(T,S+'actor-claims-v1',claims);d.close();
 d=openDb(file);try{assert.equal(d.verifier.verify({entityRecord:entity,allowIssuing:true}),false);}
 finally{d.close();}
}));
test('PF65 SQLite corrupt unrelated claim blocks restart without any DB mutation',()=>withDb(file=>{
 let d=openDb(file);d.seed();d.put(T,S+'actor-claims-v1',{version:1,claims:{x:{pilotID:'bad'}},generations:{},processed:{}});d.close();
 d=openDb(file);try{const before=d.get(T,S+'actor-claims-v1');
  assert.equal(d.verifier.verify({entityRecord:entity,allowIssuing:true}),false);
  assert.deepEqual(d.get(T,S+'actor-claims-v1'),before);
 }finally{d.close();}
}));
test('PF65 SQLite original ACTIVE claim exact identity permits reload across reopen',()=>withDb(file=>{
 let d=openDb(file);d.seed();const deploy=d.get(T,S+'deploy-v1:'+entity.personalFleetAssignmentID);
 d.put(T,S+'deploy-v1:'+entity.personalFleetAssignmentID,{...deploy,phase:'ACTIVE'});
 const claim={entityID:entity.entityID,pilotID:entity.personalFleetPilotID,
  ownerCharacterID:entity.ownerID,systemID:entity.systemID,
  assignmentID:entity.personalFleetAssignmentID,generation:4,ownerType:'PERSONAL_FLEET'};
 d.put(T,S+'actor-claims-v1',{version:1,claims:{[entity.entityID]:claim},
  generations:{[entity.entityID]:4},processed:{}});d.close();
 d=openDb(file);try{assert.equal(d.verifier.verify({entityRecord:entity}),true);}
 finally{d.close();}
}));
