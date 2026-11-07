'use strict';
const {test}=require('node:test'),assert=require('node:assert/strict');
const fs=require('node:fs'),path=require('node:path'),vm=require('node:vm');
const crypto=require('node:crypto');
const source=fs.readFileSync(path.join(__dirname,'../native/coopPersonalFleetOriginalCombatReceipt.js'),'utf8');
const T='corporationRuntime',NE='npcEntities',NC='npcRuntimeControllers',CH='characters',IT='items',
 F='coop-personal-fleet\u001f';
function fixture(callback,{action='ATTACK'}={}){
 const row={version:1,phase:'ISSUING',operationID:'attack-op-1',
  signature:'a'.repeat(64),assignmentID:'assignment-1',
  ownerCharacterID:500,pilotID:'coop-pilot-123456',
  shipItemID:2301,systemID:30000142,actorGeneration:2,
  action,targetEntityID:action==='ATTACK'?3333:3003,
  followRangeMeters:action==='ATTACK'?null:2500};
 const nativeCtrl={entityID:2301,personalFleetOriginal:true,
  personalFleetAssignmentID:row.assignmentID,personalFleetPilotID:row.pilotID,
  systemID:row.systemID};
 const originalEntity={entityID:2301,ownerID:500,systemID:row.systemID,
  personalFleetOriginal:true,personalFleetAssignmentID:row.assignmentID,
  personalFleetPilotID:row.pilotID,mode:'STOP',position:{x:0,y:0,z:0}};
 const manual={type:action==='ATTACK'?'attack':'follow',
  targetID:row.targetEntityID,allowWeapons:action==='ATTACK',
  allowPodKill:false,followRangeMeters:action==='ATTACK'?0:2500};
 const liveCtrl={...nativeCtrl,runtimeKind:'nativeCombat',manualOrder:manual,
  currentTargetID:row.targetEntityID,preferredTargetID:row.targetEntityID};
 const ship={kind:'ship',itemID:2301,nativeNpc:true,ownerID:500,
  mode:action==='ATTACK'?'STOP':'FOLLOW',targetEntityID:row.targetEntityID,
  followRange:2500,position:{x:0,y:0,z:0}};
 const scene={systemID:row.systemID,getEntityByID:id=>id===2301?ship:null};
 const db={
  [T]:{
   [F+'manual-order-v1:2301']:row,
   [F+'manual-order-operations-v1']:{operations:{
    [row.operationID]:{signature:row.signature,phase:'ISSUING'}}}},
  [NE]:{'entities\u001f2301':originalEntity},
  [NC]:{'controllers\u001f2301':nativeCtrl},
  [CH]:{'500':{characterID:500,accountId:77}},
  [IT]:{items:{'2301':{itemID:2301,ownerID:500}}}
 };
 let enabled=true,fenced=true,poison=false,actor=true,target=true,
  unsafe=false,commitUnknown=false;
 const atomic={mode:'SERVER_INTERNAL_FLAGGED',isPoisoned:()=>poison,
  transact:(tables,fn)=>{
   assert.deepEqual(Array.from(tables),[T,NE,NC,CH,IT]);
   const backup=JSON.stringify(db);
   try{
    const result=fn({get:(table,key)=>db[table]?.[key]??null,
     put:(table,key,value)=>{db[table][key]=value;}});
    if(commitUnknown)throw Error('UNKNOWN_COMMIT');
    return result;
   }catch(e){
    const snapshot=JSON.parse(backup);
    for(const name of Object.keys(db))db[name]=snapshot[name];
    throw e;
   }
  }};
 const modules={
  'node:crypto':crypto,
  '../gameStore':{coopAtomicNativeRows:atomic},
  './runtime':{scenes:new Map([[row.systemID,scene]])},
  './npc/npcRegistry':{getControllerByEntityID:()=>liveCtrl},
  './npc/nativeNpcStore':{getNativeEntity:()=>originalEntity,
    getNativeController:()=>nativeCtrl},
  './coopPersonalFleetNativeOrders':{key:id=>F+'manual-order-v1:'+id,
   signature:r=>r.signature}
 };
 const m={exports:{}};
 vm.runInNewContext(source,{require:n=>{
  if(!(n in modules))throw Error('UNEXPECTED_IMPORT '+n);
  return modules[n];
 },module:m,exports:m.exports,Object,Array,Number,Date,Set},
 {filename:'coopPersonalFleetOriginalCombatReceipt.js'});
 const receipt=m.exports.createOriginalCombatReceipt({
  combatAuthority:{verify:()=>target},orderWitness:{verifyNativeActor:()=>actor},
  enabled:()=>enabled,allWritersFenced:()=>fenced,clock:()=>1700000000000});
 const env={row,receipt,db,ship,liveCtrl,nativeCtrl,originalEntity,
  close:()=>{},disable:()=>enabled=false,unfence:()=>fenced=false,
  poison:()=>poison=true,actorOff:()=>actor=false,targetOff:()=>target=false,
  unknown:()=>commitUnknown=true};
 callback(env);
}
test('PF95 ATTACK persists original npc controller and PF55 receipt together',()=>fixture(f=>{
 const r=f.receipt.recordAfterEffect(f.row);
 assert.equal(r.success,true,r.errorMsg);
 const stored=f.db[NC]['controllers\u001f2301'];
 assert.equal(stored.manualOrder.type,'attack');
 assert.equal(stored.manualOrder.targetID,3333);
 assert.equal(stored.manualOrder.allowWeapons,true);
 assert.equal(stored.manualOrder.allowPodKill,false);
 const receipt=f.db[T][F+'native-combat-order-receipt-v1:'+f.row.operationID];
 assert.equal(receipt.effectHash,stored.personalFleetCombatReceipt.effectHash);
 assert.equal(f.receipt.verifyPersisted(f.row,{get:(t,k)=>f.db[t]?.[k]??null})?.orderApplied,true);
}));
test('PF95 DEFEND persists physical follow with weapons disabled',()=>fixture(f=>{
 const r=f.receipt.recordAfterEffect(f.row);
 assert.equal(r.success,true,r.errorMsg);
 const saved=f.db[NE]['entities\u001f2301'];
 assert.equal(saved.mode,'FOLLOW');assert.equal(saved.targetEntityID,3003);
 assert.equal(saved.followRange,2500);
 assert.equal(f.db[NC]['controllers\u001f2301'].manualOrder.allowWeapons,false);
},{action:'DEFEND'}));
test('PF95 fake live native attack without manual stock effect cannot produce ACK',()=>fixture(f=>{
 f.liveCtrl.manualOrder=null;
 assert.equal(f.receipt.recordAfterEffect(f.row).success,false);
 assert.equal(f.db[T][F+'native-combat-order-receipt-v1:'+f.row.operationID],undefined);
}));
test('PF95 target revoked between ISSUE and original effect refuses receipt',()=>fixture(f=>{
 f.targetOff();
 assert.equal(f.receipt.recordAfterEffect(f.row).success,false);
}));
test('PF95 no verified original actor ownership refuses receipt',()=>fixture(f=>{
 f.actorOff();assert.equal(f.receipt.recordAfterEffect(f.row).success,false);
}));
test('PF95 native SQLite unknown commit is fenced and cannot mint receipt',()=>fixture(f=>{
 f.unknown();
 const r=f.receipt.recordAfterEffect(f.row);
 assert.match(r.errorMsg,/UNKNOWN_NO_RETRY/);
 assert.equal(f.db[NC]['controllers\u001f2301'].manualOrder,undefined);
}));
test('PF95 post-commit receipt cannot be replayed twice',()=>fixture(f=>{
 assert.equal(f.receipt.recordAfterEffect(f.row).success,true);
 assert.equal(f.receipt.recordAfterEffect(f.row).success,false);
}));
test('PF95 tampered controller target invalidates original persisted command',()=>fixture(f=>{
 assert.equal(f.receipt.recordAfterEffect(f.row).success,true);
 f.db[NC]['controllers\u001f2301'].manualOrder.targetID=7777;
 assert.equal(f.receipt.verifyPersisted(f.row,{get:(t,k)=>f.db[t]?.[k]??null}),null);
}));
test('PF95 original writer fence OFF never produces a combat receipt',()=>fixture(f=>{
 f.unfence();assert.equal(f.receipt.recordAfterEffect(f.row).success,false);
}));
test('PF95 only real ATTACK and DEFEND action can be native combat',()=>fixture(f=>{
 const wrong={...f.row,action:'WARP'};
 assert.equal(f.receipt.recordAfterEffect(wrong).success,false);
}));
