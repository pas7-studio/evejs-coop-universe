'use strict';
/**
 * PF55 original post-effect durable ACK, strictly after a successful
 * coopNpcOrderBridge / npcRuntime physical FOLLOW/HOLD effect.
 *
 * This bridge DOES NOT issue an order, create a controller/ship, or retry an
 * uncertain command. It stores the genuine in-scene movement state into the
 * original npcEntities root and one signed PF55 receipt under a SINGLE
 * original GameStore/SQLite transaction. The stock nativeNpcService restore
 * already reads mode, targetEntityID, followRange from npcEntities.
 *
 * A crash before this transaction leaves PF55 ISSUING, with no redispatch.
 * A crash after commit permits PF55 reconciliation from persisted evidence.
 * PF55 ACK indicates a durable accepted order, not continuous offline AI.
 */
const {createHash}=require('node:crypto');
const gameStore=require('../gameStore');
const runtime=require('./runtime');
const registry=require('./npc/npcRegistry');
const originalNpcStore=require('./npc/nativeNpcStore');
const pf55=require('./coopPersonalFleetNativeOrders');
const T='corporationRuntime', NE='npcEntities', ITEMS='items',CH='characters';
const F='coop-personal-fleet\u001f',RECEIPT=F+'native-order-receipt-v1:';
const token=/^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/;
const pilot=/^coop-pilot-[0-9]{3,}$/;
const pos=x=>Number.isSafeInteger(x)&&x>0;
const obj=x=>x!==null&&typeof x==='object'&&!Array.isArray(x);
const finite=x=>typeof x==='number'&&Number.isFinite(x);
const vec=x=>obj(x)&&finite(x.x)&&finite(x.y)&&finite(x.z);
const sha=x=>createHash('sha256').update(JSON.stringify(x)).digest('hex');
const movementHash=e=>sha([e.entityID,e.systemID,e.ownerID,e.typeID,
 e.personalFleetOriginal,e.personalFleetAssignmentID,e.personalFleetPilotID,
 e.personalFleetGeneration,e.mode,e.targetEntityID,e.followRange]);
const result=(success,errorMsg)=>Object.freeze({success,errorMsg});
function matchesRow(row){
 return obj(row)&&row.version===1&&row.phase==='ISSUING'&&
  token.test(row.operationID)&&token.test(row.assignmentID)&&
  pilot.test(row.pilotID)&&[row.shipItemID,row.systemID,row.ownerCharacterID,row.actorGeneration].every(pos)&&
  ['FOLLOW','HOLD'].includes(row.action)&&
  typeof row.signature==='string'&&/^[a-f0-9]{64}$/.test(row.signature)&&
  row.signature===pf55.signature(row)&&pos(row.startedAtMs)&&
  (row.action==='FOLLOW'?(pos(row.targetEntityID)&&
   Number.isSafeInteger(row.followRangeMeters)&&row.followRangeMeters>=500&&
   row.followRangeMeters<=100000):row.targetEntityID==null);
}
function motion(row,entity,controller){
 if(!entity||entity.itemID!==row.shipItemID||entity.kind!=='ship'||
  entity.nativeNpc!==true||entity.ownerID!==row.ownerCharacterID||
  entity.personalFleetAssignmentID!==row.assignmentID&&
   entity.selectionID!==row.assignmentID||
  entity.session!=null||controller?.entityID!==row.shipItemID||
  controller?.systemID!==row.systemID||controller?.runtimeKind!=='nativeAmbient'||
  !vec(entity.position)||!vec(entity.velocity)||
  !vec(entity.direction)||!vec(entity.targetPoint)||
  entity.warpState||entity.pendingWarp||entity.isWarping===true)return null;
 const mode=String(entity.mode||'').toUpperCase();
 if(row.action==='FOLLOW'){
  if(mode!=='FOLLOW'||entity.targetEntityID!==row.targetEntityID||
     !finite(entity.followRange)||
     Math.abs(entity.followRange-row.followRangeMeters)>0.01||
     controller.manualOrder?.type==='attack')return null;
 }else{
  if(mode!=='STOP'||entity.targetEntityID!=null&&entity.targetEntityID!==0||
     controller.manualOrder?.type!=='stop')return null;
 }
 const record={mode,targetEntityID:row.action==='FOLLOW'?row.targetEntityID:0,
  followRange:row.action==='FOLLOW'?row.followRangeMeters:0,
  position:{...entity.position},velocity:{...entity.velocity},
  direction:{...entity.direction},targetPoint:{...entity.targetPoint},
  speedFraction:finite(entity.speedFraction)?entity.speedFraction:0};
 if(!finite(record.speedFraction)||record.speedFraction<0||record.speedFraction>1)return null;
 return record;
}
function createOriginalDurableOrderAck({orderWitness,enabled=()=>false,
 allWritersFenced=()=>false,clock=()=>Date.now()}={}){
 const atomic=gameStore.coopAtomicNativeRows;
 if(atomic?.mode!=='SERVER_INTERNAL_FLAGGED'||typeof atomic.transact!=='function'||
  typeof atomic.isPoisoned!=='function'||
  typeof runtime.scenes?.get!=='function'||
  typeof registry.getControllerByEntityID!=='function'||
  typeof originalNpcStore.getNativeEntity!=='function'||
  typeof originalNpcStore.getNativeController!=='function'||
  typeof pf55.signature!=='function'||
  !orderWitness||!['verifyNativeActor','verifyOriginalControl','verifyTarget'].every(k=>
   typeof orderWitness[k]==='function')||
  [enabled,allWritersFenced,clock].some(x=>typeof x!=='function'))
  throw Error('PF55_NATIVE_DURABLE_ORDER_RECEIPT_AUTHORITIES_REQUIRED');
 const on=()=>enabled()===true&&allWritersFenced()===true&&atomic.isPoisoned()===false;
 function ownerSource(row,tx){
  if(!on()||orderWitness.verifyNativeActor(row,tx)!==true||
     orderWitness.verifyOriginalControl(row,tx)!==true||
     orderWitness.verifyTarget(row,tx)!==true)return null;
  const scene=runtime.scenes.get(row.systemID);
  if(scene?.systemID!==row.systemID)return null;
  const entity=scene.getEntityByID?.(row.shipItemID),
    controller=registry.getControllerByEntityID(row.shipItemID);
  const movement=motion(row,entity,controller);
  if(!movement)return null;
  const persisted=tx.get(NE,'/'),source=persisted?.entities?.[String(row.shipItemID)];
  const controllerRecord=originalNpcStore.getNativeController(row.shipItemID);
  if(!obj(persisted)||!obj(persisted.entities)||!obj(source)||
     source.entityID!==row.shipItemID||source.systemID!==row.systemID||
     source.personalFleetOriginal!==true||
     source.personalFleetAssignmentID!==row.assignmentID||
     source.personalFleetPilotID!==row.pilotID||
     controllerRecord?.entityID!==row.shipItemID||
     controllerRecord?.systemID!==row.systemID||
     controllerRecord?.personalFleetOriginal!==true||
     controllerRecord?.personalFleetAssignmentID!==row.assignmentID||
     controllerRecord?.personalFleetPilotID!==row.pilotID||
     controllerRecord?.runtimeKind!=='nativeAmbient'||
     scene.getEntityByID(row.shipItemID)!==entity)return null;
  return {scene,entity,movement,source,persisted};
 }
 function recordAfterNativeEffect(row){
  if(!matchesRow(row)||!on())return result(false,'PF55_NATIVE_DURABLE_RECORD_DISABLED');
  // This method only runs AFTER original arbiter reports physical success.
  // It is NEVER retried on a failed/unknown SQLite commit outcome.
  try{return atomic.transact([T,ITEMS,CH,NE],tx=>{
   const issued=tx.get(T,pf55.key(row.shipItemID));
   const ops=tx.get(T,F+'manual-order-operations-v1');
   if(!obj(issued)||issued.phase!=='ISSUING'||
      issued.operationID!==row.operationID||issued.signature!==row.signature||
      ops?.operations?.[row.operationID]?.phase!=='ISSUING'||
      ops.operations[row.operationID].signature!==row.signature||
      ops.operations[row.operationID].shipItemID!==row.shipItemID)
    return result(false,'PF55_ORDER_ISSUING_INTENT_NOT_PROVEN');
   const key=RECEIPT+row.operationID;
   if(tx.get(T,key)!==null)return result(false,'PF55_ORDER_RECEIPT_ALREADY_PRESENT_OR_UNKNOWN');
   const verified=ownerSource(row,tx);
   if(!verified)return result(false,'PF55_ORIGINAL_PHYSICAL_MOTION_NOT_VERIFIED');
   const timestamp=clock();if(!pos(timestamp))return result(false,'PF55_ORDER_RECEIPT_CLOCK_INVALID');
   const persistedRoot={...verified.persisted,entities:{...verified.persisted.entities,
    [String(row.shipItemID)]:{...verified.source,...verified.movement}}};
   const stamped=persistedRoot.entities[String(row.shipItemID)];
   const ack=Object.freeze({version:1,source:'EVEJS_ORIGINAL_NATIVE_ORDER_COMMITTED_V1',
    operationID:row.operationID,signature:row.signature,
    assignmentID:row.assignmentID,ownerCharacterID:row.ownerCharacterID,
    pilotID:row.pilotID,shipItemID:row.shipItemID,systemID:row.systemID,
    actorGeneration:row.actorGeneration,action:row.action,
    targetEntityID:row.targetEntityID??null,
    followRangeMeters:row.followRangeMeters??null,
    movementHash:movementHash(stamped),committedAtMs:timestamp});
   tx.put(NE,'/',persistedRoot);
   tx.put(T,key,ack);
   return {success:true,operationID:row.operationID,
    status:'DURABLE_NATIVE_APPLIED_AWAITING_PF55_ACK'};
  });}catch{return result(false,'PF55_NATIVE_DURABLE_COMMIT_UNKNOWN_NO_RETRY');}
 }
 function verifyPersistedNativeOrder(row,tx){
  if(!matchesRow(row)||!on()||!obj(tx)||typeof tx.get!=='function')return null;
  try{
   // The independent PF55 reconciliation must declare BOTH original tables.
   const receipt=tx.get(T,RECEIPT+row.operationID),
     root=tx.get(NE,'/'),stock=root?.entities?.[String(row.shipItemID)];
   if(!obj(receipt)||receipt.version!==1||
      receipt.source!=='EVEJS_ORIGINAL_NATIVE_ORDER_COMMITTED_V1'||
      receipt.operationID!==row.operationID||receipt.signature!==row.signature||
      receipt.assignmentID!==row.assignmentID||
      receipt.ownerCharacterID!==row.ownerCharacterID||
      receipt.pilotID!==row.pilotID||receipt.shipItemID!==row.shipItemID||
      receipt.systemID!==row.systemID||receipt.actorGeneration!==row.actorGeneration||
      receipt.action!==row.action||receipt.targetEntityID!==(row.targetEntityID??null)||
      receipt.followRangeMeters!==(row.followRangeMeters??null)||
      !pos(receipt.committedAtMs)||
      !obj(stock)||stock.entityID!==row.shipItemID||
      stock.personalFleetOriginal!==true||
      stock.personalFleetAssignmentID!==row.assignmentID||
      stock.personalFleetPilotID!==row.pilotID||
      receipt.movementHash!==movementHash(stock))return null;
   if(row.action==='FOLLOW'&&(
     stock.mode!=='FOLLOW'||stock.targetEntityID!==row.targetEntityID||
     stock.followRange!==row.followRangeMeters))return null;
   if(row.action==='HOLD'&&(stock.mode!=='STOP'||
     stock.targetEntityID!==0||stock.followRange!==0))return null;
   return Object.freeze({source:'EVEJS_ORIGINAL_PERSISTED_NPC_ORDER_V1',
    operationID:row.operationID,signature:row.signature,
    entityID:row.shipItemID,controllerEntityID:row.shipItemID,
    shipItemID:row.shipItemID,ownerCharacterID:row.ownerCharacterID,
    pilotID:row.pilotID,assignmentID:row.assignmentID,
    actorGeneration:row.actorGeneration,systemID:row.systemID,
    action:row.action,nativeOwner:'PERSONAL_FLEET',
    orderApplied:true,controllerPersisted:true,noForeignCommand:true});
  }catch{return null;}
 }
 return Object.freeze({recordAfterNativeEffect,verifyPersistedNativeOrder});
}
module.exports=Object.freeze({createOriginalDurableOrderAck});
