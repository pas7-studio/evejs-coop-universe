'use strict';
const {test}=require('node:test'),a=require('node:assert/strict');
const fs=require('node:fs'),path=require('node:path'),vm=require('node:vm');
const source=fs.readFileSync(path.join(__dirname,'../native/coopPersonalFleetOriginalCombatRecovery.js'),'utf8');
const T='corporationRuntime',F='coop-personal-fleet\u001f';
function fixture(action='ATTACK'){
 const now=1700000000000,shipID=2301,owner=500,system=30000142;
 const row={version:1,phase:'ACKED',action,operationID:'combat-op-1',
 signature:'a'.repeat(64),assignmentID:'assignment-1',
 ownerCharacterID:owner,pilotID:'coop-pilot-123456',shipItemID:shipID,
 systemID:system,actorGeneration:2,targetEntityID:3333,
 followRangeMeters:action==='DEFEND'?2500:null};
 const receipt={source:'EVEJS_ORIGINAL_NATIVE_COMBAT_EFFECT_V1',
 committedAtMs:now-3000};
 const db={
  [F+'manual-order-v1:'+shipID]:row,
  [F+'manual-order-operations-v1']:{version:1,operations:{
   [row.operationID]:{shipItemID:shipID,signature:row.signature,phase:'ACKED'}}},
  [F+'native-combat-order-receipt-v1:'+row.operationID]:receipt
 };
 let enabled=true,fenced=true,poisoned=false,targetLegal=true,
  originalProof=true,actorReal=true,resumeFail=false,resumeCalls=0,
  clock=now;
 const controller={entityID:shipID,systemID:system,personalFleetOriginal:true,
  personalFleetAssignmentID:row.assignmentID,
  personalFleetPilotID:row.pilotID,manualOrder:null};
 const ship={kind:'ship',itemID:shipID,nativeNpc:true,
  ownerID:owner,session:null,transient:false};
 const scene={systemID:system,getEntityByID:id=>id===shipID?ship:null};
 const modules={
  '../gameStore':{coopAtomicNativeRows:{mode:'SERVER_INTERNAL_FLAGGED',
   isPoisoned:()=>poisoned,transact:(tables,fn)=>{
    a.deepEqual([...tables],[T,'items','characters','npcEntities','npcRuntimeControllers']);
    return fn({get:(t,k)=>t===T?db[k]??null:null});
   }}},
  './coopPersonalFleetNativeOrders':{OP_INDEX:F+'manual-order-operations-v1',
   key:id=>F+'manual-order-v1:'+id,signature:()=>row.signature},
  './npc/npcRegistry':{getControllerByEntityID:()=>actorReal?controller:null},
  './runtime':{scenes:new Map([[system,scene]])}
 };
 const module={exports:{}};
 vm.runInNewContext(source,{module,require:id=>{
  if(!(id in modules))throw Error('PF96_NOT_NATIVE_IMPORT '+id);
  return modules[id];
 },Object,Number,Array,Set,Map,structuredClone},
 {filename:'PF96CombatRecovery.js'});
 const recovery=module.exports.createOriginalCombatRecovery({
  enabled:()=>enabled,allWritersFenced:()=>fenced,clock:()=>clock,
  combatAuthority:{verify:()=>targetLegal},
  combatReceipt:{verifyPersisted:()=>originalProof?{orderApplied:true}:null},
  orderWitness:{verifyNativeActor:()=>actorReal},
  resumeAfterOriginalAck:x=>{
   resumeCalls++;
   if(resumeFail)return {success:false,errorMsg:'UNKNOWN'};
   controller.manualOrder={type:x.action==='ATTACK'?'attack':'follow',
    targetID:x.targetEntityID,allowWeapons:x.action==='ATTACK',allowPodKill:false};
   return {success:true};
  }
 });
 return {recovery,row,db,controller,ship,receipt,
  getCalls:()=>resumeCalls,
  setTime:x=>clock=x,disable:()=>enabled=false,unfence:()=>fenced=false,
  poison:()=>poisoned=true,targetOff:()=>targetLegal=false,
  proofOff:()=>originalProof=false,actorOff:()=>actorReal=false,
  failEffect:()=>resumeFail=true};
}
test('PF96 restores acknowledged physical ATTACK once after native restart',()=>{
 const f=fixture(),x=f.recovery.recover();
 a.equal(x.restored,1);a.equal(f.getCalls(),1);
 a.equal(f.controller.manualOrder.type,'attack');
 a.equal(f.recovery.recover().already,1);
 a.equal(f.getCalls(),1);
});
test('PF96 original DEFEND resumes only a weapons-disabled owner-follow order',()=>{
 const f=fixture('DEFEND'),r=f.recovery.recover();
 a.equal(r.restored,1);
 a.equal(f.controller.manualOrder.allowWeapons,false);
 a.equal(f.controller.manualOrder.type,'follow');
});
test('PF96 cannot resurrect a stale ATTACK ten minutes after last source ACK',()=>{
 const f=fixture();f.setTime(1700000000000+600001);
 a.equal(f.recovery.recover().total,0);
 a.equal(f.getCalls(),0);
});
test('PF96 current stock PvE target legality may veto restart attack',()=>{
 const f=fixture();f.targetOff();
 a.equal(f.recovery.recover().total,0);a.equal(f.getCalls(),0);
});
test('PF96 false persisted receipt blocks a recovered native controller',()=>{
 const f=fixture();f.proofOff();
 a.equal(f.recovery.recover().status,'BLOCKED');
 a.equal(f.getCalls(),0);
});
test('PF96 wrong original operation index cannot reissue a previously saved order',()=>{
 const f=fixture();f.db[F+'manual-order-operations-v1'].operations[f.row.operationID].signature='b'.repeat(64);
 a.equal(f.recovery.recover().status,'BLOCKED');
 a.equal(f.getCalls(),0);
});
test('PF96 live foreign native manual order prevents accidental override',()=>{
 const f=fixture();
 f.controller.manualOrder={type:'attack',targetID:7788,allowWeapons:true};
 const x=f.recovery.recover();
 a.equal(x.blocked,1);a.equal(f.getCalls(),0);
});
test('PF96 failed native re-adoption gets a sticky process fence',()=>{
 const f=fixture();f.failEffect();
 a.equal(f.recovery.recover().blocked,1);
 a.equal(f.recovery.recover().blocked,1);
 a.equal(f.getCalls(),1);
});
test('PF96 original actor disappeared before restart is never respawned here',()=>{
 const f=fixture();f.actorOff();
 a.equal(f.recovery.recover().status,'BLOCKED');
 a.equal(f.getCalls(),0);
});
test('PF96 original writer revocation prevents all physical side effects',()=>{
 const f=fixture();f.unfence();
 a.equal(f.recovery.recover().status,'BLOCKED');
 a.equal(f.getCalls(),0);
});
test('PF96 read-only inspect never dispatches physical action',()=>{
 const f=fixture();
 a.equal(f.recovery.inspect().rows.length,1);
 a.equal(f.getCalls(),0);
 a.equal(f.controller.manualOrder,null);
});
