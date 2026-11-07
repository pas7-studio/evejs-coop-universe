'use strict';
/**
 * PF55 original post-effect durable ACK, strictly after a successful
 * coopNpcOrderBridge / npcRuntime physical FOLLOW/HOLD effect.
 *
 * This bridge DOES NOT issue an order, create a controller/ship, or retry an
 * uncertain command. It stores the genuine in-scene movement state into the
 * original npcEntities entity row and one signed PF55 receipt under a SINGLE
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
const pf56=require('./coopPersonalFleetReturnDock');
const ingressProof=require('./coopPersonalFleetOriginalIngressProof');
const worldData=require('./worldData');
const T='corporationRuntime', NE='npcEntities', ITEMS='items',CH='characters';
const F='coop-personal-fleet\u001f',RECEIPT=F+'native-order-receipt-v1:',
 RETURN_RECEIPT=F+'native-return-receipt-v1:';
// Original SQLite ROW_GROUPS.npcEntities = ['entities'] stores per-NPC rows.
// This must NEVER write a root '/' or overwrite an unrelated NPC.
const ENTITY_ROW='entities\u001f',entityKey=itemID=>ENTITY_ROW+String(itemID);
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
  const source=tx.get(NE,entityKey(row.shipItemID));
  const controllerRecord=originalNpcStore.getNativeController(row.shipItemID);
  if(!obj(source)||
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
  return {scene,entity,movement,source};
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
   const stamped={...verified.source,...verified.movement};
   const ack=Object.freeze({version:1,source:'EVEJS_ORIGINAL_NATIVE_ORDER_COMMITTED_V1',
    operationID:row.operationID,signature:row.signature,
    assignmentID:row.assignmentID,ownerCharacterID:row.ownerCharacterID,
    pilotID:row.pilotID,shipItemID:row.shipItemID,systemID:row.systemID,
    actorGeneration:row.actorGeneration,action:row.action,
    targetEntityID:row.targetEntityID??null,
    followRangeMeters:row.followRangeMeters??null,
    movementHash:movementHash(stamped),committedAtMs:timestamp});
   tx.put(NE,entityKey(row.shipItemID),stamped);
   tx.put(T,key,ack);
   return {success:true,operationID:row.operationID,
    status:'DURABLE_NATIVE_APPLIED_AWAITING_PF55_ACK'};
  },{contract:'personal-fleet-entity-receipt-v1',shipItemID:row.shipItemID,
     operationID:row.operationID,assignmentID:row.assignmentID,mode:'ORDER'});
  }catch{return result(false,'PF55_NATIVE_DURABLE_COMMIT_UNKNOWN_NO_RETRY');}
 }
 function verifyPersistedNativeOrder(row,tx){
  if(!matchesRow(row)||!on()||!obj(tx)||typeof tx.get!=='function')return null;
  try{
   // The independent PF55 reconciliation must declare BOTH original tables.
   const receipt=tx.get(T,RECEIPT+row.operationID),
     stock=tx.get(NE,entityKey(row.shipItemID));
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
 // PF84B: native RETURN acceptance is durable only after a real, source-owned
 // physical warp begins. This records a one-shot *acceptance* proof, not a
 // promise that a warp will finish after an interrupted engine restart.
 function matchesReturn(row){
  return obj(row)&&row.version===1&&row.phase==='RETURN_ISSUING'&&
   token.test(row.operationID)&&token.test(row.assignmentID)&&
   pilot.test(row.pilotID)&&[row.shipItemID,row.systemID,row.stationID,
    row.ownerCharacterID,row.requestedByAccountID,row.actorGeneration,
    row.reservationGeneration,row.typeID].every(pos)&&
   row.returnDispatchCount===1&&row.dockDispatchCount===0&&
   typeof row.signature==='string'&&/^[0-9a-f]{64}$/.test(row.signature)&&
   row.signature===pf56.signature(row);
 }
 function originalStation(row,scene){
  const station=worldData.getStationByID(row.stationID),
   ball=scene?.getEntityByID?.(row.stationID);
  if(station?.stationID!==row.stationID||
   station.solarSystemID!==row.systemID||!vec(station.position)||
   scene?.systemID!==row.systemID||ball?.kind!=='station'||
   ball.itemID!==row.stationID||!vec(ball.position)||
   !finite(ball.radius)||ball.radius<1||
   Math.hypot(station.position.x-ball.position.x,
    station.position.y-ball.position.y,
    station.position.z-ball.position.z)>100)return null;
  // The SDE station row has no guaranteed physics radius; only the
  // ORIGINAL live station ball owns it. PF94 ingress captures both.
  return {...station,radius:ball.radius};
 }
 function persistedReturnSource(row,tx){
  if(orderWitness.verifyNativeActor(row,tx)!==true)return null;
  const originalChar=tx.get(CH,String(row.ownerCharacterID));
  if(originalChar?.characterID!==row.ownerCharacterID||
   originalChar.accountId!==row.requestedByAccountID||
   originalChar.isDeleted===true)return null;
  const scene=runtime.scenes.get(row.systemID),
    ship=scene?.getEntityByID?.(row.shipItemID),
    controller=registry.getControllerByEntityID(row.shipItemID),
    station=originalStation(row,scene);
  const stored=tx.get(NE,entityKey(row.shipItemID));
  const nativeEntity=originalNpcStore.getNativeEntity(row.shipItemID),
    nativeController=originalNpcStore.getNativeController(row.shipItemID);
  if(!station||!obj(stored)||
   ship?.kind!=='ship'||ship.itemID!==row.shipItemID||
   ship.ownerID!==row.ownerCharacterID||ship.nativeNpc!==true||
   ship.session!=null||controller?.entityID!==row.shipItemID||
   controller.systemID!==row.systemID||
   nativeEntity?.entityID!==row.shipItemID||
   nativeEntity.personalFleetOriginal!==true||
   nativeEntity.personalFleetAssignmentID!==row.assignmentID||
   nativeEntity.personalFleetPilotID!==row.pilotID||
   nativeController?.entityID!==row.shipItemID||
   nativeController.personalFleetOriginal!==true||
   nativeController.personalFleetAssignmentID!==row.assignmentID||
   nativeController.personalFleetPilotID!==row.pilotID||
   stored.entityID!==row.shipItemID||stored.systemID!==row.systemID||
   stored.ownerID!==row.ownerCharacterID||
   stored.personalFleetOriginal!==true||
   stored.personalFleetAssignmentID!==row.assignmentID||
   stored.personalFleetPilotID!==row.pilotID||
   scene.getEntityByID(row.shipItemID)!==ship)return null;
  return {stored,ship,station};
 }
 function recordAfterNativeReturnEffect(row){
  if(!matchesReturn(row)||!on())
   return result(false,'PF56_RETURN_DURABLE_RECORD_DISABLED');
  try{return atomic.transact([T,ITEMS,CH,NE],tx=>{
   const intent=tx.get(T,pf56.key(row.assignmentID)),
     ops=tx.get(T,pf56.OPS);
   if(!obj(intent)||intent.phase!=='RETURN_ISSUING'||
    intent.operationID!==row.operationID||
    intent.signature!==row.signature||
    ops?.operations?.[row.operationID]?.signature!==row.signature||
    ops.operations[row.operationID].assignmentID!==row.assignmentID||
    ops.operations[row.operationID].phase!=='RETURN_ISSUING'||
    tx.get(T,RETURN_RECEIPT+row.operationID)!==null)
    return result(false,'PF56_RETURN_ORIGINAL_ISSUING_INTENT_NOT_PROVEN');
   const physical=persistedReturnSource(row,tx);
   if(!physical)return result(false,'PF56_RETURN_ORIGINAL_ACTOR_NOT_VERIFIED');
   // A successful bridge callback alone is insufficient: observe original
   // in-scene warp state after the effect. No position teleport is written.
   const ship=physical.ship;
   if(!(ship.isWarping===true||ship.warpState||
    ship.pendingWarp||String(ship.mode||'').toUpperCase()==='WARP'))
    return result(false,'PF56_RETURN_ORIGINAL_WARP_NOT_OBSERVED');
   const timestamp=clock();
   if(!pos(timestamp))return result(false,'PF56_RETURN_DURABLE_CLOCK_INVALID');
   const ingress=ingressProof.captureOriginalReturnIngress(row,physical,timestamp);
   if(!ingress)return result(false,'PF94_REAL_NATIVE_RETURN_INGRESS_NOT_PROVEN');
   const marker={version:1,operationID:row.operationID,
    signature:row.signature,assignmentID:row.assignmentID,
    ownerCharacterID:row.ownerCharacterID,pilotID:row.pilotID,
    shipItemID:row.shipItemID,systemID:row.systemID,
    stationID:row.stationID,actorGeneration:row.actorGeneration,
    requestedByAccountID:row.requestedByAccountID,
    committedAtMs:timestamp};
   tx.put(NE,entityKey(row.shipItemID),
    {...physical.stored,mode:'WARP',targetPoint:{...ingress.targetPoint},
     personalFleetReturnOrder:marker,personalFleetReturnIngress:ingress});
   tx.put(T,RETURN_RECEIPT+row.operationID,
    {...marker,source:'EVEJS_ORIGINAL_NATIVE_RETURN_COMMITTED_V1',
     ingressHash:ingress.hash});
   return {success:true,operationID:row.operationID,
    status:'ORIGINAL_NATIVE_RETURN_ORDER_DURABLE'};
  },{contract:'personal-fleet-entity-receipt-v1',shipItemID:row.shipItemID,
     operationID:row.operationID,assignmentID:row.assignmentID,mode:'RETURN'});
  }catch{return result(false,'PF56_NATIVE_RETURN_COMMIT_UNKNOWN_NO_RETRY');}
 }
 function verifyPersistedNativeReturn(row,tx){
  if(!matchesReturn(row)||!on()||!obj(tx)||typeof tx.get!=='function')return null;
  try{
   const saved=tx.get(T,pf56.key(row.assignmentID)),
    ops=tx.get(T,pf56.OPS),
    stamp=tx.get(T,RETURN_RECEIPT+row.operationID),
    stored=tx.get(NE,entityKey(row.shipItemID)),
    marker=stored?.personalFleetReturnOrder,
    ingress=stored?.personalFleetReturnIngress;
   if(!obj(saved)||saved.operationID!==row.operationID||
    saved.signature!==row.signature||saved.phase!=='RETURN_ISSUING'||
    ops?.operations?.[row.operationID]?.signature!==row.signature||
    ops.operations[row.operationID].phase!=='RETURN_ISSUING'||
    !obj(stamp)||stamp.source!=='EVEJS_ORIGINAL_NATIVE_RETURN_COMMITTED_V1'||
    !obj(marker)||stamp.version!==1||marker.version!==1||
    ['operationID','signature','assignmentID','ownerCharacterID','pilotID',
     'shipItemID','systemID','stationID','actorGeneration',
     'requestedByAccountID','committedAtMs'].some(k=>
      stamp[k]!==row[k]&&k!=='committedAtMs'||stamp[k]!==marker[k])||
    !pos(stamp.committedAtMs)||!pos(marker.committedAtMs)||
    stamp.ingressHash!==ingress?.hash||
    ingressProof.verifySnapshot(row,ingress,stored)!==true||
    orderWitness.verifyNativeActor(row,tx)!==true)
    return null;
   const character=tx.get(CH,String(row.ownerCharacterID));
   if(character?.characterID!==row.ownerCharacterID||
      character.accountId!==row.requestedByAccountID||
      character.isDeleted===true)return null;
   return Object.freeze({
    source:'EVEJS_ORIGINAL_PERSISTED_NPC_RETURN_V1',
    operationID:row.operationID,signature:row.signature,
    assignmentID:row.assignmentID,ownerCharacterID:row.ownerCharacterID,
    pilotID:row.pilotID,shipItemID:row.shipItemID,
    controllerEntityID:row.shipItemID,actorGeneration:row.actorGeneration,
    stationID:row.stationID,systemID:row.systemID,
    nativeOwner:'PERSONAL_FLEET',returnOrderPersisted:true,
    returnTargetVerified:true,noForeignCommand:true});
  }catch{return null;}
 }
 return Object.freeze({recordAfterNativeEffect,verifyPersistedNativeOrder,
  recordAfterNativeReturnEffect,verifyPersistedNativeReturn});
}
module.exports=Object.freeze({createOriginalDurableOrderAck});
