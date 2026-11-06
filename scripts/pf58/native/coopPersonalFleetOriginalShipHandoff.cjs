'use strict';
/**
 * PF58: server-internal, one-shot ORIGINAL player ship -> native NPC handoff.
 * Only callable from PF54's already-committed ISSUING callback. The same stock
 * ship itemID becomes the native entityID, never an allocator-generated NPC.
 *
 * Native side-effects cannot share the GameStore transaction that reserves the
 * handoff permit. Consequently the PERMIT is committed FIRST and is never
 * automatically freed/retried; a crash anywhere requires native reconciliation.
 *
 * INERT by default. No new wallet, ship, module or cargo records are created.
 */
const crypto=require('node:crypto');
const T='corporationRuntime',ITEMS='items',SEP='\u001f';
const PREFIX='coop-personal-fleet'+SEP+'handoff-v1:';
const SHIP_PREFIX='coop-personal-fleet'+SEP+'handoff-ship-v1:';
const ACTORS='coop-personal-fleet'+SEP+'actor-claims-v1';
const TOKEN=/^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/;
const PILOT=/^coop-pilot-[0-9]{3,}$/;
const SHA=/^[a-f0-9]{64}$/;
const pos=x=>Number.isSafeInteger(x)&&x>0;
const obj=x=>x!==null&&typeof x==='object'&&!Array.isArray(x);
const deny=(reason)=>({status:'BLOCKED',reason});
const clone=x=>structuredClone(x);
const hash=x=>crypto.createHash('sha256').update(JSON.stringify(x)).digest('hex');
const key=a=>PREFIX+a,shipKey=id=>SHIP_PREFIX+id;
const coord=p=>obj(p)&&['x','y','z'].every(k=>typeof p[k]==='number'&&Number.isFinite(p[k]));
function validPF54(row){
 return obj(row)&&row.version===1&&row.phase==='ISSUING'&&row.dispatchCount===1&&
  TOKEN.test(row.operationID)&&TOKEN.test(row.assignmentID)&&PILOT.test(row.pilotID)&&
  TOKEN.test(row.contractID)&&pos(row.shipItemID)&&pos(row.ownerCharacterID)&&
  pos(row.systemID)&&pos(row.stationID)&&pos(row.typeID)&&pos(row.generation)&&
  SHA.test(row.fittingHash)&&SHA.test(row.cargoHash);
}
function validStockHangar(item,row){
 return obj(item)&&item.itemID===row.shipItemID&&item.ownerID===row.ownerCharacterID&&
  item.typeID===row.typeID&&item.categoryID===6&&item.singleton===1&&
  item.stacksize===1&&item.quantity===-1&&item.locationID===row.stationID&&
  item.flagID===4&&(item.spaceState===null||item.spaceState===undefined);
}
function validStockSpace(item,row){
 return obj(item)&&item.itemID===row.shipItemID&&item.ownerID===row.ownerCharacterID&&
  item.typeID===row.typeID&&item.categoryID===6&&item.singleton===1&&
  item.stacksize===1&&item.quantity===-1&&item.locationID===row.systemID&&
  item.flagID===0&&obj(item.spaceState)&&item.spaceState.systemID===row.systemID&&
  coord(item.spaceState.position);
}
function verifyReservation(index,roster,row){
 if(!obj(index)||index.version!==1||!obj(index.ships)||!obj(index.pilots)||
    !obj(roster)||roster.version!==1||!obj(roster.pilots))return false;
 const s=index.ships[String(row.shipItemID)],p=roster.pilots[row.pilotID];
 return !!s&&!!p&&s.ownerCharacterID===row.ownerCharacterID&&
  s.pilotID===row.pilotID&&s.assignmentID===row.assignmentID&&
  s.stationID===row.stationID&&s.generation===row.generation&&
  index.pilots[row.pilotID]?.contractID===row.contractID&&
  p.contractID===row.contractID&&p.shipItemID===row.shipItemID&&
  p.assignmentID===row.assignmentID&&p.generation===row.generation&&
  p.status==='HANGAR_RESERVED';
}
function verifyNativeOutcome(proof,row){
 return obj(proof)&&proof.originalShipItemID===row.shipItemID&&
  proof.entityID===row.shipItemID&&proof.controllerEntityID===row.shipItemID&&
  proof.ownerCharacterID===row.ownerCharacterID&&proof.systemID===row.systemID&&
  proof.pilotID===row.pilotID&&proof.assignmentID===row.assignmentID&&
  proof.generation===row.generation&&proof.uniquePhysicalEntity===true&&
  proof.noNewItemIDs===true&&proof.originalFittingsUnchanged===true&&
  proof.originalCargoUnchanged===true&&proof.fittingHash===row.fittingHash&&
  proof.cargoHash===row.cargoHash;
}
function createOriginalShipHandoff({gameStore,pf52,native,enabled=()=>false,
 allWritersFenced=()=>false,verifyExclusive=()=>false,
 verifyOriginalEquipment=()=>null,clock=()=>Date.now()}={}){
 const a=gameStore?.coopAtomicNativeRows;
 if(a?.mode!=='SERVER_INTERNAL_FLAGGED'||typeof a.transact!=='function'||
    typeof a.isPoisoned!=='function'||!pf52||
    typeof pf52.REGISTRY_KEY!=='string'||typeof pf52.ROSTER_PREFIX!=='string'||
    typeof pf52.checkCompetingClaims!=='function'||
    ['verifyStationAndUndock','noActivePlayerSession','noExistingPhysicalActor',
     'moveOriginalShipToSpace','adoptOriginalShipAsNpc','readOriginalShip','inspectOriginalActor']
       .some(name=>typeof native?.[name]!=='function')||
    [enabled,allWritersFenced,verifyExclusive,verifyOriginalEquipment,clock]
      .some(fn=>typeof fn!=='function'))throw Error('PF58_NATIVE_AUTHORITIES_REQUIRED');
 const permitted=()=>enabled()===true&&allWritersFenced()===true&&!a.isPoisoned();
 // This function makes exactly ONE attempt; the original PF54 row already
 // committed ISSUING, so it cannot be called automatically after a restart.
 function execute(pf54Row){
  if(!permitted())return deny('PF58_DISABLED_OR_WRITERS_UNFENCED');
  if(!validPF54(pf54Row))return deny('PF58_UNTRUSTED_DISPATCH_ROW');
  const row=clone(pf54Row),ship=row.shipItemID;
  let permit;
  try{permit=a.transact([T,ITEMS],tx=>{
   if(!permitted())return deny('PF58_GATE_REVOKED');
   const persisted=tx.get(T,'coop-personal-fleet'+SEP+'deploy-v1:'+row.assignmentID);
   if(!validPF54(persisted)||hash(persisted)!==hash(row))
    return deny('PF58_PF54_ISSUING_DURABLE_MISMATCH');
   const previous=tx.get(T,key(row.assignmentID));
   const previousShip=tx.get(T,shipKey(ship));
   if(previous===undefined||previousShip===undefined)
    return deny('PF58_PERMIT_READ_UNCERTAIN');
   if(previous!==null||previousShip!==null)return deny('PF58_HANDOFF_ALREADY_ATTEMPTED');
   const index=tx.get(T,pf52.REGISTRY_KEY),roster=tx.get(T,pf52.ROSTER_PREFIX+row.ownerCharacterID);
   if(!verifyReservation(index,roster,row))return deny('PF58_ORIGINAL_RESERVATION_UNVERIFIED');
   const items=tx.get(ITEMS,'items');
   if(!obj(items)||!validStockHangar(items[String(ship)],row))
    return deny('PF58_ORIGINAL_HANGAR_SHIP_UNVERIFIED');
   const actors=tx.get(T,ACTORS);
   if(actors===undefined||actors!==null&&(!obj(actors)||!obj(actors.claims)))
    return deny('PF58_ACTOR_CLAIMS_UNVERIFIED');
   if(actors?.claims?.[String(ship)]||Object.values(actors?.claims||{}).some(c=>c?.pilotID===row.pilotID))
    return deny('PF58_EXISTING_PF_ACTOR');
   const collision=pf52.checkCompetingClaims(tx,row);
   if(collision)return deny(collision);
   if(verifyExclusive(clone(row),tx)!==true)
    return deny('PF58_OTHER_NATIVE_OWNER_UNVERIFIED');
   if(native.noActivePlayerSession(clone(row),tx)!==true)
    return deny('PF58_OWNER_SESSION_OR_SHIP_BUSY');
   if(native.noExistingPhysicalActor(clone(row),tx)!==true)
    return deny('PF58_PHYSICAL_ACTOR_ALREADY_EXISTS');
   const equipment=verifyOriginalEquipment(clone(row),tx);
   if(!obj(equipment)||equipment.fittingHash!==row.fittingHash||
      equipment.cargoHash!==row.cargoHash)return deny('PF58_EQUIPMENT_CHANGED');
   const spawn=native.verifyStationAndUndock(clone(row),tx);
   if(!obj(spawn)||spawn.systemID!==row.systemID||spawn.stationID!==row.stationID||
      !coord(spawn.position)||!coord(spawn.direction)||spawn.sessionless!==true)
    return deny('PF58_NATIVE_UNDOCK_POSITION_UNVERIFIED');
   const at=clock();if(!pos(at))return deny('PF58_CLOCK_INVALID');
   const record={version:1,status:'CONSUMED',operationID:row.operationID,
    assignmentID:row.assignmentID,shipItemID:ship,ownerCharacterID:row.ownerCharacterID,
    pilotID:row.pilotID,stationID:row.stationID,systemID:row.systemID,
    generation:row.generation,sourcePF54Hash:hash(row),
    fittingHash:row.fittingHash,cargoHash:row.cargoHash,consumedAtMs:at};
   tx.put(T,key(row.assignmentID),record);
   tx.put(T,shipKey(ship),{assignmentID:row.assignmentID,sourcePF54Hash:hash(row)});
   return {status:'CONSUMED',record,spawn:clone(spawn)};
  });}catch{return deny('PF58_PERMIT_COMMIT_UNKNOWN_NO_RETRY');}
  if(permit?.status!=='CONSUMED')return permit;
  // All effects below are external to the permit transaction. Failure or
  // ambiguity is NOT retried; PF54+PF58 remain durably blocked.
  let moved;
  try{moved=native.moveOriginalShipToSpace(clone(row),clone(permit.spawn));}
  catch{return {status:'OUTCOME_UNKNOWN',reason:'PF58_ITEMSTORE_WRITE_UNKNOWN'};}
  if(moved?.success!==true||moved?.then)
   return {status:'OUTCOME_UNKNOWN',reason:'PF58_ITEMSTORE_MOVE_UNPROVEN'};
  let item;
  try{item=native.readOriginalShip(ship);}
  catch{return {status:'OUTCOME_UNKNOWN',reason:'PF58_ORIGINAL_ITEM_READ_FAILED'};}
  if(!validStockSpace(item,row))return {status:'OUTCOME_UNKNOWN',reason:'PF58_STOCK_SPACE_READBACK_FAILED'};
  let adopted;
  try{adopted=native.adoptOriginalShipAsNpc(clone(row),clone(item));}
  catch{return {status:'OUTCOME_UNKNOWN',reason:'PF58_NATIVE_ADOPTION_UNKNOWN'};}
  if(adopted?.success!==true||adopted?.then)
   return {status:'OUTCOME_UNKNOWN',reason:'PF58_NATIVE_ADOPTION_UNVERIFIED'};
  let proof;
  try{proof=native.inspectOriginalActor(clone(row));}
  catch{return {status:'OUTCOME_UNKNOWN',reason:'PF58_NATIVE_ACTOR_READ_FAILED'};}
  if(!verifyNativeOutcome(proof,row))
   return {status:'OUTCOME_UNKNOWN',reason:'PF58_NATIVE_IDENTITY_OR_TITLE_UNPROVEN'};
  // No PF54 ACTIVE / actor claim is manufactured here: only PF54's separate
  // original GameStore reconcile is authorized to do that.
  return {status:'COMPLETED',shipItemID:ship,assignmentID:row.assignmentID,
   next:'PF54_RECONCILE_REQUIRED'};
 }
 function inspect({assignmentID}={}){
  if(!TOKEN.test(assignmentID))return deny('PF58_ASSIGNMENT_INVALID');
  try{return a.transact([T],tx=>{
   const current=tx.get(T,key(assignmentID));
   if(current===undefined)return deny('PF58_READ_UNCERTAIN');
   return current?{status:current.status,record:clone(current)}:{status:'NOT_FOUND'};
  });}catch{return deny('PF58_READ_UNKNOWN');}
 }
 return Object.freeze({execute,inspect});
}
module.exports={createOriginalShipHandoff,validPF54,validStockHangar,validStockSpace,
 verifyReservation,verifyNativeOutcome,key,shipKey};
