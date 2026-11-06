'use strict';
/**
 * PF58 composition root for a REAL EveJS server bootstrap. Do not call from
 * client handlers. A caller must bind native inventory, runtime, controller,
 * equipment, lease and session authorities, not mock them in production.
 * Stock NPC service needs the PF58 source-pinned stock-fittings patch FIRST.
 * PF64: publish singleton bindings only AFTER all dependent constructors pass.
 */
const {createOriginalShipHandoff,validStockHangar}=require('./coopPersonalFleetOriginalShipHandoff.cjs');
const {createNativeShipAdoption}=require('./coopPersonalFleetNativeShipAdoption.cjs');
const {createPermitVerifier,createReciprocalWriterFence}=require('./coopPersonalFleetOriginalNativePermit.cjs');
const bindings=require('./coopPersonalFleetNativeBindings.cjs');
const pos=x=>Number.isSafeInteger(x)&&x>0;
// Session ship IDs may arrive from the original protocol as canonical strings.
const sameID=(value,id)=>value===id||(typeof value==='string'&&
 /^[1-9][0-9]*$/.test(value)&&Number(value)===id);
const obj=x=>x!==null&&typeof x==='object'&&!Array.isArray(x);
const vec=x=>obj(x)&&['x','y','z'].every(k=>typeof x[k]==='number'&&Number.isFinite(x[k]));
/**
 * PF87: original ItemStore ship title transfer UNDER the same native
 * GameStore BEGIN IMMEDIATE used by the PF58 consumed permit.
 *
 * This is a transaction-scoped stock row write, not a second ship or a
 * postcommit ItemStore call. Exact stock item identity must still be hangared.
 * Caller MUST separately fence player sessions and all other native writers.
 */
function moveOriginalShipToSpaceAtomically(row,spawn,tx){
 if(!pos(row?.shipItemID)||!pos(row?.ownerCharacterID)||
    !pos(row?.stationID)||!pos(row?.systemID)||!pos(row?.typeID)||
    spawn?.stationID!==row.stationID||spawn?.systemID!==row.systemID||
    spawn?.sessionless!==true||!vec(spawn.position)||!vec(spawn.direction)||
    typeof tx?.get!=='function'||typeof tx?.put!=='function')
  return {success:false,errorMsg:'PF87_ATOMIC_SOURCE_UNVERIFIED'};
 const items=tx.get('items','items');
 if(!obj(items)||!validStockHangar(items[String(row.shipItemID)],row))
  return {success:false,errorMsg:'PF87_ATOMIC_HANGAR_TITLE_CHANGED'};
 const original=items[String(row.shipItemID)];
 // This mirrors original ItemStore.normalizeSpaceState STOP defaults for
 // the first server-owned spawn while preserving all other original fields.
 const state={systemID:row.systemID,
  position:{...spawn.position},velocity:{x:0,y:0,z:0},
  direction:{...spawn.direction},targetPoint:null,speedFraction:0,
  mode:'STOP',targetEntityID:null,followRange:0,orbitDistance:0,
  orbitNormal:null,orbitSign:1,warpState:null,
  emergencyWarpReturnState:null};
 tx.put('items','items',{...items,[String(row.shipItemID)]:{
  ...original,locationID:row.systemID,flagID:0,spaceState:state}});
 return {success:true,shipItemID:row.shipItemID};
}
/**
 * PF86: read-only ORIGINAL registry/session/scene witnesses.
 * These readers are necessary checks, never proof of cross-writer fencing.
 * A missing, throwing or ambiguous read fails closed.
 */
function createOriginalPresenceReaders({sessionRegistry,npcRegistry,nativeNpcStore,spaceRuntime}={}){
 if(typeof sessionRegistry?.getSessions!=='function'||
    typeof npcRegistry?.getControllerByEntityID!=='function'||
    ['getNativeEntity','getNativeController','listNativeModulesForEntity',
     'listNativeCargoForEntity'].some(k=>typeof nativeNpcStore?.[k]!=='function')||
    typeof spaceRuntime?.scenes?.get!=='function'||
    typeof spaceRuntime?.scenes?.values!=='function')
  throw Error('PF86_ORIGINAL_PRESENCE_AUTHORITIES_REQUIRED');
 function noActivePlayerSession(row){
  if(!pos(row?.shipItemID)||!pos(row?.ownerCharacterID))return false;
  try{
   const live=sessionRegistry.getSessions();
   if(!Array.isArray(live))return false;
   for(const session of live){
    if(!obj(session))return false;
    if(session.socket?.destroyed===true)continue;
    // Session registry is the ORIGINAL live-session owner. The user may
    // remain logged in to hire NPCs, but may not occupy the reserved hull.
    const ids=[session._space?.shipID,session.shipID,session.shipid,
               session.activeShipID];
    if(ids.some(id=>sameID(id,row.shipItemID)))return false;
    // A logged-in owner's in-space session with an UNKNOWN ship ID is
    // not evidence that the original reserved ship is free.
    if(session.characterID===row.ownerCharacterID&&
       obj(session._space)&&!pos(session._space.shipID))return false;
   }
   return true;
  }catch{return false;}
 }
 function noExistingPhysicalActor(row){
  if(!pos(row?.shipItemID)||!pos(row?.systemID))return false;
  try{
   const mounted=spaceRuntime.scenes.get(row.systemID);
   if(!mounted||mounted.systemID!==row.systemID||
      typeof mounted.getEntityByID!=='function')return false;
   for(const scene of spaceRuntime.scenes.values()){
    if(!scene||typeof scene.getEntityByID!=='function')return false;
    if(scene.getEntityByID(row.shipItemID)!=null)return false;
   }
   if(npcRegistry.getControllerByEntityID(row.shipItemID)!==null)return false;
   if(nativeNpcStore.getNativeEntity(row.shipItemID)!==null||
      nativeNpcStore.getNativeController(row.shipItemID)!==null)return false;
   const mods=nativeNpcStore.listNativeModulesForEntity(row.shipItemID),
         cargo=nativeNpcStore.listNativeCargoForEntity(row.shipItemID);
   return Array.isArray(mods)&&mods.length===0&&
          Array.isArray(cargo)&&cargo.length===0;
  }catch{return false;}
 }
 return Object.freeze({noActivePlayerSession,noExistingPhysicalActor});
}
/**
 * The production-oriented entrypoint forbids caller-provided fake presence
 * callbacks: both are always derived from real server registries.
 * All other independent authorities remain mandatory and injected explicitly.
 */
function createSourceBoundNativeBootstrap({
 sessionRegistry,npcRegistry,verifyOriginalWriterHooks,...originalAuthorities
}={}){
 const presence=createOriginalPresenceReaders({
  sessionRegistry,npcRegistry,
  nativeNpcStore:originalAuthorities.nativeNpcStore,
  spaceRuntime:originalAuthorities.spaceRuntime});
 // PF88: no source-bound deployment until the independent ORIGINAL player,
 // Mining, WAR and Exploration entrypoint hooks attest their installation.
 // A plain historical allWritersFenced() callback is not enough.
 // This is a mandatory candidate gate, NOT cryptographic attestation.
 const previouslyFenced=originalAuthorities.allWritersFenced;
 const fenced=()=>typeof previouslyFenced==='function'&&
  typeof verifyOriginalWriterHooks==='function'&&
  previouslyFenced()===true&&verifyOriginalWriterHooks()===true;
 return createNativeBootstrap({...originalAuthorities,
  allWritersFenced:fenced,
  originalNoActiveSession:presence.noActivePlayerSession,
  originalNoPhysicalActor:presence.noExistingPhysicalActor,
  // Never permit the unsafe post-commit legacy stock move in the genuine
  // source-bound composition path, even if a caller asked for false.
  atomicOriginalTransfer:true});
}
function createNativeBootstrap({gameStore,pf52,originalItemStore,nativeNpcStore,
 nativeNpcService,spaceRuntime,resolveNativeProfile,resolveOwnerCorporation,
 originalStationUndockPoint,originalNoActiveSession,originalNoPhysicalActor,
 originalEquipmentWitness,originalOwnershipWitness,independentOriginalActorWitness,
 allWritersFenced=()=>false,enabled=()=>false,clock=()=>Date.now(),
 atomicOriginalTransfer=false}={}){
 if(!originalItemStore||typeof originalItemStore.findItemById!=='function'||
  typeof originalItemStore.moveShipToSpace!=='function'||
  nativeNpcService?.PF58_ORIGINAL_ITEMSTORE_BRIDGE_V1!==true||
  [resolveNativeProfile,resolveOwnerCorporation,originalStationUndockPoint,
   originalNoActiveSession,originalNoPhysicalActor,originalEquipmentWitness,
   originalOwnershipWitness,independentOriginalActorWitness,
   allWritersFenced,enabled,clock].some(x=>typeof x!=='function'))
  throw Error('PF58_ORIGINAL_BOOTSTRAP_AUTHORITIES_REQUIRED');
 const verifier=createPermitVerifier({gameStore,enabled,allWritersFenced});
 const foreignWriterFence=createReciprocalWriterFence({pf52});
 // First construct all side-effect-free adapters. A failure must never leave
 // bindings installed with only a subset of the required native authorities.
 const adoption=createNativeShipAdoption({nativeStore:nativeNpcStore,
  stockItems:originalItemStore,npcService:nativeNpcService,spaceRuntime,
  resolveNativeProfile,resolveOwnerCorporation,
  verifyCommittedPermit:row=>verifier.verify({allowIssuing:true,
   entityRecord:{personalFleetOriginal:true,entityID:row.shipItemID,
    systemID:row.systemID,ownerID:row.ownerCharacterID,typeID:row.typeID,
    personalFleetGeneration:row.generation,
    personalFleetAssignmentID:row.assignmentID,
    personalFleetPilotID:row.pilotID}}),
  allWritersFenced,enabled,clock});
 const native={
  verifyStationAndUndock:originalStationUndockPoint,
  noActivePlayerSession:originalNoActiveSession,
  noExistingPhysicalActor:originalNoPhysicalActor,
  moveOriginalShipToSpaceAtomically(row,spawn,tx){
   if(atomicOriginalTransfer!==true)
    return {success:false,errorMsg:'PF87_ATOMIC_MODE_DISABLED'};
   // All original side-effecting access to the stock item stays in tx:
   // original ItemStore is NOT called under the SQLite writer lock.
   if(enabled()!==true||allWritersFenced()!==true||
      gameStore?.coopAtomicNativeRows?.isPoisoned?.()!==false)
    return {success:false,errorMsg:'PF87_ATOMIC_AUTHORITY_REVOKED'};
   try{
    if(originalNoActiveSession(row)!==true||
       originalNoPhysicalActor(row)!==true||
       originalOwnershipWitness(row,tx)!==true)
      return {success:false,errorMsg:'PF87_ATOMIC_PRESENCE_CHANGED'};
    const eq=originalEquipmentWitness(row,tx);
    if(!eq||eq.fittingHash!==row.fittingHash||
       eq.cargoHash!==row.cargoHash)
      return {success:false,errorMsg:'PF87_ATOMIC_EQUIPMENT_CHANGED'};
    return moveOriginalShipToSpaceAtomically(row,spawn,tx);
   }catch{return {success:false,errorMsg:'PF87_ATOMIC_READ_OR_WRITE_UNKNOWN'};}
  },
  moveOriginalShipToSpace(row,spawn){
   if(atomicOriginalTransfer===true)
    return {success:false,errorMsg:'PF87_LEGACY_POSTCOMMIT_MOVE_DISABLED'};
   // PF86: the PF58 permit was already consumed. A login, ship swap,
   // physical spawn or inventory/title change since admission MUST NOT be
   // followed by an original ItemStore move. No retry or permit rollback.
   try{
    if(enabled()!==true||allWritersFenced()!==true||
       gameStore?.coopAtomicNativeRows?.isPoisoned?.()!==false)
      return {success:false,errorMsg:'PF86_PREWRITE_AUTHORITY_REVOKED'};
    if(originalNoActiveSession(row)!==true||
       originalNoPhysicalActor(row)!==true)
      return {success:false,errorMsg:'PF86_PREWRITE_PRESENCE_CHANGED'};
    if(!validStockHangar(originalItemStore.findItemById(row.shipItemID),row))
      return {success:false,errorMsg:'PF86_PREWRITE_ORIGINAL_SHIP_CHANGED'};
    const eq=originalEquipmentWitness(row);
    if(!eq||eq.fittingHash!==row.fittingHash||eq.cargoHash!==row.cargoHash)
      return {success:false,errorMsg:'PF86_PREWRITE_EQUIPMENT_CHANGED'};
   }catch{return {success:false,errorMsg:'PF86_PREWRITE_READ_UNCERTAIN'};}
   return originalItemStore.moveShipToSpace(row.shipItemID,row.systemID,{
    systemID:row.systemID,position:spawn.position,
    direction:spawn.direction,velocity:{x:0,y:0,z:0},mode:'STOP'});
  },
  readOriginalShip:originalItemStore.findItemById,
  adoptOriginalShipAsNpc:adoption.adoptOriginalShipAsNpc,
  inspectOriginalActor:independentOriginalActorWitness,
 };
 const handoff=createOriginalShipHandoff({gameStore,pf52,native,
  enabled,allWritersFenced,verifyExclusive:originalOwnershipWitness,
  verifyOriginalEquipment:originalEquipmentWitness,clock,
  requireAtomicOriginalTransfer:atomicOriginalTransfer===true});
 // The only non-local publish operation is LAST, and it must acknowledge true.
 // A failed/concurrent install never exposes a partially wired handoff.
 if(bindings.install({permitVerifier:verifier,allWritersFenced,featureEnabled:enabled})!==true)
  throw Error('PF64_BINDING_INSTALL_UNCONFIRMED');
 return Object.freeze({executeOriginalHandoff:handoff.execute,
  inspectHandoff:handoff.inspect,
  verifyNativePermit:verifier.verify,
  checkForeignWriterWithinTransaction:foreignWriterFence.inTransaction,
  mutateForeignOriginalItemsWithinTransaction:
   foreignWriterFence.mutateOriginalItemsInTransaction,
  commitStockOwnerSnapshotWithinTransaction:
   foreignWriterFence.commitOriginalOwnerSnapshot});
}
module.exports={createNativeBootstrap,createSourceBoundNativeBootstrap,
 createOriginalPresenceReaders,moveOriginalShipToSpaceAtomically};
