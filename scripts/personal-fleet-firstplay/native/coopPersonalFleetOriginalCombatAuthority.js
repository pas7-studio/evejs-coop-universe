'use strict';
/**
 * PF95 original EveJS combat authorization. The stock behavior loop owns
 * combat legality; Personal Fleet MUST NOT invent independent faction,
 * criminal, safety, or NPC hostility rules. Never attack a player by default.
 */
const gameStore=require('../gameStore');
const runtime=require('./runtime');
const registry=require('./npc/npcRegistry');
const nativeStore=require('./npc/nativeNpcStore');
const npcBehavior=require('./npc/npcBehaviorLoop');
const pf52=require('./coopPersonalFleetHangarBridge');
const damage=require('./coopPersonalFleetOriginalGuardAggression');
const T='corporationRuntime',ITEMS='items',F='coop-personal-fleet\u001f';
const pos=v=>Number.isSafeInteger(v)&&v>0;
const obj=v=>v!==null&&typeof v==='object'&&!Array.isArray(v);
function createOriginalCombatAuthority({enabled=()=>false,allWritersFenced=()=>false}={}){
 const atomic=gameStore?.coopAtomicNativeRows;
 const validTarget=npcBehavior?.__testing?.isValidCombatTarget;
 if(atomic?.mode!=='SERVER_INTERNAL_FLAGGED'||
    typeof atomic.transact!=='function'||typeof atomic.isPoisoned!=='function'||
    typeof runtime.scenes?.get!=='function'||
    typeof registry.getControllerByEntityID!=='function'||
    typeof nativeStore.getNativeEntity!=='function'||
    typeof nativeStore.getNativeController!=='function'||
    typeof pf52.validateIndex!=='function'||typeof pf52.validateRoster!=='function'||
    typeof validTarget!=='function'||typeof enabled!=='function'||
    typeof allWritersFenced!=='function')
  throw Error('PF95_ORIGINAL_COMBAT_AUTHORITIES_REQUIRED');
 const on=()=>enabled()===true&&allWritersFenced()===true&&atomic.isPoisoned()===false;
 function verify(row,tx){
  if(!on()||!obj(row)||!obj(tx)||typeof tx.get!=='function'||
     !['ATTACK','DEFEND'].includes(row.action)||
     !pos(row.shipItemID)||!pos(row.targetEntityID)||row.shipItemID===row.targetEntityID||
     !pos(row.ownerCharacterID)||!pos(row.systemID)||!pos(row.actorGeneration)||
     typeof row.assignmentID!=='string'||!/^coop-pilot-[0-9]{3,}$/.test(row.pilotID))
   return false;
  try{
   const scene=runtime.scenes.get(row.systemID),ship=scene?.getEntityByID?.(row.shipItemID),
    target=scene?.getEntityByID?.(row.targetEntityID),
    actor=registry.getControllerByEntityID(row.shipItemID),
    stock=nativeStore.getNativeEntity(row.shipItemID),
    controller=nativeStore.getNativeController(row.shipItemID),
    dep=tx.get(T,F+'deploy-v1:'+row.assignmentID),
    claims=tx.get(T,F+'actor-claims-v1'),
    index=tx.get(T,pf52.REGISTRY_KEY),
    roster=tx.get(T,pf52.ROSTER_PREFIX+row.ownerCharacterID),
    item=tx.get(ITEMS,String(row.shipItemID));
   if(scene?.systemID!==row.systemID||ship?.kind!=='ship'||
      ship.nativeNpc!==true||ship.transient===true||ship.session!=null||
      ship.itemID!==row.shipItemID||ship.ownerID!==row.ownerCharacterID||
      actor?.entityID!==row.shipItemID||actor.systemID!==row.systemID||
      actor.personalFleetOriginal!==true||
      actor.personalFleetAssignmentID!==row.assignmentID||
      actor.personalFleetPilotID!==row.pilotID||
      stock?.entityID!==row.shipItemID||
      stock.personalFleetOriginal!==true||
      stock.personalFleetAssignmentID!==row.assignmentID||
      stock.personalFleetPilotID!==row.pilotID||
      controller?.entityID!==row.shipItemID||
      controller.personalFleetOriginal!==true||
      controller.personalFleetAssignmentID!==row.assignmentID||
      controller.personalFleetPilotID!==row.pilotID||
      dep?.phase!=='ACTIVE'||dep.shipItemID!==row.shipItemID||
      dep.ownerCharacterID!==row.ownerCharacterID||
      dep.actorGeneration!==row.actorGeneration||
      claims?.claims?.[String(row.shipItemID)]?.ownerType!=='PERSONAL_FLEET'||
      claims.claims[String(row.shipItemID)].generation!==row.actorGeneration||
      !obj(index)||!obj(roster))return false;
   pf52.validateIndex(index);pf52.validateRoster(roster,row.ownerCharacterID);
   if(index.ships?.[String(row.shipItemID)]?.assignmentID!==row.assignmentID||
      roster.pilots?.[row.pilotID]?.shipItemID!==row.shipItemID||
      item?.itemID!==row.shipItemID||item.ownerID!==row.ownerCharacterID||
      item.categoryID!==6||item.locationID!==row.systemID||
      ship.mode==='WARP'||ship.pendingWarp||ship.warpState||ship.isWarping===true||
      target?.itemID!==row.targetEntityID||target.kind!=='ship'||
      target.transient===true||target.mode==='WARP'||
      target.pendingWarp||target.warpState||target.isWarping===true)return false;
   if(row.action==='DEFEND'){
    // Guard follows the owner's *physical* ship, never a client-supplied
    // player target and never fires on the protected ship.
    const character=tx.get('characters',String(row.ownerCharacterID));
    return pos(row.followRangeMeters)&&row.followRangeMeters>=500&&
      row.followRangeMeters<=100000&&
      target.ownerID===row.ownerCharacterID&&
      target.nativeNpc!==true&&
      character?.characterID===row.ownerCharacterID&&
      character.shipID===row.targetEntityID&&
      target.session?.characterID===row.ownerCharacterID&&
      target.session?.socket?.destroyed===false&&
      scene.getEntityByID(row.targetEntityID)===target;
   }
   // ATTACK: only a genuine non-player NPC vessel already legal under
   // stock combat policy. No pods, CONCORD, named fleet allies, miners,
   // friendly ships, or rogue player PvP permissions.
   const targetController=registry.getControllerByEntityID(row.targetEntityID);
   if(row.followRangeMeters!==null&&row.followRangeMeters!==undefined||
      target.session!=null||target.nativeNpc!==true||
      String(target.npcEntityType).toLowerCase()!=='npc'||
      target.ownerID===row.ownerCharacterID||
      targetController?.entityID!==row.targetEntityID||
      targetController.systemID!==row.systemID||
      targetController.personalFleetOriginal===true||
      (pos(ship.corporationID)&&pos(target.corporationID)&&
       ship.corporationID===target.corporationID)||
      // Even if some wider original faction/combat rule calls a target
      // hostile, Personal Fleet cannot steal another co-op director's
      // WAR, MINING, PATROL, GATE or allied civilian NPC physical hull.
      ['WAR','PERSONAL_FLEET','MINING','CIVILIAN','EXPEDITION','GATE','PATROL','CONCORD'].includes(
       String(targetController.operatorKind||'').toUpperCase()))
    return false;
   if(validTarget(ship,target,{allowPodKill:false})===true)
    return on()&&scene.getEntityByID(row.targetEntityID)===target;
   // The stock NPC-on-NPC hostility veto is normally absolute.
   // PF97's ONLY narrow exception is an authentic recent damaging native
   // aggressor of this player's present ship. The original behavior-loop
   // source patch independently checks the same incident and PF55 order
   // before any actual module fires.
   const ownerShipID=tx.get('characters',String(row.ownerCharacterID))?.shipID;
   if(!pos(ownerShipID))return false;
   const hit=damage.read({ownerCharacterID:row.ownerCharacterID,
    ownerShipItemID:ownerShipID,systemID:row.systemID});
   return hit?.source==='EVEJS_ORIGINAL_KILLMAIL_APPLIED_DAMAGE_V1'&&
    hit.attackerEntityID===row.targetEntityID&&
    on()&&scene.getEntityByID(row.targetEntityID)===target;
  }catch{return false;}
 }
 return Object.freeze({verify});
}
module.exports=Object.freeze({createOriginalCombatAuthority});
