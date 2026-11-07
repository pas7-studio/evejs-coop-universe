'use strict';
/**
 * PF95 original combat post-native-effect receipt.
 * Writes actual original controller row, physical scene mode, and PF55
 * durable ACK in ONE GameStore transaction. Only a witnessed stock effect
 * can be accepted; ambiguous commit is never redispatched.
 */
const {createHash}=require('node:crypto');
const gameStore=require('../gameStore');
const runtime=require('./runtime');
const registry=require('./npc/npcRegistry');
const nativeStore=require('./npc/nativeNpcStore');
const pf55=require('./coopPersonalFleetNativeOrders');
const T='corporationRuntime',NE='npcEntities',NC='npcRuntimeControllers',CH='characters',ITEMS='items',
 F='coop-personal-fleet\u001f',ACK=F+'native-combat-order-receipt-v1:';
const pos=x=>Number.isSafeInteger(x)&&x>0;
const obj=x=>x!==null&&typeof x==='object'&&!Array.isArray(x);
const hex=x=>typeof x==='string'&&/^[a-f0-9]{64}$/.test(x);
const token=x=>typeof x==='string'&&/^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/.test(x);
const sha=x=>createHash('sha256').update(JSON.stringify(x)).digest('hex');
const bad=reason=>({success:false,errorMsg:reason});
function matches(row){
 return obj(row)&&row.version===1&&['ISSUING','ACKED'].includes(row.phase)&&
  ['ATTACK','DEFEND'].includes(row.action)&&
  token(row.operationID)&&token(row.assignmentID)&&
  /^coop-pilot-[0-9]{3,}$/.test(row.pilotID)&&
  [row.ownerCharacterID,row.shipItemID,row.systemID,row.actorGeneration,row.targetEntityID].every(pos)&&
  row.targetEntityID!==row.shipItemID&&hex(row.signature)&&
  row.signature===pf55.signature(row)&&
  (row.action==='DEFEND'?
   Number.isSafeInteger(row.followRangeMeters)&&row.followRangeMeters>=500&&row.followRangeMeters<=100000:
   row.followRangeMeters===null);
}
const signature=(row,mode,manual)=>sha(['PF95_ORIGINAL_COMBAT_EFFECT_V1',
 row.operationID,row.signature,row.shipItemID,row.targetEntityID,
 row.action,mode,manual.type,manual.targetID,
 manual.allowWeapons,manual.allowPodKill??false,
 row.action==='DEFEND'?row.followRangeMeters:0]);
function createOriginalCombatReceipt({combatAuthority,orderWitness,
 enabled=()=>false,allWritersFenced=()=>false,clock=()=>Date.now()}={}){
 const atomic=gameStore?.coopAtomicNativeRows;
 if(atomic?.mode!=='SERVER_INTERNAL_FLAGGED'||
  typeof atomic.transact!=='function'||typeof atomic.isPoisoned!=='function'||
  typeof runtime.scenes?.get!=='function'||
  typeof registry.getControllerByEntityID!=='function'||
  typeof nativeStore.getNativeEntity!=='function'||
  typeof nativeStore.getNativeController!=='function'||
  typeof pf55.key!=='function'||typeof pf55.signature!=='function'||
  typeof combatAuthority?.verify!=='function'||
  typeof orderWitness?.verifyNativeActor!=='function'||
  [enabled,allWritersFenced,clock].some(f=>typeof f!=='function'))
   throw Error('PF95_ORIGINAL_COMBAT_RECEIPT_SOURCES_REQUIRED');
 const on=()=>enabled()===true&&allWritersFenced()===true&&atomic.isPoisoned()===false;
 function observe(row){
  const scene=runtime.scenes.get(row.systemID),
   ship=scene?.getEntityByID?.(row.shipItemID),
   controller=registry.getControllerByEntityID(row.shipItemID);
  if(scene?.systemID!==row.systemID||ship?.itemID!==row.shipItemID||
     ship.kind!=='ship'||ship.nativeNpc!==true||ship.session!=null||
     ship.ownerID!==row.ownerCharacterID||
     controller?.entityID!==row.shipItemID||controller.systemID!==row.systemID||
     controller.personalFleetOriginal!==true||
     controller.personalFleetAssignmentID!==row.assignmentID||
     controller.personalFleetPilotID!==row.pilotID)
   return null;
  const manual=controller.manualOrder;
  if(!obj(manual)||manual.targetID!==row.targetEntityID||
    manual.allowPodKill===true||
    (row.action==='ATTACK'&&(
     manual.type!=='attack'||manual.allowWeapons!==true||
     controller.runtimeKind!=='nativeCombat'||
     controller.currentTargetID!==row.targetEntityID))||
    (row.action==='DEFEND'&&(
     manual.type!=='follow'||manual.allowWeapons!==false||
     manual.followRangeMeters!==row.followRangeMeters||
     ship.mode!=='FOLLOW'||ship.targetEntityID!==row.targetEntityID||
     ship.followRange!==row.followRangeMeters)))
    return null;
  const mode=row.action==='ATTACK'?'ATTACK':'DEFEND';
  const effect=signature(row,mode,manual);
  if(!hex(effect))return null;
  return {ship,controller,manual,mode,effect};
 }
 function recordAfterEffect(row){
  if(!on()||!matches(row)||row.phase!=='ISSUING')return bad('PF95_COMBAT_SOURCE_NOT_VALID');
  try{return atomic.transact([T,NE,NC,CH,ITEMS],tx=>{
   const issued=tx.get(T,pf55.key(row.shipItemID)),
     ix=tx.get(T,F+'manual-order-operations-v1'),
     owner=tx.get(CH,String(row.ownerCharacterID));
   if(issued?.operationID!==row.operationID||
      issued?.signature!==row.signature||issued?.phase!=='ISSUING'||
      ix?.operations?.[row.operationID]?.signature!==row.signature||
      ix.operations[row.operationID].phase!=='ISSUING'||
      owner?.characterID!==row.ownerCharacterID||
      owner.isDeleted===true||
      tx.get(T,ACK+row.operationID)!==null||
      orderWitness.verifyNativeActor(row,tx)!==true||
      combatAuthority.verify(row,tx)!==true)
    return bad('PF95_COMBAT_DURABLE_INTENT_OR_TARGET_CHANGED');
   const actual=observe(row);
   if(!actual)return bad('PF95_STOCK_COMBAT_EFFECT_NOT_OBSERVED');
   const entity=tx.get(NE,'entities\u001f'+row.shipItemID),
     ctrl=tx.get(NC,'controllers\u001f'+row.shipItemID),
     nativeEntity=nativeStore.getNativeEntity(row.shipItemID),
     nativeCtrl=nativeStore.getNativeController(row.shipItemID);
   if(!obj(entity)||!obj(ctrl)||
      entity.entityID!==row.shipItemID||
      entity.ownerID!==row.ownerCharacterID||
      entity.personalFleetOriginal!==true||
      entity.personalFleetAssignmentID!==row.assignmentID||
      ctrl.entityID!==row.shipItemID||
      ctrl.personalFleetOriginal!==true||
      ctrl.personalFleetAssignmentID!==row.assignmentID||
      nativeEntity?.entityID!==entity.entityID||
      nativeCtrl?.entityID!==ctrl.entityID)
    return bad('PF95_ORIGINAL_STORED_CONTROLLER_NOT_FOUND');
   const at=clock();
   if(!pos(at))return bad('PF95_NATIVE_CLOCK_INVALID');
   const receipt={version:1,source:'EVEJS_ORIGINAL_NATIVE_COMBAT_EFFECT_V1',
    operationID:row.operationID,signature:row.signature,
    action:row.action,shipItemID:row.shipItemID,
    targetEntityID:row.targetEntityID,systemID:row.systemID,
    ownerCharacterID:row.ownerCharacterID,pilotID:row.pilotID,
    actorGeneration:row.actorGeneration,assignmentID:row.assignmentID,
    followRangeMeters:row.followRangeMeters,
    effectHash:actual.effect,committedAtMs:at};
   const newCtrl={...ctrl,runtimeKind:actual.controller.runtimeKind,
    currentTargetID:actual.controller.currentTargetID,
    preferredTargetID:actual.controller.preferredTargetID,
    manualOrder:{...actual.manual},personalFleetCombatReceipt:receipt};
   const newEnt={...entity,
    ...(row.action==='DEFEND'?{mode:'FOLLOW',targetEntityID:row.targetEntityID,
      followRange:row.followRangeMeters,
      position:{...actual.ship.position}}:{}),
    personalFleetCombatReceipt:receipt};
   tx.put(NC,'controllers\u001f'+row.shipItemID,newCtrl);
   tx.put(NE,'entities\u001f'+row.shipItemID,newEnt);
   tx.put(T,ACK+row.operationID,receipt);
   return {success:true,status:'ORIGINAL_NATIVE_COMBAT_DURABLE'};
  },{contract:'personal-fleet-combat-receipt-v1',shipItemID:row.shipItemID,
    assignmentID:row.assignmentID,operationID:row.operationID});
  }catch{return bad('PF95_COMBAT_COMMIT_UNKNOWN_NO_RETRY');}
 }
 function verifyPersisted(row,tx){
  if(!matches(row)||!on()||typeof tx?.get!=='function')return null;
  try{
   const receipt=tx.get(T,ACK+row.operationID),
    entity=tx.get(NE,'entities\u001f'+row.shipItemID),
    ctrl=tx.get(NC,'controllers\u001f'+row.shipItemID);
   if(!obj(receipt)||!obj(entity)||!obj(ctrl)||
      receipt.version!==1||receipt.source!=='EVEJS_ORIGINAL_NATIVE_COMBAT_EFFECT_V1'||
      receipt.operationID!==row.operationID||receipt.signature!==row.signature||
      receipt.action!==row.action||receipt.shipItemID!==row.shipItemID||
      receipt.targetEntityID!==row.targetEntityID||
      receipt.systemID!==row.systemID||receipt.ownerCharacterID!==row.ownerCharacterID||
      receipt.assignmentID!==row.assignmentID||receipt.actorGeneration!==row.actorGeneration||
      receipt.pilotID!==row.pilotID||!pos(receipt.committedAtMs)||
      receipt.effectHash!==entity.personalFleetCombatReceipt?.effectHash||
      receipt.effectHash!==ctrl.personalFleetCombatReceipt?.effectHash||
      !obj(ctrl.manualOrder)||ctrl.manualOrder.targetID!==row.targetEntityID||
      !hex(receipt.effectHash)||
      receipt.effectHash!==signature(row,row.action,ctrl.manualOrder)||
      ctrl.personalFleetOriginal!==true||ctrl.personalFleetAssignmentID!==row.assignmentID||
      entity.personalFleetOriginal!==true||entity.personalFleetAssignmentID!==row.assignmentID||
      (row.action==='ATTACK'&&(ctrl.manualOrder.type!=='attack'||ctrl.manualOrder.allowWeapons!==true))||
      (row.action==='DEFEND'&&(ctrl.manualOrder.type!=='follow'||
       ctrl.manualOrder.allowWeapons!==false||
       entity.mode!=='FOLLOW'||entity.targetEntityID!==row.targetEntityID||
       entity.followRange!==row.followRangeMeters))||
      orderWitness.verifyNativeActor(row,tx)!==true)
    return null;
   return Object.freeze({source:'EVEJS_ORIGINAL_PERSISTED_NPC_ORDER_V1',
    operationID:row.operationID,signature:row.signature,action:row.action,
    entityID:row.shipItemID,controllerEntityID:row.shipItemID,
    shipItemID:row.shipItemID,ownerCharacterID:row.ownerCharacterID,
    pilotID:row.pilotID,assignmentID:row.assignmentID,
    actorGeneration:row.actorGeneration,systemID:row.systemID,
    nativeOwner:'PERSONAL_FLEET',orderApplied:true,
    controllerPersisted:true,noForeignCommand:true});
  }catch{return null;}
 }
 return Object.freeze({recordAfterEffect,verifyPersisted});
}
module.exports=Object.freeze({createOriginalCombatReceipt});
