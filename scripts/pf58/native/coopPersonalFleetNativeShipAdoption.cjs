'use strict';
/**
 * PF58 original stock-ship -> native controller adapter.
 * Original ItemStore title is never replaced. No ship ID, module ID, cargo ID,
 * entity ID or wallet entry allocated here. Never invoke a native NPC spawn
 * factory: its allocator and synthetic loadout duplicate physical property.
 *
 * Requires source-pinned coopNativeNpcService stock-fittings patch and a
 * PF58 durable CONSUMED permit committed before this function is called.
 * Partial original writes are OUTCOME_UNKNOWN; manual readback, never retry.
 * The initial controller is non-combat: ATTACK/DEFEND only after separate
 * authoritative stock ammo and combat reconciliation is implemented.
 */
const {validStockSpace}=require('./coopPersonalFleetOriginalShipHandoff.cjs');
const pos=x=>Number.isSafeInteger(x)&&x>0;
const obj=x=>x!==null&&typeof x==='object'&&!Array.isArray(x);
const vec=x=>obj(x)&&['x','y','z'].every(k=>typeof x[k]==='number'&&Number.isFinite(x[k]));
const err=reason=>({success:false,errorMsg:reason});
const copy=x=>structuredClone(x);
function createNativeShipAdoption({nativeStore,stockItems,npcService,spaceRuntime,
 resolveNativeProfile,resolveOwnerCorporation,verifyCommittedPermit,
 allWritersFenced=()=>false,enabled=()=>false,clock=()=>Date.now()}={}){
 if(!nativeStore||!stockItems||!npcService||!spaceRuntime||
  ['getNativeEntity','getNativeController','listNativeModulesForEntity','listNativeCargoForEntity',
   'upsertNativeEntity','upsertNativeController'].some(k=>typeof nativeStore[k]!=='function')||
  typeof stockItems.findItemById!=='function'||
  typeof npcService.materializeStoredNativeController!=='function'||
  !spaceRuntime.scenes||typeof spaceRuntime.scenes.get!=='function'||
  [resolveNativeProfile,resolveOwnerCorporation,verifyCommittedPermit,
   allWritersFenced,enabled,clock].some(f=>typeof f!=='function'))
   throw Error('PF58_NATIVE_ADOPTION_DEPENDENCIES_REQUIRED');
 const on=()=>enabled()===true&&allWritersFenced()===true&&
   npcService.PF58_ORIGINAL_ITEMSTORE_BRIDGE_V1===true;
 function adoptOriginalShipAsNpc(row,stockSnapshot){
  if(!on())return err('PF58_NATIVE_ADOPTION_OFF_OR_UNPATCHED');
  if(!row||!pos(row.shipItemID)||!pos(row.ownerCharacterID)||
     !pos(row.systemID)||!pos(row.typeID)||!pos(row.generation)||
     !obj(stockSnapshot)||stockSnapshot.itemID!==row.shipItemID)
    return err('PF58_NATIVE_ADOPTION_INPUT_INVALID');
  if(verifyCommittedPermit(copy(row))!==true)
    return err('PF58_DURABLE_PERMIT_NOT_PROVEN');
  const ship=stockItems.findItemById(row.shipItemID);
  if(!validStockSpace(ship,row)||JSON.stringify(ship)!==JSON.stringify(stockSnapshot))
    return err('PF58_ORIGINAL_STOCK_SHIP_NOT_IN_SPACE');
  const scene=spaceRuntime.scenes.get(row.systemID);
  if(!scene||scene.systemID!==row.systemID||typeof scene.getEntityByID!=='function')
    return err('PF58_SCENE_NOT_MOUNTED');
  if(scene.getEntityByID(row.shipItemID))
    return err('PF58_PHYSICAL_SHIP_ALREADY_PRESENT');
  if(nativeStore.getNativeEntity(row.shipItemID)||nativeStore.getNativeController(row.shipItemID))
    return err('PF58_NATIVE_ROW_ALREADY_PRESENT');
  const moduleRows=nativeStore.listNativeModulesForEntity(row.shipItemID);
  const cargoRows=nativeStore.listNativeCargoForEntity(row.shipItemID);
  if(!Array.isArray(moduleRows)||!Array.isArray(cargoRows)||
    moduleRows.length||cargoRows.length)
    return err('PF58_FOREIGN_NATIVE_MODULE_OR_CARGO');
  const definition=resolveNativeProfile(copy(row));
  if(!obj(definition)||!obj(definition.profile)||!obj(definition.loadout)||
    !obj(definition.behaviorProfile)||
    definition.profile.shipTypeID!==row.typeID||
    !definition.profile.profileID||!definition.loadout.loadoutID||
    !definition.behaviorProfile.behaviorProfileID)
    return err('PF58_NATIVE_HULL_PROFILE_UNVERIFIED');
  const corporationID=resolveOwnerCorporation(row.ownerCharacterID);
  if(!pos(corporationID))return err('PF58_OWNER_CORPORATION_UNVERIFIED');
  const at=clock();if(!pos(at))return err('PF58_CLOCK_INVALID');
  if(!vec(ship.spaceState?.position))return err('PF58_ORIGINAL_POSITION_UNVERIFIED');
  const position=copy(ship.spaceState.position),
    direction=vec(ship.spaceState.direction)?copy(ship.spaceState.direction):{x:1,y:0,z:0};
  const record={entityID:row.shipItemID,systemID:row.systemID,
    profileID:definition.profile.profileID,
    loadoutID:definition.loadout.loadoutID,
    behaviorProfileID:definition.behaviorProfile.behaviorProfileID,
    lootTableID:null,entityType:'personalFleet',npcEntityType:'personalFleet',
    typeID:ship.typeID,groupID:Number(ship.groupID)||0,categoryID:6,
    itemName:String(ship.itemName||'Personal Fleet Ship'),radius:Number(ship.radius)||100,
    slimTypeID:ship.typeID,slimGroupID:Number(ship.groupID)||0,
    slimCategoryID:6,slimName:String(ship.itemName||'Personal Fleet Ship'),
    ownerID:row.ownerCharacterID,corporationID,allianceID:0,warFactionID:0,
    securityStatus:0,bounty:0,nativeNpc:true,nativeNpcOccupied:true,
    personalFleetOriginal:true,personalFleetAssignmentID:row.assignmentID,
    personalFleetPilotID:row.pilotID,personalFleetGeneration:row.generation,
    transient:false,operatorKind:'PERSONAL_FLEET',
    selectionKind:'PERSONAL_FLEET',selectionID:row.assignmentID,
    createdAtMs:at,position,velocity:{x:0,y:0,z:0},direction,targetPoint:position,
    mode:'STOP',speedFraction:0,targetEntityID:0,followRange:0,orbitDistance:0,
    conditionState:copy(ship.conditionState||{}),
    fittedStockItemID:row.shipItemID};
  const controller={entityID:row.shipItemID,systemID:row.systemID,
    profileID:definition.profile.profileID,
    loadoutID:definition.loadout.loadoutID,
    behaviorProfileID:definition.behaviorProfile.behaviorProfileID,
    definitionSnapshot:copy(definition),
    behaviorOverrides:{allowWeapons:false,allowPodKill:false},
    selectionKind:'PERSONAL_FLEET',selectionID:row.assignmentID,
    operatorKind:'PERSONAL_FLEET',
    entityType:'personalFleet',transient:false,runtimeKind:'nativeAmbient',
    homePosition:position,homeDirection:direction,nextThinkAtMs:Number.MAX_SAFE_INTEGER,
    currentTargetID:0,preferredTargetID:0,returningHome:false,
    personalFleetOriginal:true,personalFleetAssignmentID:row.assignmentID,
    personalFleetPilotID:row.pilotID,personalFleetGeneration:row.generation};
  // One-shot external original writes. If any step fails, caller's durable
  // PF58 permit prevents all automatic retries: do not rollback or cascade.
  try{
    if(verifyCommittedPermit(copy(row))!==true||!on())
      return err('PF58_NATIVE_ADOPTION_GATE_REVOKED');
    const w1=nativeStore.upsertNativeEntity(record,{transient:false});
    if(w1?.success!==true)return err('PF58_NATIVE_ENTITY_WRITE_UNKNOWN');
    const w2=nativeStore.upsertNativeController(controller,{transient:false});
    if(w2?.success!==true)return err('PF58_NATIVE_CONTROLLER_WRITE_UNKNOWN');
    if(verifyCommittedPermit(copy(row))!==true||!on())
      return err('PF58_NATIVE_MATERIALIZATION_GATE_REVOKED');
    const physical=npcService.materializeStoredNativeController(scene,row.shipItemID,
      {broadcast:true,skipInitialBehaviorTick:true,personalFleetIssuing:true});
    if(physical?.success!==true||!obj(physical?.data))
      return err('PF58_NATIVE_RUNTIME_OUTCOME_UNKNOWN');
    const identity=scene.getEntityByID(row.shipItemID),
      re=nativeStore.getNativeEntity(row.shipItemID),
      rc=nativeStore.getNativeController(row.shipItemID);
    if(identity?.itemID!==row.shipItemID||identity?.nativeNpc!==true||
       identity?.ownerID!==row.ownerCharacterID||
       re?.entityID!==row.shipItemID||re?.personalFleetOriginal!==true||
       rc?.entityID!==row.shipItemID||rc?.personalFleetOriginal!==true)
       return err('PF58_NATIVE_READBACK_MISMATCH');
    // Original fitted/cargo title is STILL in ItemStore; no native duplicates.
    if(nativeStore.listNativeCargoForEntity(row.shipItemID).length||
       nativeStore.listNativeModulesForEntity(row.shipItemID).length)
       return err('PF58_NATIVE_ITEM_CLONE_DETECTED');
    return {success:true,data:{entityID:row.shipItemID,controllerEntityID:row.shipItemID,
      originalShipItemID:row.shipItemID,requiresPF54Reconcile:true,
      combatEnabled:false}};
  }catch{return err('PF58_NATIVE_ADOPTION_EXCEPTION_OUTCOME_UNKNOWN');}
 }
 return Object.freeze({adoptOriginalShipAsNpc});
}
module.exports={createNativeShipAdoption};
