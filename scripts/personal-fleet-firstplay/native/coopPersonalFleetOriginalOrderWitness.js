'use strict';
/**
 * Read-only source-owned NPC physical order authority. NOT an order executor.
 * Imports original EveJS GameStore, stock item/ship scene, original native
 * NPC entity/store/controller and the already staged PF78 actor witness.
 * Never issues an NPC command, reconstructs an actor or mints an item.
 * Original shared NPC arbiter must separately admit PERSONAL_FLEET.
 */
const gameStore = require('../gameStore');
const nativeStore = require('./npc/nativeNpcStore');
const registry = require('./npc/npcRegistry');
const runtime = require('./runtime');
const sessions = require('../services/chat/sessionRegistry');
const pf52 = require('./coopPersonalFleetHangarBridge');
const {matchesOriginalPersonalFleetActor} = require('./coopPersonalFleetNativeActorProof');
const T='corporationRuntime', SEP='\u001f', F='coop-personal-fleet'+SEP;
const positive=x=>Number.isSafeInteger(x)&&x>0;
const object=x=>x!==null&&typeof x==='object'&&!Array.isArray(x);
const token=x=>typeof x==='string'&&/^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/.test(x);
function createOriginalOrderWitness({combatAuthority=null,enabled=()=>false,allWritersFenced=()=>false}={}) {
 const atomic=gameStore.coopAtomicNativeRows;
 if(atomic?.mode!=='SERVER_INTERNAL_FLAGGED'||typeof atomic.transact!=='function'||
    typeof atomic.isPoisoned!=='function'||
    typeof nativeStore.getNativeEntity!=='function'||
    typeof nativeStore.getNativeController!=='function'||
    typeof registry.getControllerByEntityID!=='function'||
    typeof runtime.scenes?.get!=='function'||
    typeof sessions.getSessions!=='function'||
    typeof pf52.validateIndex!=='function'||typeof pf52.validateRoster!=='function'||
    typeof matchesOriginalPersonalFleetActor!=='function'||
    [enabled,allWritersFenced].some(x=>typeof x!=='function'))
  throw Error('PF_FIRSTPLAY_ORIGINAL_ORDER_SOURCE_NOT_INSTALLED');
 const on=()=>enabled()===true&&allWritersFenced()===true&&atomic.isPoisoned()===false;
 function readActor(c,tx){
  if(!on()||!object(c)||!object(tx)||typeof tx.get!=='function'||
     !positive(c.shipItemID)||!positive(c.ownerCharacterID)||
     !positive(c.systemID)||!positive(c.actorGeneration)||
     !token(c.assignmentID)||!/^coop-pilot-[0-9]{3,}$/.test(c.pilotID))return null;
  const dep=tx.get(T,F+'deploy-v1:'+c.assignmentID);
  const claims=tx.get(T,F+'actor-claims-v1');
  const idx=tx.get(T,pf52.REGISTRY_KEY);
  const roster=tx.get(T,pf52.ROSTER_PREFIX+c.ownerCharacterID);
  const item=tx.get('items',String(c.shipItemID));
  if(!object(dep)||dep.phase!=='ACTIVE'||
     !object(claims)||!object(idx)||!object(roster)||!object(item))return null;
  try{pf52.validateIndex(idx);pf52.validateRoster(roster,c.ownerCharacterID);}catch{return null;}
  const original=idx.ships[String(c.shipItemID)],pilot=roster.pilots[c.pilotID];
  const claim=claims.claims?.[String(c.shipItemID)];
  if(dep.assignmentID!==c.assignmentID||dep.shipItemID!==c.shipItemID||
     dep.ownerCharacterID!==c.ownerCharacterID||dep.systemID!==c.systemID||
     dep.pilotID!==c.pilotID||dep.actorGeneration!==c.actorGeneration||
     !positive(dep.generation)||
     original?.ownerCharacterID!==c.ownerCharacterID||
     original?.pilotID!==c.pilotID||original?.assignmentID!==c.assignmentID||
     original?.generation!==dep.generation||
     pilot?.pilotID!==c.pilotID||pilot?.contractID!==dep.contractID||
     pilot?.assignmentID!==c.assignmentID||pilot?.shipItemID!==c.shipItemID||
     pilot?.generation!==dep.generation||pilot?.status!=='HANGAR_RESERVED'||
     claim?.ownerType!=='PERSONAL_FLEET'||claim?.entityID!==c.shipItemID||
     claim?.pilotID!==c.pilotID||claim?.ownerCharacterID!==c.ownerCharacterID||
     claim?.assignmentID!==c.assignmentID||claim?.systemID!==c.systemID||
     claim?.generation!==c.actorGeneration||
     claims.generations?.[String(c.shipItemID)]!==c.actorGeneration||
     item?.itemID!==c.shipItemID||item?.ownerID!==c.ownerCharacterID||
     item?.categoryID!==6||item?.locationID!==c.systemID||item?.flagID!==0||
     item?.typeID!==dep.typeID||item?.spaceState?.systemID!==c.systemID)return null;
  const scene=runtime.scenes.get(c.systemID);
  const entity=scene?.getEntityByID?.(c.shipItemID);
  const controller=registry.getControllerByEntityID(c.shipItemID);
  const storedEntity=nativeStore.getNativeEntity(c.shipItemID),
    storedController=nativeStore.getNativeController(c.shipItemID);
  if(scene?.systemID!==c.systemID||
     matchesOriginalPersonalFleetActor({...c,reservationGeneration:dep.generation},entity,controller)!==true||
     storedEntity?.entityID!==c.shipItemID||storedEntity?.systemID!==c.systemID||
     storedEntity?.ownerID!==c.ownerCharacterID||storedEntity?.personalFleetOriginal!==true||
     storedEntity?.personalFleetAssignmentID!==c.assignmentID||
     storedEntity?.personalFleetPilotID!==c.pilotID||
     storedEntity?.personalFleetGeneration!==dep.generation||
     storedController?.entityID!==c.shipItemID||
     storedController?.systemID!==c.systemID||
     storedController?.personalFleetOriginal!==true||
     storedController?.personalFleetAssignmentID!==c.assignmentID||
     storedController?.personalFleetPilotID!==c.pilotID||
     storedController?.personalFleetGeneration!==dep.generation||
     scene.getEntityByID(c.shipItemID)!==entity)return null;
  return {scene,entity,controller,item,dep};
 }
 function verifyNativeActor(c,tx){try{return readActor(c,tx)!==null;}catch{return false;}}
 function verifyOriginalControl(c,tx){
  try{
   const x=readActor(c,tx);
   if(!x)return false;
   const order=String(x.controller.manualOrder?.type||'').toLowerCase();
   // PF97: a GUARD that already physically follows its own owner's
   // player ship may retaliate against the verified native attacker only
   // if its PREVIOUS PF55 DEFEND command is genuinely ACKED. This is the
   // only allowed FOLLOW->ATTACK transition for a live named NPC.
   if(c.action==='ATTACK'&&order==='follow'){
    const previous=tx.get(T,F+'manual-order-v1:'+c.shipItemID);
    const index=tx.get(T,F+'manual-order-operations-v1');
    const manual=x.controller.manualOrder;
    const canonical=require('./coopPersonalFleetNativeOrders');
    return previous?.phase==='ACKED'&&previous.action==='DEFEND'&&
      previous.shipItemID===c.shipItemID&&
      previous.ownerCharacterID===c.ownerCharacterID&&
      previous.pilotID===c.pilotID&&
      previous.assignmentID===c.assignmentID&&
      previous.actorGeneration===c.actorGeneration&&
      previous.signature===canonical.signature(previous)&&
      index?.operations?.[previous.operationID]?.phase==='ACKED'&&
      index.operations[previous.operationID].signature===previous.signature&&
      manual?.targetID===previous.targetEntityID&&
      manual.allowWeapons===false&&
      manual.allowPodKill!==true&&
      combatAuthority?.verify(c,tx)===true;
   }
   // For first play, never let an existing combat order compete with FOLLOW/HOLD.
   if(x.controller.runtimeKind==='nativeAmbient'&&
      !['attack','defend','warp'].includes(order))return true;
   // PF95: after original ATTACK/GUARD effect, the stock controller
   // legitimately changes to nativeCombat. Only the EXACT still-ISSUING
   // PF55 operation can be reconciled, not any competing new order.
   if(!['ATTACK','DEFEND'].includes(c.action)||!combatAuthority||
      combatAuthority.verify(c,tx)!==true)return false;
   const pending=tx.get(T,F+'manual-order-v1:'+c.shipItemID);
   if(pending?.phase!=='ISSUING'||pending.operationID!==c.operationID||
      pending.signature!==require('./coopPersonalFleetNativeOrders').signature(c)||
      pending.action!==c.action||pending.targetEntityID!==c.targetEntityID)
     return false;
   if(c.action==='ATTACK')return order==='attack'&&
      x.controller.manualOrder?.targetID===c.targetEntityID&&
      x.controller.manualOrder?.allowWeapons===true;
   return order==='follow'&&
      x.controller.manualOrder?.targetID===c.targetEntityID&&
      x.controller.manualOrder?.allowWeapons===false;
  }catch{return false;}
 }
 function verifyTarget(c,tx){
  if(!on())return false;
  if(['ATTACK','DEFEND'].includes(c?.action))
   return typeof combatAuthority?.verify==='function'&&
      combatAuthority.verify(c,tx)===true;
  if(!['FOLLOW','HOLD'].includes(c?.action))return false;
  if(c.action==='HOLD')return c.targetEntityID==null&&verifyNativeActor(c,tx);
  if(!positive(c.targetEntityID)||c.targetEntityID===c.shipItemID)return false;
  try{
   const x=readActor(c,tx);
   if(!x)return false;
   const active=sessions.getSessions();
   if(!Array.isArray(active))return false;
   const owner=active.filter(s=>s?.characterID===c.ownerCharacterID);
   if(owner.length!==1||owner[0].socket?.destroyed!==false)return false;
   const player=owner[0];
   if(player._space?.shipID!==c.targetEntityID||
      player._space?.systemID!==c.systemID||
      player._space?.initialStateSent!==true)return false;
   const row=tx.get('characters',String(c.ownerCharacterID));
   const target=tx.get('items',String(c.targetEntityID));
   const entity=x.scene.getEntityByID(c.targetEntityID);
   if(row?.characterID!==c.ownerCharacterID||row?.accountId!==player.userid||
      row?.shipID!==c.targetEntityID||
      target?.itemID!==c.targetEntityID||target?.ownerID!==c.ownerCharacterID||
      target?.categoryID!==6||target?.flagID!==0||
      target?.locationID!==c.systemID||
      !entity||entity.kind!=='ship'||entity.itemID!==c.targetEntityID||
      entity.nativeNpc===true||entity.transient===true||
      entity.session!==player)return false;
   return on()&&x.scene.getEntityByID(c.targetEntityID)===entity;
  }catch{return false;}
 }
 function verifyPersonalClaim(row){
  if(!on()||!object(row))return false;
  try{return atomic.transact([T,'items'],tx=>readActor(row,tx)!==null)===true;}
  catch{return false;}
 }
 return Object.freeze({verifyNativeActor,verifyOriginalControl,verifyTarget,verifyPersonalClaim});
}
module.exports=Object.freeze({createOriginalOrderWitness});
