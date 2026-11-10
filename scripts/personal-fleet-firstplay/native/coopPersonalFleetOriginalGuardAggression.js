'use strict';
/**
 * PF97: passive source-of-truth DAMAGE evidence for a player being attacked.
 * Called ONLY by stock combat/killmailTracker.noteDamage AFTER applied damage.
 * Never issues orders or pays rewards from the damage callback.
 */
const sessions=require('../services/chat/sessionRegistry');
const runtime=require('./runtime');
const registry=require('./npc/npcRegistry');
const positive=x=>Number.isSafeInteger(x)&&x>0;
const real=x=>typeof x==='number'&&Number.isFinite(x)&&x>0;
const evidence=new Map(),MAX=256,TTL=120000;
const on=()=>process.env.EVEJS_COOP_PERSONAL_FLEET_NATIVE==='1'&&
 process.env.EVEJS_COOP_PERSONAL_FLEET_CHAT==='1'&&
 process.env.EVEJS_COOP_NATIVE_ATOMIC_ROWS==='1';
const key=(owner,ship)=>owner+':'+ship;
function inspect(attacker,target,amount,at,ownerWanted=null){
 if(!on()||!real(amount)||!positive(at)||
   attacker?.kind!=='ship'||attacker?.nativeNpc!==true||
   attacker?.transient===true||attacker.session!=null||
   String(attacker.npcEntityType||'').toLowerCase()!=='npc'||
   target?.kind!=='ship'||target?.nativeNpc===true||
   target?.transient===true||!positive(attacker.itemID)||
   !positive(target.itemID)||attacker.itemID===target.itemID||
   !positive(attacker.systemID)||attacker.systemID!==target.systemID)
  return null;
 const all=sessions.getSessions();
 if(!Array.isArray(all)||all.length>512)return null;
 const holders=all.filter(s=>s?.socket?.destroyed===false&&
   s?._space?.initialStateSent===true&&
   s._space.shipID===target.itemID&&
   s._space.systemID===target.systemID&&
   positive(s.characterID)&&positive(s.userid)&&
   (ownerWanted===null||s.characterID===ownerWanted));
 if(holders.length!==1||holders[0]!==target.session||target.ownerID!==holders[0].characterID)
  return null;
 const scene=runtime.getSceneForSession(holders[0]);
 if(scene?.systemID!==target.systemID||
   scene.getEntityByID?.(target.itemID)!==target||
   scene.getEntityByID?.(attacker.itemID)!==attacker)
  return null;
 const ctrl=registry.getControllerByEntityID(attacker.itemID);
 if(ctrl?.entityID!==attacker.itemID||ctrl.systemID!==target.systemID||
    ctrl.personalFleetOriginal===true||
    ctrl.operatorKind==='PERSONAL_FLEET'||ctrl.operatorKind==='WAR')
  return null;
 return {ownerCharacterID:holders[0].characterID,ownerShipItemID:target.itemID,
  systemID:target.systemID,attackerEntityID:attacker.itemID,atMs:at,
  attacker,playerShip:target,session:holders[0],scene};
}
function prune(now){
 for(const [k,v]of evidence)if(now-v.atMs>TTL||now<v.atMs)evidence.delete(k);
 while(evidence.size>MAX)evidence.delete(evidence.keys().next().value);
}
function note(attacker,target,appliedDamage){
 if(!on())return {status:'DISABLED'};
 const now=Date.now(),match=inspect(attacker,target,appliedDamage,now);
 if(!match)return {status:'NO_VERIFIED_NATIVE_AGGRESSION'};
 prune(now);
 evidence.set(key(match.ownerCharacterID,match.ownerShipItemID),match);
 return Object.freeze({status:'ORIGINAL_APPLIED_PLAYER_DAMAGE',
  ownerCharacterID:match.ownerCharacterID,ownerShipItemID:match.ownerShipItemID,
  systemID:match.systemID,attackerEntityID:match.attackerEntityID,atMs:now});
}
function read({ownerCharacterID,ownerShipItemID,systemID}={}){
 if(!on()||![ownerCharacterID,ownerShipItemID,systemID].every(positive))
  return null;
 const now=Date.now();prune(now);
 const found=evidence.get(key(ownerCharacterID,ownerShipItemID));
 if(!found||found.systemID!==systemID)return null;
 const current=inspect(found.attacker,found.playerShip,1,now,ownerCharacterID);
 if(!current||current.session!==found.session||current.scene!==found.scene||
   current.attackerEntityID!==found.attackerEntityID)return null;
 return Object.freeze({source:'EVEJS_ORIGINAL_KILLMAIL_APPLIED_DAMAGE_V1',
  ownerCharacterID,ownerShipItemID,systemID,
  attackerEntityID:found.attackerEntityID,damageAtMs:found.atMs});
}
function listRecent(){
 if(!on())return [];
 prune(Date.now());
 const out=[];
 for(const w of evidence.values()){
  const r=read({ownerCharacterID:w.ownerCharacterID,
   ownerShipItemID:w.ownerShipItemID,systemID:w.systemID});
  if(r)out.push(r);
  if(out.length>=32)break;
 }
 return out;
}
// PF97 narrow ORIGINAL behavior-loop exception: after a real hit on our
// physical player ship, a genuinely issued Personal Fleet retaliation may
// target precisely THAT native NPC. No player, friendly NPC or arbitrary
// attack order obtains permission here.
function allowsRetaliation(source,target){
 if(!on()||source?.kind!=='ship'||target?.kind!=='ship'||
    source.nativeNpc!==true||source.personalFleetOriginal!==true||
    target.nativeNpc!==true||target.personalFleetOriginal===true||
    String(target.npcEntityType||'').toLowerCase()!=='npc'||
    !positive(source.itemID)||!positive(target.itemID)||
    source.itemID===target.itemID||
    !positive(source.ownerID)||!positive(source.systemID)||
    target.systemID!==source.systemID||
    target.transient===true||target.session!=null||
    (positive(source.corporationID)&&
     source.corporationID===target.corporationID))return false;
 const owner=source.ownerID;
 const evt=[...evidence.values()].find(x=>x.ownerCharacterID===owner&&
    x.attackerEntityID===target.itemID&&
    x.systemID===source.systemID&&x.attacker===target);
 if(!evt||Date.now()-evt.atMs>TTL||
    !read({ownerCharacterID:owner,ownerShipItemID:evt.ownerShipItemID,
      systemID:source.systemID}))return false;
 try{
  const store=require('../gameStore'),pf55=require('./coopPersonalFleetNativeOrders'),
   nativeStore=require('./npc/nativeNpcStore');
  const atomic=store.coopAtomicNativeRows;
  if(atomic?.mode!=='SERVER_INTERNAL_FLAGGED'||atomic.isPoisoned()||
     typeof atomic.transact!=='function')return false;
  const controller=registry.getControllerByEntityID(source.itemID);
  if(controller?.entityID!==source.itemID||
     controller.personalFleetOriginal!==true||
     controller.manualOrder?.type!=='attack'||
     controller.manualOrder.targetID!==target.itemID||
     controller.manualOrder.allowWeapons!==true||
     controller.manualOrder.allowPodKill===true||
     controller.operatorKind==='WAR')return false;
  const stock=nativeStore.getNativeEntity(source.itemID);
  if(stock?.personalFleetOriginal!==true||stock.ownerID!==owner||
     stock.systemID!==source.systemID||
     stock.personalFleetAssignmentID!==controller.personalFleetAssignmentID||
     stock.personalFleetPilotID!==controller.personalFleetPilotID)return false;
  return atomic.transact(['corporationRuntime','items'],tx=>{
   const T='corporationRuntime',F='coop-personal-fleet\u001f',
    row=tx.get(T,pf55.key(source.itemID)),
    op=tx.get(T,pf55.OP_INDEX)?.operations?.[row?.operationID],
    claims=tx.get(T,F+'actor-claims-v1'),
    claim=claims?.claims?.[String(source.itemID)],
    dep=tx.get(T,F+'deploy-v1:'+row?.assignmentID),
    original=tx.get('items','items')?.[String(source.itemID)];
   return !!row&&['ISSUING','ACKED'].includes(row.phase)&&
    row.action==='ATTACK'&&row.targetEntityID===target.itemID&&
    row.shipItemID===source.itemID&&row.ownerCharacterID===owner&&
    row.systemID===source.systemID&&
    row.signature===pf55.signature(row)&&op?.phase===row.phase&&
    op.signature===row.signature&&
    row.assignmentID===controller.personalFleetAssignmentID&&
    row.pilotID===controller.personalFleetPilotID&&
    dep?.phase==='ACTIVE'&&dep.actorGeneration===row.actorGeneration&&
    claim?.ownerType==='PERSONAL_FLEET'&&
    claim.entityID===source.itemID&&claim.ownerCharacterID===owner&&
    claim.generation===row.actorGeneration&&
    original?.itemID===source.itemID&&original.ownerID===owner&&
    original.categoryID===6&&original.locationID===source.systemID;
  })===true;
 }catch{return false;}
}
module.exports=Object.freeze({note,read,listRecent,allowsRetaliation});
