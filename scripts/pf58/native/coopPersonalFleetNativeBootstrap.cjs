'use strict';
/**
 * PF58 composition root for a REAL EveJS server bootstrap. Do not call from
 * client handlers. A caller must bind native inventory, runtime, controller,
 * equipment, lease and session authorities, not mock them in production.
 * Stock NPC service needs the PF58 source-pinned stock-fittings patch FIRST.
 * PF64: publish singleton bindings only AFTER all dependent constructors pass.
 */
const {createOriginalShipHandoff}=require('./coopPersonalFleetOriginalShipHandoff.cjs');
const {createNativeShipAdoption}=require('./coopPersonalFleetNativeShipAdoption.cjs');
const {createPermitVerifier}=require('./coopPersonalFleetOriginalNativePermit.cjs');
const bindings=require('./coopPersonalFleetNativeBindings.cjs');
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
module.exports={createNativeBootstrap};
