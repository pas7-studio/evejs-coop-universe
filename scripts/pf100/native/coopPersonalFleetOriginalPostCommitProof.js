'use strict';
/**
 * PF100: source-bound, read-only post-COMMIT proof for stock player boarding.
 * Review candidate for Code/server/src/space/. NEVER a durable commit receipt.
 * Must be called only after PF91 returned from original GameStore.transact.
 * No ItemStore changes, client emissions or new ship IDs occur here.
 */
const registry = require('../services/chat/sessionRegistry');
const docking = require('../services/structure/structureLocation');
const own = (o,k) => Object.prototype.hasOwnProperty.call(o,k);
const obj = x => x !== null && typeof x === 'object' && !Array.isArray(x);
const id = x => {
 if(typeof x==='number')return Number.isSafeInteger(x)&&x>0?x:0;
 if(typeof x!=='string'||!/^[1-9][0-9]*$/.test(x))return 0;
 const n=Number(x);return Number.isSafeInteger(n)?n:0;
};
function alias(o,keys,allowMissing=false) {
 if(!obj(o)) return null;
 const seen=[];
 for(const key of keys) {
  if(!own(o,key) || o[key]===null || o[key]===undefined || o[key]===0)continue;
  const n=typeof o[key]==='string' && /^[1-9][0-9]*$/.test(o[key]) ? Number(o[key]) : o[key];
  if(!id(n))return null;
  seen.push(n);
 }
 if(!seen.length)return allowMissing?0:null;
 return seen.every(n=>n===seen[0])?seen[0]:null;
}
const block = reason => Object.freeze({status:'BLOCKED',reason,mayPublish:false});
function verifyOriginalPostCommitCore(request,reader) {
 if(process.env.EVEJS_COOP_PERSONAL_FLEET_NATIVE_WITNESS!=='1' ||
    process.env.EVEJS_COOP_NATIVE_ATOMIC_ROWS!=='1')
  return block('PF100_NATIVE_OWNER_DISABLED');
 if(!obj(request)||!obj(request.session)||typeof reader?.get!=='function')
  return block('PF100_AUTHORITY_REQUIRED');
 const {session,characterID,targetShipItemID,previousShipID,stationID,activationResult}=request;
 if(!id(characterID)||!id(targetShipItemID)||!id(stationID)||
    !id(previousShipID) ||
    targetShipItemID===previousShipID ||
    !obj(activationResult)||activationResult.status!=='APPLIED_IN_ORIGINAL_SQLITE_TRANSACTION'||
    activationResult.mayCommit!==true||activationResult.characterID!==characterID||
    activationResult.targetShipItemID!==targetShipItemID||
    activationResult.previousShipID!==previousShipID||activationResult.stationID!==stationID)
  return block('PF100_COMMIT_RECEIPT_INVALID');
 if(!obj(session.socket)||session.socket.destroyed!==false||
    alias(session,['characterID','charID','charid'])!==characterID||
    !id(session.userid))
  return block('PF100_LIVE_SESSION_INVALID');
 let sessions;
 try{sessions=registry.getSessions();}
 catch{return block('PF100_REGISTRY_UNAVAILABLE');}
 try {
  if(!Array.isArray(sessions)||sessions.filter(s=>
    alias(s,['characterID','charID','charid'])===characterID).length!==1||
    !sessions.includes(session)||
    registry.findSessionByCharacterID(characterID)!==session)
   return block('PF100_SESSION_REVOKED_OR_DUPLICATED');
 }catch{return block('PF100_REGISTRY_UNAVAILABLE');}
 const station=alias(session,['stationid','stationID','stationId'],true),
       structure=alias(session,['structureid','structureID','structureId'],true);
 if(station===null||structure===null||Boolean(station)===Boolean(structure)||
    (station||structure)!==stationID)
  return block('PF100_SESSION_DOCK_CHANGED');
 try{
  if(docking.getSessionStationID(session)!==station||
     docking.getSessionStructureID(session)!==structure||
     docking.getDockedLocationID(session)!==stationID)
   return block('PF100_ORIGINAL_DOCK_INVALID');
 }catch{return block('PF100_ORIGINAL_DOCK_UNAVAILABLE');}
 let row,items;
 try{row=reader.get('characters',String(characterID));items=reader.get('items','items');}
 catch{return block('PF100_COMMITTED_READ_UNAVAILABLE');}
 if(!obj(row)||row.isDeleted===true||
    (own(row,'characterID')&&row.characterID!==characterID)||
    alias(row,['accountId'])!==id(session.userid)||
    alias(row,['stationID','stationid'],true)!==station||
    alias(row,['structureID','structureid'],true)!==structure||
    alias(row,['shipID','shipid','activeShipID'])!==targetShipItemID)
  return block('PF100_COMMITTED_CHARACTER_DIVERGED');
 const target=obj(items)?items[String(targetShipItemID)]:null;
 if(!obj(target)||target.itemID!==targetShipItemID||target.ownerID!==characterID||
    target.categoryID!==6||target.singleton!==1||target.flagID!==4||
    target.locationID!==stationID||!id(target.typeID)||
    row.shipTypeID!==target.typeID||
    (target.itemName!==undefined && row.shipName!==target.itemName))
  return block('PF100_COMMITTED_PHYSICAL_SHIP_DIVERGED');
 const sessionShip=alias(session,['shipID','shipid','activeShipID']);
 if(sessionShip!==previousShipID&&sessionShip!==targetShipItemID)
  return block('PF100_SESSION_SHIP_CHANGED');
 const phase=sessionShip===targetShipItemID?'ALREADY_SYNCED':'READY_FOR_NATIVE_SESSION_APPLY';
 return Object.freeze({status:phase,mayPublish:phase==='READY_FOR_NATIVE_SESSION_APPLY',
   characterID,previousShipID,targetShipItemID,stationID});
}
function verifyOriginalPostCommitPlayerShip(request,reader) {
 try{return verifyOriginalPostCommitCore(request,reader);}
 catch{return block('PF100_UNEXPECTED_AUTHORITY_EXCEPTION');}
}
module.exports=Object.freeze({verifyOriginalPostCommitPlayerShip});
