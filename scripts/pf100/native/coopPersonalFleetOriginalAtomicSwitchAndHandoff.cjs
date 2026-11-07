'use strict';
/**
 * PF100B — REVIEW-ONLY original stock-player -> NPC handoff transaction.
 * Both original character title and original physical ItemStore ship move,
 * plus PF58 one-shot permit, are committed by ONE original GameStore owner.
 * Does not spawn an NPC, update a live session, consume a capsule or notify.
 * Not installed in EveJS. The native session mutation lease is still P0.
 */
const crypto=require('node:crypto');
const {isDeepStrictEqual}=require('node:util');
const permit=require('./coopPersonalFleetOriginalNativePermit.cjs');
const handoff=require('./coopPersonalFleetOriginalShipHandoff.cjs');
const {moveOriginalShipToSpaceAtomically}=require('./coopPersonalFleetNativeBootstrap.cjs');
const sessionSource=require('./coopPersonalFleetOriginalSessionWitness.js');
const T='corporationRuntime', I='items', C='characters', SEP='\u001f';
const P='coop-personal-fleet'+SEP;
const pos=x=>Number.isSafeInteger(x)&&x>0;
const obj=x=>x!==null&&typeof x==='object'&&!Array.isArray(x);
const block=reason=>Object.freeze({status:'BLOCKED',reason,mayRetryAutomatically:false});
const sha=x=>crypto.createHash('sha256').update(JSON.stringify(x)).digest('hex');
function strictJson(value){
 const copy=structuredClone(value),serialized=JSON.stringify(copy);
 if(typeof serialized!=='string')return null;
 const decoded=JSON.parse(serialized);
 return isDeepStrictEqual(copy,decoded)?decoded:null;
}
function currentShip(row){
 const aliases=[row.shipID,row.shipid,row.activeShipID].filter(x=>x!==null&&x!==undefined&&x!==0);
 if(!aliases.length)return 0;
 const parsed=aliases.map(x=>typeof x==='string'&&/^[1-9][0-9]*$/.test(x)?Number(x):x);
 return parsed.every(x=>pos(x)&&x===parsed[0])?parsed[0]:0;
}
function validReplacement(item,owner,station){
 // Capsule already exists; never manufacture a ship or ID during handoff.
 return obj(item)&&pos(item.itemID)&&item.ownerID===owner&&item.typeID===670&&
  item.categoryID===6&&item.singleton===1&&item.stacksize===1&&
  item.quantity===-1&&item.locationID===station&&item.flagID===4&&
  (item.spaceState===null||item.spaceState===undefined);
}
function createOriginalAtomicSwitchAndHandoff({gameStore,pf52,
 enabled=()=>false,allWritersFenced=()=>false,
 verifyExclusive=()=>false,verifyOriginalEquipment=()=>null,
 verifyNoPhysicalActor=()=>false,resolveOriginalUndock=()=>null,
 clock=()=>Date.now()}={}){
 const a=gameStore?.coopAtomicNativeRows;
 if(a?.mode!=='SERVER_INTERNAL_FLAGGED'||typeof a.transact!=='function'||
    typeof a.isPoisoned!=='function'||
    typeof pf52?.checkCompetingClaims!=='function'||
    typeof pf52?.REGISTRY_KEY!=='string'||typeof pf52?.ROSTER_PREFIX!=='string'||
    [enabled,allWritersFenced,verifyExclusive,verifyOriginalEquipment,
     verifyNoPhysicalActor,resolveOriginalUndock,clock].some(x=>typeof x!=='function'))
  throw Error('PF100B_NATIVE_OWNER_AUTHORITIES_MISSING');
 const replacementFence=permit.createReciprocalWriterFence({pf52});
 const gated=()=>process.env.EVEJS_COOP_PERSONAL_FLEET_NATIVE_WITNESS==='1'&&
   process.env.EVEJS_COOP_NATIVE_ATOMIC_ROWS==='1'&&
   process.env.EVEJS_COOP_PERSONAL_FLEET_ATOMIC_HANDOFF==='1'&&
   enabled()===true&&allWritersFenced()===true&&!a.isPoisoned();
 const readOnly=tx=>Object.freeze({
  get:(table,key)=>structuredClone(tx.get(table,key)),
  scan:table=>structuredClone(tx.scan(table))
 });
 function execute({session,pf54Row,replacementShipItemID,expectedCharacterBefore}={}){
  if(!gated())return block('PF100B_DISABLED_OR_WRITERS_UNFENCED');
  if(!handoff.validPF54(pf54Row)||!obj(session)||!pos(replacementShipItemID)||
      !obj(expectedCharacterBefore)||replacementShipItemID===pf54Row.shipItemID)
   return block('PF100B_UNTRUSTED_INPUT');
  let row,before;
  try{row=strictJson(pf54Row);before=strictJson(expectedCharacterBefore);}
  catch{return block('PF100B_UNSERIALIZABLE_INPUT');}
  if(!row||!before)return block('PF100B_UNSERIALIZABLE_INPUT');
  let result;
  try{
   result=a.transact([T,I,C],tx=>{
    if(!gated()||typeof tx.verifyReadOnlySessionWitness!=='function')
     throw Error('PF100B_ORIGINAL_TX_SESSION_OWNER_REQUIRED');
    const witness=Object.freeze({characterID:row.ownerCharacterID,
      previousShipItemID:row.shipItemID,stationID:row.stationID,session});
    const live=()=>tx.verifyReadOnlySessionWitness(
      sessionSource.verifyOriginalDockedPlayerSession,witness)===true;
    if(!live())return block('PF100B_LIVE_SOURCE_SESSION_UNVERIFIED');
    const stored=tx.get(T,P+'deploy-v1:'+row.assignmentID);
    if(!handoff.validPF54(stored)||!isDeepStrictEqual(stored,row))
     return block('PF100B_DURABLE_PF54_ROW_CHANGED');
    const consumed=tx.get(T,handoff.key(row.assignmentID)),
          locked=tx.get(T,handoff.shipKey(row.shipItemID));
    if(consumed===undefined||locked===undefined)
     return block('PF100B_HANDOFF_READ_UNCERTAIN');
    if(consumed!==null||locked!==null)
     return block('PF100B_HANDOFF_ALREADY_ATTEMPTED');
    const index=tx.get(T,pf52.REGISTRY_KEY),
          roster=tx.get(T,pf52.ROSTER_PREFIX+row.ownerCharacterID);
    if(!handoff.verifyReservation(index,roster,row))
     return block('PF100B_PF52_RESERVATION_UNVERIFIED');
    const current=tx.get(C,String(row.ownerCharacterID));
    if(!obj(current)||!isDeepStrictEqual(current,before)||
       currentShip(current)!==row.shipItemID)
     return block('PF100B_ACTIVE_ORIGINAL_SHIP_NOT_OWNED');
    const items=tx.get(I,'items');
    const source=obj(items)?items[String(row.shipItemID)]:null;
    const replacement=obj(items)?items[String(replacementShipItemID)]:null;
    if(!handoff.validStockHangar(source,row)||
       !validReplacement(replacement,row.ownerCharacterID,row.stationID)||
       replacement.itemID!==replacementShipItemID)
     return block('PF100B_PHYSICAL_HULL_OR_CAPSULE_INVALID');
    const scanOld=permit.inspectOriginalCharacterShipRows(tx,{
       ownerCharacterID:row.ownerCharacterID,shipItemID:row.shipItemID,
       allowOwnerAlreadyActive:true});
    const scanNew=permit.inspectOriginalCharacterShipRows(tx,{
       ownerCharacterID:row.ownerCharacterID,shipItemID:replacementShipItemID});
    if(scanOld.verified!==true||scanNew.verified!==true)
     return block('PF100B_PLAYER_SHIP_COLLISION');
    const free=replacementFence.inTransaction({tx,writer:'PLAYER',
       shipItemID:replacementShipItemID});
    if(free.mayCommit!==true)return block('PF100B_REPLACEMENT_CUSTODY_BLOCKED');
    const actors=tx.get(T,P+'actor-claims-v1');
    if(actors===undefined||actors!==null&&(!obj(actors)||!obj(actors.claims))||
       actors?.claims?.[String(row.shipItemID)]||
       Object.values(actors?.claims||{}).some(x=>x?.pilotID===row.pilotID))
      return block('PF100B_EXISTING_NATIVE_ACTOR_CLAIM');
    if(pf52.checkCompetingClaims(tx,row))
     return block('PF100B_COMPETING_ORIGINAL_CLAIMS');
    const evidence=()=>{
     const ro=readOnly(tx);
     const eq=verifyOriginalEquipment(structuredClone(row),ro);
     return verifyExclusive(structuredClone(row),ro)===true&&
       verifyNoPhysicalActor(structuredClone(row),ro)===true&&
       obj(eq)&&eq.fittingHash===row.fittingHash&&eq.cargoHash===row.cargoHash;
    };
    if(!evidence())return block('PF100B_ORIGINAL_OWNER_OR_EQUIPMENT_INVALID');
    const spawn=resolveOriginalUndock(structuredClone(row),readOnly(tx));
    const coords=x=>obj(x)&&['x','y','z'].every(k=>typeof x[k]==='number'&&Number.isFinite(x[k]));
    if(!obj(spawn)||spawn.stationID!==row.stationID||
       spawn.systemID!==row.systemID||spawn.sessionless!==true||
       !coords(spawn.position)||!coords(spawn.direction))
     return block('PF100B_UNDOCK_UNPROVEN');
    if(!live()||!gated()||!evidence())
     return block('PF100B_AUTHORITY_REVOKED_BEFORE_COMMIT');
    if(!isDeepStrictEqual(tx.get(C,String(row.ownerCharacterID)),before)||
       !isDeepStrictEqual(tx.get(I,'items'),items))
     throw Error('PF100B_AUTHORITY_CHANGED_INSIDE_TX_ROLLBACK');
    const at=clock();if(!pos(at))return block('PF100B_CLOCK_INVALID');
    const next=structuredClone(current);
    next.shipID=replacementShipItemID;
    next.shipTypeID=replacement.typeID;
    next.shipName=replacement.itemName??null;
    if(Object.prototype.hasOwnProperty.call(next,'shipid'))next.shipid=replacementShipItemID;
    if(Object.prototype.hasOwnProperty.call(next,'activeShipID'))next.activeShipID=replacementShipItemID;
    if(Object.prototype.hasOwnProperty.call(next,'storedShips'))delete next.storedShips;
    tx.put(C,String(row.ownerCharacterID),next);
    const moved=moveOriginalShipToSpaceAtomically(row,spawn,tx);
    if(moved?.success!==true||!handoff.validStockSpace(
        tx.get(I,'items')?.[String(row.shipItemID)],row))
     throw Error('PF100B_ORIGINAL_STOCK_MOVE_UNPROVEN_ROLLBACK');
    const record={version:1,status:'CONSUMED',operationID:row.operationID,
      assignmentID:row.assignmentID,shipItemID:row.shipItemID,
      ownerCharacterID:row.ownerCharacterID,pilotID:row.pilotID,
      stationID:row.stationID,systemID:row.systemID,
      generation:row.generation,sourcePF54Hash:sha(row),
      fittingHash:row.fittingHash,cargoHash:row.cargoHash,consumedAtMs:at};
    tx.put(T,handoff.key(row.assignmentID),record);
    tx.put(T,handoff.shipKey(row.shipItemID),{
      assignmentID:row.assignmentID,sourcePF54Hash:sha(row)});
    if(!isDeepStrictEqual(tx.get(C,String(row.ownerCharacterID)),next)||
        !isDeepStrictEqual(tx.get(T,handoff.key(row.assignmentID)),record))
     throw Error('PF100B_COMMIT_READBACK_UNPROVEN_ROLLBACK');
    return Object.freeze({status:'DURABLE_TX_APPLIED',mayRetryAutomatically:false,
      characterID:row.ownerCharacterID,oldShipItemID:row.shipItemID,
      replacementShipItemID,assignmentID:row.assignmentID});
   });
  }catch{
   // Unknown commit status can never be interpreted as permission to retry.
   return Object.freeze({status:'OUTCOME_UNKNOWN',reason:'PF100B_COMMIT_OR_CACHE_UNKNOWN',
     mayRetryAutomatically:false});
  }
  if(result?.status!=='DURABLE_TX_APPLIED')return result;
  return Object.freeze({...result,status:'COMMITTED_PENDING_SESSION_AND_NPC_RECONCILE'});
 }
 return Object.freeze({execute});
}
module.exports=Object.freeze({createOriginalAtomicSwitchAndHandoff,validReplacement});
