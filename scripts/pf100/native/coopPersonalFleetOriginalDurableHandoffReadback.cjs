'use strict';
/** PF100C: operator/read-only original durable PF100B recovery inspection.
 * No session/actor mutation, replay token, network output or client API.
 * Must be called only by the original server operator's native owner.
 */
const crypto=require('node:crypto');
const {isDeepStrictEqual}=require('node:util');
const handoff=require('./coopPersonalFleetOriginalShipHandoff.cjs');
const {validReplacement}=require('./coopPersonalFleetOriginalAtomicSwitchAndHandoff.cjs');
const T='corporationRuntime', C='characters', I='items', P='coop-personal-fleet\u001f';
const obj=x=>x!==null&&typeof x==='object'&&!Array.isArray(x);
const pos=x=>Number.isSafeInteger(x)&&x>0;
const TOKEN=/^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/;
const hash=x=>crypto.createHash('sha256').update(JSON.stringify(x)).digest('hex');
const block=reason=>Object.freeze({status:'UNVERIFIED',reason,mayRetryAutomatically:false,maySpawn:false,mayPublish:false});
function createOriginalDurableHandoffInspector({gameStore}={}){
 const owner=gameStore?.coopAtomicNativeRows;
 if(owner?.mode!=='SERVER_INTERNAL_FLAGGED'||typeof owner.transact!=='function'||
    typeof owner.isPoisoned!=='function')
  throw Error('PF100C_ORIGINAL_GAMESTORE_OWNER_REQUIRED');
 function inspect({assignmentID,ownerCharacterID,oldShipItemID,replacementShipItemID}={}){
  if(!TOKEN.test(assignmentID)||!pos(ownerCharacterID)||!pos(oldShipItemID)||
     !pos(replacementShipItemID)||oldShipItemID===replacementShipItemID)
   return block('PF100C_IDENTIFIERS_INVALID');
  if(owner.isPoisoned())return block('PF100C_GAMESTORE_POISONED');
  try{
   return owner.transact([T,C,I],tx=>{
    const deploy=tx.get(T,P+'deploy-v1:'+assignmentID),
          permit=tx.get(T,handoff.key(assignmentID)),
          lock=tx.get(T,handoff.shipKey(oldShipItemID));
    if(deploy===undefined||permit===undefined||lock===undefined)
     return block('PF100C_DURABLE_ROWS_UNREADABLE');
    if(deploy===null&&permit===null&&lock===null)
     return Object.freeze({status:'NO_MATCHING_DURABLE_OPERATION',
      mayRetryAutomatically:false,maySpawn:false,mayPublish:false});
    if(!handoff.validPF54(deploy)||!obj(permit)||!obj(lock)||
       permit.status!=='CONSUMED'||permit.version!==1||
       deploy.assignmentID!==assignmentID||deploy.ownerCharacterID!==ownerCharacterID||
       deploy.shipItemID!==oldShipItemID||
       permit.assignmentID!==assignmentID||permit.shipItemID!==oldShipItemID||
       permit.ownerCharacterID!==ownerCharacterID||
       permit.operationID!==deploy.operationID||permit.pilotID!==deploy.pilotID||
       permit.stationID!==deploy.stationID||permit.systemID!==deploy.systemID||
       permit.generation!==deploy.generation||permit.fittingHash!==deploy.fittingHash||
       permit.cargoHash!==deploy.cargoHash||
       permit.sourcePF54Hash!==hash(deploy)||
       lock.assignmentID!==assignmentID||lock.sourcePF54Hash!==hash(deploy))
     return block('PF100C_DURABLE_PERMIT_CONFLICT');
    const char=tx.get(C,String(ownerCharacterID)),items=tx.get(I,'items');
    const source=obj(items)?items[String(oldShipItemID)]:null,
          replacement=obj(items)?items[String(replacementShipItemID)]:null;
    if(!obj(char)||(char.characterID!==undefined&&char.characterID!==ownerCharacterID)||
       char.shipID!==replacementShipItemID||char.shipTypeID!==670||
       (replacement?.itemName!==undefined&&char.shipName!==replacement.itemName)||
       !validReplacement(replacement,ownerCharacterID,deploy.stationID)||
       replacement.itemID!==replacementShipItemID||
       !handoff.validStockSpace(source,deploy))
     return block('PF100C_CHARACTER_OR_PHYSICAL_TITLE_DIVERGED');
    const scan=tx.scan(C);
    if(!Array.isArray(scan)||scan.length<1||scan.length>250000)
     return block('PF100C_CHARACTER_ROWSET_UNVERIFIED');
    const seen=new Set();let found=0;
    for(const e of scan){
     const key=e?.key,row=e?.value;
     if(typeof key!=='string'||!/^[1-9][0-9]*$/.test(key)||
        String(Number(key))!==key||!obj(row)||seen.has(key)||
        (row.characterID!==undefined&&row.characterID!==Number(key)))
      return block('PF100C_INVALID_CHARACTER_ROWSET');
     seen.add(key);
     if(key===String(ownerCharacterID)){
      found++;if(!isDeepStrictEqual(row,char))
       return block('PF100C_OWNER_READBACK_CHANGED');
     }
     const aliases=[row.shipID,row.shipid,row.activeShipID].filter(x=>x!==null&&x!==undefined&&x!==0);
     const ids=aliases.map(x=>typeof x==='string'&&/^[1-9][0-9]*$/.test(x)?Number(x):x);
     if(ids.some(id=>!pos(id))||new Set(ids).size>1)
      return block('PF100C_CHARACTER_SHIP_ALIASES_INVALID');
     if(ids.includes(oldShipItemID)||
        key!==String(ownerCharacterID)&&ids.includes(replacementShipItemID))
      return block('PF100C_COMPETING_PLAYER_SHIP_TITLE');
    }
    if(found!==1)return block('PF100C_OWNER_ROW_MISSING');
    return Object.freeze({status:'DURABLE_PLAYER_RELEASE_AND_HULL_TRANSFER_CONFIRMED',
      assignmentID,ownerCharacterID,oldShipItemID,replacementShipItemID,
      systemID:deploy.systemID,stationID:deploy.stationID,
      mayRetryAutomatically:false,maySpawn:false,mayPublish:false,
      next:'SOURCE_OWNED_SESSION_AND_NPC_EFFECT_RECONCILIATION_REQUIRED'});
   });
  }catch{return block('PF100C_ORIGINAL_READ_OR_COMMIT_OUTCOME_UNKNOWN');}
 }
 return Object.freeze({inspect});
}
module.exports=Object.freeze({createOriginalDurableHandoffInspector});
