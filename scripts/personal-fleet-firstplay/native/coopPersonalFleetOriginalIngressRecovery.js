'use strict';
/**
 * PF94: resume ONLY already-issued original Personal Fleet PF56 ingress.
 * The original PF56 post-warp receipt and npcEntities row are atomic.
 * This module never calls warpToPoint, warpToEntity, teleport or ItemStore.
 */
const gameStore=require('../gameStore');
const nativeStore=require('./npc/nativeNpcStore');
const registry=require('./npc/npcRegistry');
const pf56=require('./coopPersonalFleetReturnDock');
const proof=require('./coopPersonalFleetOriginalIngressProof');
const worldData=require('./worldData');
const T='corporationRuntime',NE='npcEntities',CHAR='characters';
const F='coop-personal-fleet\u001f',RECEIPT=F+'native-return-receipt-v1:';
const obj=x=>x!==null&&typeof x==='object'&&!Array.isArray(x);
const pos=x=>Number.isSafeInteger(x)&&x>0;
const same=(a,b)=>obj(a)&&obj(b)&&['x','y','z'].every(k=>a[k]===b[k]);
const deny=r=>Object.freeze({status:'BLOCKED',reason:r});
function createOriginalIngressRecovery({enabled=()=>false,allWritersFenced=()=>false,
 clock=()=>Date.now()}={}){
 const atomic=gameStore?.coopAtomicNativeRows;
 if(atomic?.mode!=='SERVER_INTERNAL_FLAGGED'||
    typeof atomic.transact!=='function'||typeof atomic.isPoisoned!=='function'||
    typeof nativeStore.getNativeEntity!=='function'||
    typeof nativeStore.getNativeController!=='function'||
    typeof registry.getControllerByEntityID!=='function'||
    typeof pf56.key!=='function'||typeof pf56.signature!=='function'||
    typeof worldData.getStationByID!=='function'||
    typeof proof.verifySnapshot!=='function'||typeof proof.canResume!=='function'||
    [enabled,allWritersFenced,clock].some(f=>typeof f!=='function'))
  throw Error('PF94_ORIGINAL_NATIVE_INGRESS_SOURCES_REQUIRED');
 const on=()=>enabled()===true&&allWritersFenced()===true&&atomic.isPoisoned()===false;
 function inspect(row){
  if(!on()||!obj(row)||!pos(row.shipItemID)||!pos(row.systemID)||
     !pos(row.ownerCharacterID)||!pos(row.actorGeneration))
   return deny('PF94_NATIVE_RECOVERY_NOT_AUTHORIZED');
  const now=clock();
  if(!pos(now))return deny('PF94_NATIVE_CLOCK_UNVERIFIED');
  try{return atomic.transact([T,NE,CHAR],tx=>{
   const original=tx.get(NE,'entities\u001f'+row.shipItemID);
   const mark=original?.personalFleetReturnOrder,
     ingress=original?.personalFleetReturnIngress;
   if(!obj(mark)||!obj(ingress)||!pos(mark.stationID)||
      mark.shipItemID!==row.shipItemID||mark.systemID!==row.systemID||
      mark.ownerCharacterID!==row.ownerCharacterID||
      mark.assignmentID!==row.assignmentID||
      mark.pilotID!==row.pilotID||
      mark.actorGeneration!==row.actorGeneration||
      original?.mode!=='WARP')
    return deny('PF94_NATIVE_RETURN_RECEIPT_NOT_FOUND');
   const intent=tx.get(T,pf56.key(row.assignmentID)),
     operations=tx.get(T,pf56.OPS),
     stamp=tx.get(T,RECEIPT+mark.operationID),
     owner=tx.get(CHAR,String(row.ownerCharacterID));
   if(!obj(intent)||!obj(operations)||!obj(stamp)||!obj(owner)||
      !['RETURN_ISSUING','RETURNING'].includes(intent.phase)||
      intent.operationID!==mark.operationID||
      intent.signature!==mark.signature||
      intent.assignmentID!==row.assignmentID||
      intent.shipItemID!==row.shipItemID||
      intent.actorGeneration!==row.actorGeneration||
      intent.ownerCharacterID!==row.ownerCharacterID||
      intent.pilotID!==row.pilotID||
      intent.stationID!==mark.stationID||
      intent.signature!==pf56.signature(intent)||
      operations.operations?.[mark.operationID]?.signature!==mark.signature||
      operations.operations?.[mark.operationID]?.assignmentID!==row.assignmentID||
      stamp.source!=='EVEJS_ORIGINAL_NATIVE_RETURN_COMMITTED_V1'||
      stamp.operationID!==mark.operationID||
      stamp.signature!==mark.signature||
      stamp.ownerCharacterID!==row.ownerCharacterID||
      stamp.shipItemID!==row.shipItemID||
      stamp.stationID!==mark.stationID||
      stamp.ingressHash!==ingress.hash||
      stamp.committedAtMs!==mark.committedAtMs||
      owner.characterID!==row.ownerCharacterID||
      owner.accountId!==mark.requestedByAccountID||
      owner.isDeleted===true||
      proof.verifySnapshot({...row,operationID:mark.operationID,
       signature:mark.signature,stationID:mark.stationID},ingress,original)!==true)
    return deny('PF94_NATIVE_RETURN_SOURCE_CONFLICT');
   const originalStation=worldData.getStationByID(mark.stationID);
   if(originalStation?.stationID!==mark.stationID||
      originalStation?.solarSystemID!==row.systemID||
      !proof.canResume({...row,operationID:mark.operationID,
        signature:mark.signature,stationID:mark.stationID},
       ingress,now,{...originalStation,radius:0}))
    return deny('PF94_NATIVE_INGRESS_EXPIRED_OR_STATION_MISMATCH');
   // Stamped original NPC actor and controller must still own the same
   // physical hull. Never restore a WAR/MINING/EXPEDITION actor.
   const storedNative=nativeStore.getNativeEntity(row.shipItemID),
    controller=nativeStore.getNativeController(row.shipItemID);
   if(storedNative?.personalFleetReturnIngress?.hash!==ingress.hash||
      storedNative?.personalFleetOriginal!==true||
      storedNative?.personalFleetAssignmentID!==row.assignmentID||
      storedNative?.personalFleetPilotID!==row.pilotID||
      controller?.personalFleetOriginal!==true||
      controller?.personalFleetAssignmentID!==row.assignmentID||
      controller?.personalFleetPilotID!==row.pilotID||
      controller?.entityID!==row.shipItemID)
    return deny('PF94_ORIGINAL_NATIVE_ACTOR_CHANGED');
   return Object.freeze({status:'VERIFIED_ORIGINAL_INGRESS',
    shipItemID:row.shipItemID,systemID:row.systemID,
    stationID:mark.stationID,ingress});
  });}catch{return deny('PF94_NATIVE_PROOF_READ_UNCERTAIN');}
 }
 function restore(row,scene){
  if(!on()||scene?.systemID!==row?.systemID||
     typeof scene.getEntityByID!=='function')
   return deny('PF94_ORIGINAL_SCENE_MISSING');
  const result=inspect(row);
  if(result.status!=='VERIFIED_ORIGINAL_INGRESS')return result;
  const ship=scene.getEntityByID(row.shipItemID),
    controller=registry.getControllerByEntityID(row.shipItemID),
    station=scene.getEntityByID(result.stationID),
    source=worldData.getStationByID(result.stationID);
  if(ship?.kind!=='ship'||ship.itemID!==row.shipItemID||
     ship.nativeNpc!==true||ship.ownerID!==row.ownerCharacterID||
     ship.transient===true||ship.session!=null||
     controller?.entityID!==row.shipItemID||controller.systemID!==row.systemID||
     controller.personalFleetOriginal!==true||
     controller.personalFleetAssignmentID!==row.assignmentID||
     controller.personalFleetPilotID!==row.pilotID||
     station?.kind!=='station'||station.itemID!==result.stationID||
     source?.stationID!==result.stationID||
     !same(source.position,station.position)||
     !proof.canResume({...row,operationID:result.ingress.operationID,
       signature:result.ingress.signature,stationID:result.stationID},
       result.ingress,clock(),{...source,radius:station.radius}))
    return deny('PF94_PHYSICAL_INGRESS_SCENE_CHANGED');
  const g=result.ingress;
  if(ship.sessionlessWarpIngress){
   const old=ship.sessionlessWarpIngress;
   if(!same(old.origin,g.origin)||!same(old.targetPoint,g.targetPoint)||
      old.startTimeMs!==g.startTimeMs||
      old.travelCompleteAtMs!==g.travelCompleteAtMs)
    return deny('PF94_FOREIGN_IN_FLIGHT_WARP');
   return {status:'ALREADY_ORIGINAL_INGRESS',shipItemID:row.shipItemID};
  }
  if(!same(ship.position,g.origin)||ship.pendingWarp||
     ship.warpState||ship.isWarping===true)
   return deny('PF94_NATIVE_SCENE_POSITION_OR_WARP_CONFLICT');
  // Original SpaceScene interpolation picks this up on its next tick.
  // Do not call the NPC warp dispatch function; the original order already
  // occurred and was acknowledged in the same durable SQLite transaction.
  ship.sessionlessWarpIngress={
   origin:{...g.origin},targetPoint:{...g.targetPoint},
   startTimeMs:g.startTimeMs,travelCompleteAtMs:g.travelCompleteAtMs,
   completeAtMs:g.completeAtMs,
   durationMs:g.travelCompleteAtMs-g.startTimeMs,
   completionHoldMs:g.completeAtMs-g.travelCompleteAtMs,
   lastUpdateAtMs:clock()
  };
  ship.mode='WARP';
  ship.targetPoint={...g.targetPoint};
  return {status:'RESTORED_ORIGINAL_INGRESS',shipItemID:row.shipItemID};
 }
 return Object.freeze({inspect,restore});
}
module.exports=Object.freeze({createOriginalIngressRecovery});
