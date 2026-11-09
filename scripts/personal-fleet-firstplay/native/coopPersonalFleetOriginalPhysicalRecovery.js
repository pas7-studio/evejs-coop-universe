'use strict';
/**
 * PF90: original physical Personal Fleet NPC restoration after Node restart.
 * Uses ONLY durable PF52/54 authority, stock ItemStore and original
 * nativeNpcStore/controller. Calls stock materializeStoredNativeController
 * exactly once per actor per process only when the genuine scene is loaded.
 * No new ItemStore title, NPC ID, salary, order, warp or synthetic scene.
 * Unknown previous warp -> operator reconciliation, NEVER blind replay.
 */
const gameStore=require('../gameStore');
const nativeStore=require('./npc/nativeNpcStore');
const nativeService=require('./npc/nativeNpcService');
const runtime=require('./runtime');
const registry=require('./npc/npcRegistry');
const sessions=require('../services/chat/sessionRegistry');
const pf52=require('./coopPersonalFleetHangarBridge');
const ingressSource=require('./coopPersonalFleetOriginalIngressRecovery');
const T='corporationRuntime',ITEMS='items',P='coop-personal-fleet\u001f';
const pos=x=>Number.isSafeInteger(x)&&x>0;
const obj=x=>x!==null&&typeof x==='object'&&!Array.isArray(x);
const token=x=>typeof x==='string'&&/^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/.test(x);
const pilot=x=>typeof x==='string'&&/^coop-pilot-[0-9]{3,}$/.test(x);
const block=reason=>Object.freeze({status:'BLOCKED',reason});
function createOriginalPhysicalRecovery({enabled=()=>false,allWritersFenced=()=>false}={}){
 const atomic=gameStore?.coopAtomicNativeRows;
 if(atomic?.mode!=='SERVER_INTERNAL_FLAGGED'||
    typeof atomic.transact!=='function'||typeof atomic.isPoisoned!=='function'||
    typeof nativeStore.getNativeEntity!=='function'||
    typeof nativeStore.getNativeController!=='function'||
    typeof nativeService.materializeStoredNativeController!=='function'||
    typeof runtime.scenes?.get!=='function'||typeof runtime.scenes?.values!=='function'||
    typeof registry.getControllerByEntityID!=='function'||
    typeof sessions.getSessions!=='function'||
    typeof pf52.validateIndex!=='function'||typeof pf52.validateRoster!=='function'||
    [enabled,allWritersFenced].some(f=>typeof f!=='function'))
  throw Error('PF90_ORIGINAL_SOURCE_AUTHORITIES_REQUIRED');
 const live=()=>enabled()===true&&allWritersFenced()===true&&atomic.isPoisoned()===false;
 const ingress=ingressSource.createOriginalIngressRecovery({enabled,allWritersFenced});
 if(typeof ingress?.inspect!=='function'||typeof ingress.restore!=='function')
  throw Error('PF94_ORIGINAL_INGRESS_RESTORE_AUTHORITY_REQUIRED');
 const attempted=new Set();let busy=false;
 function snapshots(){
  return atomic.transact([T,ITEMS],tx=>{
   const index=tx.get(T,pf52.REGISTRY_KEY),claims=tx.get(T,P+'actor-claims-v1');
   if(index===null)return [];
   if(!obj(index)||!obj(claims)||!obj(claims.claims))
    throw Error('PF90_ORIGINAL_CUSTODY_ROOT_UNAVAILABLE');
   pf52.validateIndex(index);
   const result=[];
   for(const link of Object.values(index.ships)){
    if(!obj(link)||!pos(link.shipItemID)||!pos(link.ownerCharacterID)||
       !pilot(link.pilotID)||!token(link.assignmentID))throw Error('PF90_CORRUPT_SHIP_LINK');
    const dep=tx.get(T,P+'deploy-v1:'+link.assignmentID);
    if(dep===null||dep===undefined||dep.phase!=='ACTIVE')continue;
    const rosterRaw=tx.get(T,pf52.ROSTER_PREFIX+link.ownerCharacterID),
      roster=pf52.validateRoster(rosterRaw,link.ownerCharacterID),
      p=roster.pilots[link.pilotID],claim=claims.claims[String(link.shipItemID)],
      item=tx.get(ITEMS,String(link.shipItemID));
    if(dep.shipItemID!==link.shipItemID||dep.ownerCharacterID!==link.ownerCharacterID||
       dep.pilotID!==link.pilotID||dep.assignmentID!==link.assignmentID||
       !pos(dep.systemID)||!pos(dep.actorGeneration)||
       dep.generation!==link.generation||
       p?.pilotID!==link.pilotID||p?.shipItemID!==link.shipItemID||
       p?.assignmentID!==link.assignmentID||p?.status!=='HANGAR_RESERVED'||
       p?.generation!==link.generation||
       claim?.ownerType!=='PERSONAL_FLEET'||claim?.entityID!==link.shipItemID||
       claim?.pilotID!==link.pilotID||
       claim?.assignmentID!==link.assignmentID||
       claim?.ownerCharacterID!==link.ownerCharacterID||
       claim?.systemID!==dep.systemID||
       claim?.generation!==dep.actorGeneration||
       item?.itemID!==link.shipItemID||item?.ownerID!==link.ownerCharacterID||
       item?.categoryID!==6||item?.flagID!==0||
       item?.locationID!==dep.systemID||item?.typeID!==dep.typeID||
       item?.spaceState?.systemID!==dep.systemID)
     throw Error('PF90_DURABLE_ACTOR_CUSTODY_CONFLICT');
    result.push(Object.freeze({shipItemID:link.shipItemID,
      ownerCharacterID:link.ownerCharacterID,systemID:dep.systemID,
      assignmentID:link.assignmentID,pilotID:link.pilotID,
      generation:link.generation,actorGeneration:dep.actorGeneration,
      typeID:dep.typeID}));
   }
   if(result.length>256)return null;
   return result;
  });
 }
 function saved(row){
  const entity=nativeStore.getNativeEntity(row.shipItemID),
    controller=nativeStore.getNativeController(row.shipItemID);
  if(!obj(entity)||!obj(controller)||entity.transient===true||
     controller.transient===true||entity.nativeNpc!==true||
     entity.entityID!==row.shipItemID||controller.entityID!==row.shipItemID||
     entity.ownerID!==row.ownerCharacterID||entity.systemID!==row.systemID||
     controller.systemID!==row.systemID||
     entity.typeID!==row.typeID||
     entity.personalFleetOriginal!==true||controller.personalFleetOriginal!==true||
     entity.personalFleetAssignmentID!==row.assignmentID||
     controller.personalFleetAssignmentID!==row.assignmentID||
     entity.personalFleetPilotID!==row.pilotID||
     controller.personalFleetPilotID!==row.pilotID||
     entity.personalFleetGeneration!==row.generation||
     controller.personalFleetGeneration!==row.generation||
     entity.nativeNpcOccupied!==true||
     entity.npcEntityType!=='personalFleet'||
     entity.operatorKind!=='PERSONAL_FLEET'||
     entity.selectionKind!=='PERSONAL_FLEET'||
     entity.selectionID!==row.assignmentID||
     controller.entityType!=='personalFleet'||
     controller.operatorKind!=='PERSONAL_FLEET'||
     controller.selectionKind!=='PERSONAL_FLEET'||
     controller.selectionID!==row.assignmentID||
     !['nativeAmbient','nativeCombat'].includes(controller.runtimeKind))
   return null;
  return {entity,controller};
 }
 function noPlayerShip(id){
  const all=sessions.getSessions();
  if(!Array.isArray(all))return false;
  return all.every(s=>!s||s.socket?.destroyed===true||
    ![s._space?.shipID,s.shipID,s.shipid,s.activeShipID].some(v=>
      v===id||String(v)===String(id)));
 }
 // PF101: source-owned physical actor markers are NOT optional. A numeric
 // ship ID + matching owner must not make a player, Mining, WAR or stale NPC
 // actor eligible for Personal Fleet re-adoption after a process restart.
 // These fields are written by the original PF58 stock ship materializer.
 function originalSceneShip(row,e){
  return obj(e)&&e.kind==='ship'&&e.itemID===row.shipItemID&&
   e.typeID===row.typeID&&
   e.nativeNpc===true&&e.nativeNpcOccupied===true&&
   e.npcEntityType==='personalFleet'&&e.transient!==true&&
   e.operatorKind==='PERSONAL_FLEET'&&
   e.selectionKind==='PERSONAL_FLEET'&&e.selectionID===row.assignmentID&&
   e.personalFleetOriginal===true&&
   e.personalFleetAssignmentID===row.assignmentID&&
   e.personalFleetPilotID===row.pilotID&&
   e.personalFleetGeneration===row.generation&&
   e.ownerID===row.ownerCharacterID&&
   e.characterID===0&&e.pilotCharacterID===0&&e.session==null;
 }
 function originalSceneController(row,c){
  return obj(c)&&c.entityID===row.shipItemID&&
   c.systemID===row.systemID&&c.transient!==true&&
   c.personalFleetOriginal===true&&
   c.personalFleetAssignmentID===row.assignmentID&&
   c.personalFleetPilotID===row.pilotID&&
   c.personalFleetGeneration===row.generation&&
   c.entityType==='personalFleet'&&c.operatorKind==='PERSONAL_FLEET'&&
   c.selectionKind==='PERSONAL_FLEET'&&c.selectionID===row.assignmentID&&
   ['nativeAmbient','nativeCombat'].includes(c.runtimeKind);
 }
 function physical(row,scene){
  return originalSceneShip(row,scene.getEntityByID(row.shipItemID))&&
   originalSceneController(row,registry.getControllerByEntityID(row.shipItemID));
 }
 function recoverOne(row){
  if(!live())return block('PF90_NATIVE_RECOVERY_FENCED');
  if(!pos(row.shipItemID)||!pos(row.systemID))return block('PF90_INVALID_DURABLE_ROW');
  const source=saved(row);
  if(!source)return block('PF90_MISSING_OR_FOREIGN_NATIVE_RECORD');
  const scene=runtime.scenes.get(row.systemID);
  if(!scene)return {status:'SCENE_PENDING',shipItemID:row.shipItemID};
  if(scene.systemID!==row.systemID||typeof scene.getEntityByID!=='function')
   return block('PF90_ORIGINAL_SCENE_IDENTITY_UNVERIFIED');
  if(!noPlayerShip(row.shipItemID))return block('PF90_PHYSICAL_PLAYER_SHIP_CONFLICT');
  try{
   for(const other of runtime.scenes.values()){
    if(other!==scene&&other?.getEntityByID?.(row.shipItemID))
     return block('PF90_SHIP_ALREADY_IN_ANOTHER_SCENE');
   }
   const occupant=scene.getEntityByID(row.shipItemID),
    controller=registry.getControllerByEntityID(row.shipItemID);
   const inFlight=String(source.entity.mode).toUpperCase()==='WARP'||
      source.entity.warpState||source.entity.pendingWarp||
      source.entity.isWarping===true;
   // Physical scene warp is NOT an independent PF56 durable return receipt.
   // When the original native row says STOP, never accept an unrelated
   // in-flight actor as ALREADY_PHYSICAL just because the IDs match.
   if(!inFlight&&occupant&&(String(occupant.mode).toUpperCase()==='WARP'||
      occupant.sessionlessWarpIngress!=null||occupant.pendingWarp||
      occupant.warpState||occupant.isWarping===true))
    return block('PF101_UNPROVEN_SCENE_WARP_CONFLICT');
   if(physical(row,scene)){
    if(!inFlight)return {status:'ALREADY_PHYSICAL',shipItemID:row.shipItemID};
    const restored=ingress.restore(row,scene);
    if(restored.status==='ALREADY_ORIGINAL_INGRESS')
     return {status:'ALREADY_PHYSICAL',shipItemID:row.shipItemID};
    if(restored.status==='RESTORED_ORIGINAL_INGRESS')
     return {status:'RESTORED_IN_FLIGHT',shipItemID:row.shipItemID};
    return block(restored.reason||'PF94_ORIGINAL_INGRESS_PROOF_UNAVAILABLE');
   }
   // Never mistake an already physically present warp for a lost warp.
   // If the original actor AND original controller are still on-grid and
   // verified, the real native runtime is already responsible for arrival.
   // Otherwise stock materialization cannot reconstruct ingress in mid-WARP,
   // so do not issue an independent warp on behalf of the player.
   // PF94 may reconstruct interpolation ONLY after the original SQLite
   // PF56 post-effect ACK, signed ingress snapshot and original owner
   // have been independently verified. Never send a new warp order.
   if(inFlight){
    const proven=ingress.inspect(row);
    if(proven.status!=='VERIFIED_ORIGINAL_INGRESS')
     return block(proven.reason||'PF94_IN_FLIGHT_WARP_NOT_DURABLY_PROVEN');
   }
   // A half-materialized original is repairable only when every existing
   // half is PF58-identical. Never overwrite a same-ID foreign physical actor
   // or a controller belonging to a different NPC director.
   if(occupant&&!originalSceneShip(row,occupant))
    return block('PF90_EXISTING_SCENE_OR_CONTROLLER_CONFLICT');
   if(controller&&!originalSceneController(row,controller))
    return block('PF90_EXISTING_SCENE_OR_CONTROLLER_CONFLICT');
   if(attempted.has(row.shipItemID))
    return block('PF90_UNKNOWN_PRIOR_MATERIALIZATION_OUTCOME');
   attempted.add(row.shipItemID);
   const result=nativeService.materializeStoredNativeController(scene,row.shipItemID,{broadcast:false});
   if(result?.success!==true||!physical(row,scene))
    return block('PF90_ORIGINAL_MATERIALIZATION_OUTCOME_UNCERTAIN');
   if(inFlight){
    const restored=ingress.restore(row,scene);
    if(!['RESTORED_ORIGINAL_INGRESS','ALREADY_ORIGINAL_INGRESS'].includes(restored.status))
     return block(restored.reason||'PF94_RESTORED_INGRESS_UNCERTAIN');
    return {status:'RESTORED_IN_FLIGHT',shipItemID:row.shipItemID};
   }
   return {status:'RESTORED_PHYSICAL',shipItemID:row.shipItemID};
  }catch{return block('PF90_MATERIALIZATION_THROWN_OUTCOME_UNCERTAIN');}
 }
 function recover(){
  if(!live())return block('PF90_RECOVERY_DISABLED');
  if(busy)return block('PF90_REENTRANT_RECOVERY');
  busy=true;
  try{
   const rows=snapshots();
   if(!Array.isArray(rows))return block('PF90_DURABLE_ROSTER_UNAVAILABLE');
   const result={status:'RECOVERY_RECONCILED',active:rows.length,
    restored:0,inFlightRestored:0,already:0,pending:0,blocked:0,issues:[]};
   const ids=new Set();
   for(const row of rows){
    if(ids.has(row.shipItemID))return block('PF90_DUPLICATE_DURABLE_SHIP');
    ids.add(row.shipItemID);
    const status=recoverOne(row);
    if(status.status==='RESTORED_PHYSICAL')result.restored++;
    else if(status.status==='RESTORED_IN_FLIGHT'){
     result.restored++;result.inFlightRestored++;
    }
    else if(status.status==='ALREADY_PHYSICAL')result.already++;
    else if(status.status==='SCENE_PENDING')result.pending++;
    else{
     result.blocked++;result.issues.push({
      shipItemID:row.shipItemID,reason:status.reason});
    }
   }
   if(result.blocked>0)result.status='NEEDS_OPERATOR_RECONCILIATION';
   return result;
  }catch{return block('PF90_ORIGINAL_ROSTER_SNAPSHOT_FAILED');}
  finally{busy=false;}
 }
 return Object.freeze({recover});
}
module.exports=Object.freeze({createOriginalPhysicalRecovery});
