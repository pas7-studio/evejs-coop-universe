'use strict';
/**
 * REAL EVEJS SOURCE BINDINGS, not mock/externally provided authorization.
 * Installed only from Code/server/src/space/ in original native WORK.
 * The caller cannot substitute sessionRegistry, GameStore, stock stations,
 * CharacterState or native scene. Never makes an NPC or moves an item.
 */
const gameStore=require('../gameStore');
const sessionRegistry=require('../services/chat/sessionRegistry');
const locations=require('../services/structure/structureLocation');
const stations=require('../services/_shared/stationStaticData');
const corporations=require('../services/corporation/corporationState');
const spaceRuntime=require('./runtime');
const pos=x=>Number.isSafeInteger(x)&&x>0;
const obj=x=>x!==null&&typeof x==='object'&&!Array.isArray(x);
function createOriginalSourceBindings(){
 const atomic=gameStore.coopAtomicNativeRows;
 if(atomic?.mode!=='SERVER_INTERNAL_FLAGGED'||
    typeof atomic.transact!=='function'||typeof atomic.isPoisoned!=='function'||
    typeof sessionRegistry.getSessions!=='function'||
    typeof sessionRegistry.findSessionByCharacterID!=='function'||
    typeof locations.getSessionStationID!=='function'||
    typeof locations.getSessionStructureID!=='function'||
    typeof stations.getStationRecord!=='function'||
    typeof corporations.getCorporationRecord!=='function')
  throw Error('PF_FIRSTPLAY_SOURCE_BOUND_EVEJS_SERVICES_REQUIRED');
 function liveIdentity(session,owner){
  if(!obj(session)||!pos(owner)||session.characterID!==owner||
     !pos(session.userid)||!session.socket||session.socket.destroyed!==false||
     session.charid!==undefined&&session.charid!==owner||
     session.charID!==undefined&&session.charID!==owner)return false;
  const active=sessionRegistry.getSessions();
  if(!Array.isArray(active)||active.filter(s=>s===session).length!==1||
     active.filter(s=>s?.characterID===owner).length!==1||
     sessionRegistry.findSessionByCharacterID(owner)!==session)return false;
  return true;
 }
 function rowIsOwner(session,owner,tx){
  const r=tx.get('characters',String(owner));
  return obj(r)&&r.characterID===owner&&r.accountId===session.userid&&
   r.isDeleted!==true&&(!pos(r.shipID)||
     [session.shipID,session.shipid,session.activeShipID,
      session._space?.shipID].filter(pos).every(x=>x===r.shipID));
 }
 const access=Object.freeze({isOwner(session,owner,tx=null){
  if(atomic.isPoisoned()||!liveIdentity(session,owner))return false;
  try{
   if(tx)return rowIsOwner(session,owner,tx)&&liveIdentity(session,owner);
   return atomic.transact(['characters'],original=>
     rowIsOwner(session,owner,original)&&liveIdentity(session,owner))===true;
  }catch{return false;}
 }});
 function verifiedDock({session,owner}){
  const s=locations.getSessionStationID(session);
  if(!pos(s)||locations.getSessionStructureID(session)>0)return null;
  if(!access.isOwner(session,owner))return null;
  let data;
  try{data=stations.getStationRecord(session,s);}catch{return null;}
  if(!obj(data)||data.stationID!==s||!pos(data.solarSystemID))return null;
  let original;
  try{original=atomic.transact(['characters'],tx=>tx.get('characters',String(owner)));}
  catch{return null;}
  if(!obj(original)||original.stationID!==s||
     !rowIsOwner(session,owner,{get:()=>original})||!liveIdentity(session,owner))return null;
  return Object.freeze({stationID:s,systemID:data.solarSystemID,originalNativeVerified:true});
 }
 function originalFollowTarget(session,owner,systemID){
  if(!access.isOwner(session,owner)||!pos(systemID)||
     typeof spaceRuntime.getSceneForSession!=='function'||
     !obj(session._space)||session._space.initialStateSent!==true||
     session._space.systemID!==systemID||!pos(session._space.shipID)||
     locations.getSessionStationID(session)>0||
     locations.getSessionStructureID(session)>0)return null;
  const ship=session._space.shipID;
  let source;
  try{source=atomic.transact(['characters','items'],tx=>{
   const r=tx.get('characters',String(owner));
   const item=tx.get('items',String(ship));
   return obj(r)&&r.shipID===ship&&rowIsOwner(session,owner,tx)&&
     obj(item)&&item.itemID===ship&&item.ownerID===owner&&
     item.categoryID===6&&item.locationID===systemID&&item.flagID===0;
  });}catch{return null;}
  if(source!==true||!liveIdentity(session,owner))return null;
  let scene,entity;
  try{scene=spaceRuntime.getSceneForSession(session);
   entity=scene?.getEntityByID?.(ship);}catch{return null;}
  if(scene?.systemID!==systemID||entity?.kind!=='ship'||entity.nativeNpc===true||
     entity.itemID!==ship||entity.transient===true)return null;
  return Object.freeze({shipItemID:ship,systemID,nativeVerified:true});
 }
 // Only original SQLite character ownership, not an impersonated player
 // session or an operator-provided ACL, may extend a paid owner's return.
 // A changed account owner / deleted character fails closed.
 function verifyServerReturnOwner(row,tx){
  if(atomic.isPoisoned()||!obj(row)||!obj(tx)||typeof tx.get!=='function'||
     !pos(row.ownerCharacterID)||!pos(row.requestedByAccountID)||
     typeof row.operationID!=='string'||typeof row.assignmentID!=='string')
   return false;
  try{
   const original=tx.get('characters',String(row.ownerCharacterID));
   return obj(original)&&original.characterID===row.ownerCharacterID&&
     original.accountId===row.requestedByAccountID&&
     original.isDeleted!==true;
  }catch{return false;}
 }
 function resolveOwnerCorporation(owner){
  if(!pos(owner)||atomic.isPoisoned())return null;
  let row;
  try{row=atomic.transact(['characters'],tx=>tx.get('characters',String(owner)));}
  catch{return null;}
  if(!obj(row)||row.characterID!==owner||row.isDeleted===true||
     !pos(row.corporationID))return null;
  let corporation;
  try{corporation=corporations.getCorporationRecord(row.corporationID);}catch{return null;}
  return corporation?.corporationID===row.corporationID?row.corporationID:null;
 }
 return Object.freeze({gameStore,access,
   resolveOriginalDockContext:(session,owner)=>verifiedDock({session,owner}),
   resolveOriginalFollowTarget:originalFollowTarget,
   verifyServerReturnOwner,resolveOwnerCorporation});
}
module.exports=Object.freeze({createOriginalSourceBindings});
