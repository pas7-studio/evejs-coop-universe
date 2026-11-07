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
module.exports=Object.freeze({note,read});
