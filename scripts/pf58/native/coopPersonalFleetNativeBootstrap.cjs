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
const {createPermitVerifier}=require('./coopPersonalFleetOriginalNativePermit.cjs');
const bindings=require('./coopPersonalFleetNativeBindings.cjs');
const pos=x=>Number.isSafeInteger(x)&&x>0;
// Session ship IDs may arrive from the original protocol as canonical strings.
const sameID=(value,id)=>value===id||(typeof value==='string'&&
 /^[1-9][0-9]*$/.test(value)&&Number(value)===id);
const obj=x=>x!==null&&typeof x==='object'&&!Array.isArray(x);
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
    if(ids.some(id=>id===row.shipItemID))return false;
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
 sessionRegistry,npcRegistry,...originalAuthorities
}={}){
 const presence=createOriginalPresenceReaders({
  sessionRegistry,npcRegistry,
  nativeNpcStore:originalAuthorities.nativeNpcStore,
  spaceRuntime:originalAuthorities.spaceRuntime});
 return createNativeBootstrap({...originalAuthorities,
  originalNoActiveSession:presence.noActivePlayerSession,
  originalNoPhysicalActor:presence.noExistingPhysicalActor});
}
function createNativeBootstrap({gameStore,pf52,originalItemStore,nativeNpcStore,
 nativeNpcService,spaceRuntime,resolveNativeProfile,resolveOwnerCorporation,
 originalStationUndockPoint,originalNoActiveSession,originalNoPhysicalActor,
 originalEquipmentWitness,originalOwnershipWitness,independentOriginalActorWitness,
 allWritersFenced=()=>false,enabled=()=>false,clock=()=>Date.now()}={}){
 if(!originalItemStore||typeof originalItemStore.findItemById!=='function'||
  typeof originalItemStore.moveShipToSpace!=='function'||
  nativeNpcService?.PF58_ORIGINAL_ITEMSTORE_BRIDGE_V1!==true||
  [resolveNativeProfile,resolveOwnerCorporation,originalStationUndockPoint,
   originalNoActiveSession,originalNoPhysicalActor,originalEquipmentWitness,
   originalOwnershipWitness,independentOriginalActorWitness,
   allWritersFenced,enabled,clock].some(x=>typeof x!=='function'))
  throw Error('PF58_ORIGINAL_BOOTSTRAP_AUTHORITIES_REQUIRED');
 const verifier=createPermitVerifier({gameStore,enabled,allWritersFenced});
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
  moveOriginalShipToSpace(row,spawn){
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
  verifyOriginalEquipment:originalEquipmentWitness,clock});
 // The only non-local publish operation is LAST, and it must acknowledge true.
 // A failed/concurrent install never exposes a partially wired handoff.
 if(bindings.install({permitVerifier:verifier,allWritersFenced,featureEnabled:enabled})!==true)
  throw Error('PF64_BINDING_INSTALL_UNCONFIRMED');
 return Object.freeze({executeOriginalHandoff:handoff.execute,
  inspectHandoff:handoff.inspect,
  verifyNativePermit:verifier.verify});
}
module.exports={createNativeBootstrap,createSourceBoundNativeBootstrap,
 createOriginalPresenceReaders};
